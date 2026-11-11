import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from '../src/ai/providers.ts';
import { AiError } from '../src/ai/types.ts';
import { fakeFetch, json, stream } from './helpers/fakeFetch.ts';

const cfg = { id: 'o', kind: 'ollama' as const, label: 'Ollama', baseUrl: 'http://localhost:11434/', model: 'gemma4:12b' };

test('lists installed models with size and family', async () => {
  const f = fakeFetch({
    'GET /api/tags': () => json({ models: [
      { name: 'gemma4:12b', size: 9461576343, details: { family: 'gemma4', parameter_size: '12B' } },
      { name: 'gemma4:e4b-mlx', size: 5000000000, details: { family: 'gemma4' } },
    ] }),
  });
  const models = await createProvider(cfg, f).listModels();
  assert.deepEqual(models.map((m) => [m.id, m.detail]), [['gemma4:12b', 'gemma4 · 12B · 9.5 GB'], ['gemma4:e4b-mlx', 'gemma4 · 5.0 GB']]);
  assert.equal(f.calls[0].url, 'http://localhost:11434/api/tags', 'trailing slash on base URL handled');
});

test('streams a chat reply token by token', async () => {
  const f = fakeFetch({
    'POST /api/chat': () => stream([
      '{"message":{"role":"assistant","content":"Hel"},"done":false}\n{"message":{"content":"lo"}',
      ',"done":false}\n',
      '{"message":{"content":"!"},"done":true,"prompt_eval_count":12,"eval_count":3}\n',
    ]),
  });
  const tokens: string[] = [];
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'user', content: 'hi' }], onToken: (t) => tokens.push(t) });
  assert.equal(r.text, 'Hello!');
  assert.deepEqual(tokens, ['Hel', 'lo', '!']);
  assert.deepEqual(r.usage, { input: 12, output: 3 });
  const body = f.calls[0].body;
  assert.equal(body.model, 'gemma4:12b');
  assert.equal(body.stream, true);
  assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
});

test('structured output sends the JSON schema as `format` and parses the reply', async () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
  const f = fakeFetch({ 'POST /api/chat': () => stream(['{"message":{"content":"{\\"ok\\": true}"},"done":true}\n']) });
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'user', content: 'x' }], schema, temperature: 0 });
  assert.deepEqual(f.calls[0].body.format, schema);
  assert.equal(f.calls[0].body.options.temperature, 0);
  assert.deepEqual(r.json, { ok: true });
});

test('errors are classified: unknown model, http, unreachable', async () => {
  const missing = fakeFetch({ 'POST /api/chat': () => json({ error: "model 'nope' not found" }, 404) });
  await assert.rejects(createProvider({ ...cfg, model: 'nope' }, missing).chat({ messages: [] }), (e: AiError) => e.code === 'model_not_found' && /ollama pull nope/.test(e.hint));
  const down = Object.assign(async () => { throw new TypeError('Failed to fetch'); }, { calls: [] }) as unknown as typeof fetch;
  await assert.rejects(createProvider(cfg, down).listModels(), (e: AiError) => e.code === 'unreachable');
  const noModel = createProvider({ ...cfg, model: '' }, fakeFetch({}));
  await assert.rejects(noModel.chat({ messages: [] }), (e: AiError) => e.code === 'no_model');
});

test('chat can be cancelled', async () => {
  const ctl = new AbortController();
  ctl.abort();
  const f = fakeFetch({ 'POST /api/chat': () => stream(['{"done":true}\n']) });
  await assert.rejects(createProvider(cfg, f).chat({ messages: [], signal: ctl.signal }), (e: AiError) => e.code === 'aborted');
});

test('reasoning ("thinking") is reported separately and never mixed into the answer', async () => {
  const f = fakeFetch({
    'POST /api/chat': () => stream([
      '{"message":{"role":"assistant","content":"","thinking":"Let me "},"done":false}\n',
      '{"message":{"content":"","thinking":"think."},"done":false}\n',
      '{"message":{"content":"Answer."},"done":true}\n',
    ]),
  });
  const thinking: string[] = [];
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'user', content: 'q' }], onThinking: (t) => thinking.push(t) });
  assert.equal(r.text, 'Answer.');
  assert.equal(thinking.join(''), 'Let me think.');
  assert.equal(f.calls[0].body.think, undefined, 'never send think:false: Gemma then writes its reasoning into the answer');
});
