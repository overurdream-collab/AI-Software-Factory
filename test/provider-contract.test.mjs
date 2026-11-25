import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {ollamaGenerator, ProviderError} from '../src/ollama.mjs';

const input = {source: 'old', goal: 'fix'};
const encoded = candidate => JSON.stringify({done: true, response: JSON.stringify({candidate})});
const using = body => ollamaGenerator({fetchImpl: async () => new Response(body)});
const code = expected => error => error instanceof ProviderError && error.code === expected;

test('invalid config and requests fail without fetching', async () => {
  for (const config of [{model: 1}, {model: '../bad model'}, {port: 65536}, {port: 1.5},
    {timeoutMs: 0}, {timeoutMs: 300001}, {fetchImpl: null}]) {
    assert.throws(() => ollamaGenerator(config), code('INVALID_CONFIG'));
  }
  let calls = 0;
  const generate = ollamaGenerator({fetchImpl: async () => { calls++; }});
  for (const request of [undefined, null, {}, {...input, goal: ' '}, {...input, signal: {}},
    {...input, source: 'أ'.repeat(32768)}]) {
    await assert.rejects(generate(request), code('INVALID_REQUEST'));
  }
  assert.equal(calls, 0);
});

for (const [name, body, expected] of [
  ['outer malformed JSON', '{', 'INVALID_JSON'],
  ['outer null', 'null', 'INCOMPLETE_GENERATION'],
  ['unfinished generation', JSON.stringify({done: false, response: '{}'}), 'INCOMPLETE_GENERATION'],
  ['missing response', JSON.stringify({done: true}), 'INCOMPLETE_GENERATION'],
  ['inner malformed JSON', JSON.stringify({done: true, response: '{'}), 'INVALID_JSON'],
  ['inner null', JSON.stringify({done: true, response: 'null'}), 'INVALID_CANDIDATE'],
  ['empty candidate', encoded('  '), 'INVALID_CANDIDATE'],
  ['non-string candidate', encoded({code: 'x'}), 'INVALID_CANDIDATE'],
  ['oversized multibyte candidate', encoded('أ'.repeat(32769)), 'INVALID_CANDIDATE'],
]) {
  test(name, async () => assert.rejects(using(body)(input), code(expected)));
}

test('input and candidate byte boundaries are inclusive and contents are preserved', async () => {
  let calls = 0;
  const candidate = 'أ'.repeat(32768);
  const generate = ollamaGenerator({fetchImpl: async () => { calls++; return new Response(encoded(candidate)); }});
  assert.equal(await generate({source: 'x'.repeat(65533), goal: 'fix'}), candidate);
  await assert.rejects(generate({source: 'x'.repeat(65534), goal: 'fix'}), code('INVALID_REQUEST'));
  assert.equal(calls, 1);
});

test('connection errors are classified without leaking raw errors', async () => {
  const generate = ollamaGenerator({fetchImpl: async () => { throw Error('sensitive source from transport'); }});
  await assert.rejects(generate(input), error => code('UNAVAILABLE')(error) && !error.message.includes('sensitive'));
});

test('HTTP failure cancels the response body', async () => {
  let cancelled = false;
  const body = new ReadableStream({cancel() { cancelled = true; }});
  const generate = ollamaGenerator({fetchImpl: async () => new Response(body, {status: 503})});
  await assert.rejects(generate(input), code('HTTP_ERROR'));
  assert.equal(cancelled, true);
});

test('missing body, stream failure and invalid UTF-8 are rejected', async () => {
  const noBody = ollamaGenerator({fetchImpl: async () => new Response(null, {status: 204})});
  await assert.rejects(noBody(input), code('MISSING_RESPONSE'));
  const broken = new ReadableStream({start(c) { c.error(Error('raw secret')); }});
  const brokenGenerate = ollamaGenerator({fetchImpl: async () => new Response(broken)});
  await assert.rejects(brokenGenerate(input), code('RESPONSE_ERROR'));
  await assert.rejects(using(new Uint8Array([255]))(input), code('INVALID_JSON'));
});

