import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testConnection } from '../src/ai/diagnose.ts';
import { fakeFetch, json, stream } from './helpers/fakeFetch.ts';

const ollama = { id: 'o', kind: 'ollama' as const, label: 'Ollama', baseUrl: 'http://localhost:11434', model: 'gemma4:12b' };
const origin = 'https://visilearn.web.app';

test('healthy server: reports version, model count and that the chosen model replies', async () => {
  const f = fakeFetch({
    'GET /api/version': () => json({ version: '0.40.16' }),
    'GET /api/tags': () => json({ models: [{ name: 'gemma4:12b', size: 1 }] }),
    'POST /api/chat': () => stream(['{"message":{"content":"OK"},"done":true}\n']),
  });
  const r = await testConnection(ollama, { fetch: f, origin });
  assert.equal(r.ok, true);
  assert.match(r.summary, /Ollama 0\.40\.16 · 1 model · gemma4:12b replied/);
  assert.deepEqual(r.models.map((m) => m.id), ['gemma4:12b']);
});

test('server up but blocking this site (CORS): explains OLLAMA_ORIGINS with the real origin', async () => {
  // cors-mode requests fail; a no-cors probe reaches the server (opaque response)
  const f = Object.assign(async (_u: string, init: RequestInit = {}) => {
    if (init.mode === 'no-cors') return new Response(null, { status: 200 });
    throw new TypeError('Failed to fetch');
  }, { calls: [] }) as unknown as typeof fetch;
  const r = await testConnection(ollama, { fetch: f, origin });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'cors');
  assert.ok(r.fix!.includes(`OLLAMA_ORIGINS`) && r.fix!.includes(origin), r.fix ?? '');
});

test('nothing listening: says so and how to start Ollama', async () => {
  const f = Object.assign(async () => { throw new TypeError('Failed to fetch'); }, { calls: [] }) as unknown as typeof fetch;
  const r = await testConnection(ollama, { fetch: f, origin });
  assert.equal(r.code, 'unreachable');
  assert.match(r.message, /could not reach/i);
  assert.match(r.fix!, /ollama serve|Ollama app/);
});

test('reachable but the selected model is missing', async () => {
  const f = fakeFetch({
    'GET /api/version': () => json({ version: '0.40.16' }),
    'GET /api/tags': () => json({ models: [{ name: 'llama3:8b', size: 1 }] }),
  });
  const r = await testConnection({ ...ollama, model: 'gemma4:12b' }, { fetch: f, origin });
  assert.equal(r.code, 'model_not_found');
  assert.match(r.fix!, /ollama pull gemma4:12b/);
  assert.deepEqual(r.models.map((m) => m.id), ['llama3:8b'], 'still offers the models that exist');
});
