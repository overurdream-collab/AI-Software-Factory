import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {ollamaGenerator, ProviderError} from '../src/ollama.mjs';

const digest = text => createHash('sha256').update(text).digest('hex');
// Fixed public fixture only. Never executes the generated candidate.
const source = 'export function add(a, b) { return a - b; }';
const expected = 'export function add(a, b) { return a + b; }';
const goal = 'Fix add so it adds both arguments. Return the entire source exactly as: ' + expected;

async function metadata(port, path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  let reader;
  try {
    const response = await fetch('http://127.0.0.1:' + port + path,
      {redirect: 'error', signal: controller.signal});
    if (!response.ok || !response.body) throw Error('metadata');
    reader = response.body.getReader();
    let size = 0;
    const chunks = [];
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 262144) throw Error('metadata');
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks)));
  } catch { throw new ProviderError('METADATA_UNAVAILABLE'); }
  finally {
    clearTimeout(timer);
    if (reader) {
      Promise.resolve(reader.cancel()).catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function probe({model = 'qwen3:8b', port = 11434, timeoutMs = 120000} = {}) {
  const generate = ollamaGenerator({model, port, timeoutMs}); // validate before any request
  const startedAt = new Date().toISOString();
  const [version, tags] = await Promise.all([metadata(port, '/api/version'), metadata(port, '/api/tags')]);
  const installed = Array.isArray(tags?.models) ? tags.models.find(m => m && (m.name === model || m.model === model)) : null;
  if (typeof version?.version !== 'string' || !installed ||
      typeof installed.digest !== 'string' || !/^(sha256:)?[a-f0-9]{64}$/.test(installed.digest)) {
    throw new ProviderError('MODEL_METADATA_MISSING');
  }
  const start = performance.now();
  const candidate = await generate({source, goal});
  const passed = candidate.trim() === expected;
  return {version: 1, kind: 'provider-probe', passed, startedAt,
    finishedAt: new Date().toISOString(), nodeVersion: process.version,
    provider: 'ollama-loopback', serverVersion: version.version,
    model, modelDigest: installed.digest, elapsedMs: Math.round(performance.now() - start),
    fixture: 'single-source-add-exact-text', sourceSha256: digest(source),
    candidate, candidateSha256: digest(candidate), expectedSha256: digest(expected),
    checks: {structuredCandidate: true, exactFixtureText: passed},
    limits: {inputBytes: 65536, candidateBytes: 65536, responseBytes: 262144, timeoutMs},
    codeExecuted: false, repositoryRepairVerified: false,
    serverSideCancellation: 'not-verified'};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length > 3) throw new ProviderError('INVALID_REQUEST');
    const result = await probe({model: process.env.OLLAMA_MODEL || 'qwen3:8b',
      port: Number(process.env.OLLAMA_PORT || 11434),
      timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 120000)});
    const json = JSON.stringify(result, null, 2) + '\n';
    if (process.argv[2]) await writeFile(process.argv[2], json, {flag: 'wx', mode: 0o600});
    process.stdout.write(json);
    process.exitCode = result.passed ? 0 : 1;
  } catch (error) {
    console.error(JSON.stringify({kind: 'provider-probe', passed: false,
      code: error instanceof ProviderError ? error.code : 'PROBE_FAILED',
      repositoryRepairVerified: false}));
    process.exitCode = 1;
  }
}