test('oversized response cancels the reader before parsing', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) { c.enqueue(new Uint8Array(262145)); },
    cancel() { cancelled = true; }
  });
  await assert.rejects(ollamaGenerator({fetchImpl: async () => new Response(body)})(input), code('RESPONSE_TOO_LARGE'));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('deadline bounds even a noncooperative injected fetch', async () => {
  const generate = ollamaGenerator({timeoutMs: 25, fetchImpl: () => new Promise(() => {})});
  await assert.rejects(generate(input), code('TIMEOUT'));
});

test('late response after timeout is cancelled', async () => {
  let resolveFetch, cancelled = false;
  const generate = ollamaGenerator({timeoutMs: 25, fetchImpl: () => new Promise(r => { resolveFetch = r; })});
  await assert.rejects(generate(input), code('TIMEOUT'));
  resolveFetch(new Response(new ReadableStream({cancel() { cancelled = true; }})));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(cancelled, true);
});

test('deadline bounds a stalled response body even if cancel never resolves', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('{"done":')); },
    cancel() { cancelled = true; return new Promise(() => {}); }
  });
  const generate = ollamaGenerator({timeoutMs: 25, fetchImpl: async () => new Response(body)});
  await assert.rejects(generate(input), code('TIMEOUT'));
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('caller cancellation at response acquisition preserves reason and cancels stream', async () => {
  const controller = new AbortController();
  let entered, cancelled = false;
  const ready = new Promise(resolve => { entered = resolve; });
  const body = new ReadableStream({
    pull() { entered(); },
    cancel() { cancelled = true; }
  });
  const pending = ollamaGenerator({fetchImpl: async () => new Response(body)})({...input, signal: controller.signal});
  await ready;
  const reason = Error('lease lost while reading');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('caller cancellation with a pending reader.read cancels and unlocks the body', async () => {
  const controller = new AbortController();
  let reading, cancelled = false;
  const ready = new Promise(resolve => { reading = resolve; });
  const stream = new ReadableStream({cancel() { cancelled = true; }});
  const body = {
    getReader() {
      const reader = stream.getReader();
      return {
        read() { const pending = reader.read(); reading(); return pending; },
        cancel: () => reader.cancel(), releaseLock: () => reader.releaseLock()
      };
    }
  };
  const generate = ollamaGenerator({fetchImpl: async () => ({ok: true, body})});
  const pending = generate({...input, signal: controller.signal});
  await ready;
  const reason = Error('lease lost with pending read');
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    const closed = once(server, 'close');
    server.close();
    server.closeAllConnections();
    await closed;
  });
  return server.address().port;
}

test('HTTP integration: real request transmits model and returns a candidate (synthetic server)', async t => {
  const port = await serverFor(t, async (request, response) => {
    assert.equal(request.url, '/api/generate');
    assert.equal(request.method, 'POST');
    let body = '';
    for await (const part of request) body += part;
    const parsed = JSON.parse(body);
    assert.equal(parsed.model, 'fixture:1');
    assert.deepEqual(JSON.parse(parsed.prompt), {goal: 'fix', source: 'old'});
    response.end(encoded('new'));
  });
  assert.equal(await ollamaGenerator({port, model: 'fixture:1'})(input), 'new');
});

test('HTTP integration: unavailable loopback service is classified', async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  await assert.rejects(ollamaGenerator({port, timeoutMs: 1000})(input), code('UNAVAILABLE'));
});

test('HTTP integration: stalled body reaches deadline', async t => {
  const port = await serverFor(t, (_request, response) => {
    response.writeHead(200, {'content-type': 'application/json'});
    response.write('{"done":');
  });
  await assert.rejects(ollamaGenerator({port, timeoutMs: 100})(input), code('TIMEOUT'));
});

test('HTTP integration: redirects cannot send source to a second endpoint', async t => {
  let redirected = 0;
  const target = await serverFor(t, (_request, response) => { redirected++; response.end(encoded('new')); });
  const port = await serverFor(t, (_request, response) => {
    response.writeHead(307, {location: 'http://127.0.0.1:' + target + '/capture'}).end();
  });
  await assert.rejects(ollamaGenerator({port})(input), code('UNAVAILABLE'));
  assert.equal(redirected, 0);
});
