import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {probe} from '../scripts/provider-live.mjs';

// These HTTP fixtures test the probe, not a real model.
async function fixture(t, {candidate = 'export function add(a, b) { return a + b; }', tags} = {}) {
  const server = createServer((request, response) => {
    if (request.url === '/api/version') return response.end(JSON.stringify({version: 'fixture-server'}));
    if (request.url === '/api/tags') return response.end(JSON.stringify(tags ?? {
      models: [{name: 'fixture:1', digest: 'a'.repeat(64)}]
    }));
    response.end(JSON.stringify({done: true, response: JSON.stringify({candidate})}));
  });
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
  return {model: 'fixture:1', port: server.address().port};
}

test('probe records provenance and hashes without claiming repository execution', async t => {
  const result = await probe(await fixture(t));
  assert.equal(result.passed, true);
  assert.equal(result.serverVersion, 'fixture-server');
  assert.equal(result.modelDigest, 'a'.repeat(64));
  assert.equal(result.candidateSha256, result.expectedSha256);
  assert.equal(result.codeExecuted, false);
  assert.equal(result.repositoryRepairVerified, false);
  assert.equal(result.serverSideCancellation, 'not-verified');
});

test('probe reports a valid but incorrect candidate as a failed fixture', async t => {
  const result = await probe(await fixture(t, {candidate: 'throw Error("not executed");'}));
  assert.equal(result.passed, false);
  assert.equal(result.checks.structuredCandidate, true);
  assert.equal(result.checks.exactFixtureText, false);
  assert.equal(result.codeExecuted, false);
});

test('probe requires installed model identity instead of accepting a name alone', async t => {
  const config = await fixture(t, {tags: {models: [{name: 'fixture:1'}]}});
  await assert.rejects(probe(config), {code: 'MODEL_METADATA_MISSING'});
});

test('probe rejects malformed metadata and invalid configuration', async t => {
  const config = await fixture(t, {tags: {models: {}}});
  await assert.rejects(probe(config), {code: 'MODEL_METADATA_MISSING'});
  await assert.rejects(probe({port: 0}), {code: 'INVALID_CONFIG'});
});
