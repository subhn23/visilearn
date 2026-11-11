import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProvider } from '../src/ai/providers.ts';
import { AiError } from '../src/ai/types.ts';
import { fakeFetch, json, stream } from './helpers/fakeFetch.ts';

const cfg = { id: 'l', kind: 'openai' as const, label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', model: 'qwen3-8b', apiKey: '' };

test('lists models from /models; sends the API key only when set', async () => {
  const f = fakeFetch({ 'GET /v1/models': () => json({ data: [{ id: 'qwen3-8b' }, { id: 'gemma-3-12b' }] }) });
  const models = await createProvider(cfg, f).listModels();
  assert.deepEqual(models.map((m) => m.id), ['qwen3-8b', 'gemma-3-12b']);
  assert.equal(f.calls[0].headers.authorization, undefined);
  await createProvider({ ...cfg, apiKey: 'sk-test' }, f).listModels();
  assert.equal(f.calls[1].headers.authorization, 'Bearer sk-test');
});

test('streams server-sent events and stops at [DONE]', async () => {
  const f = fakeFetch({
    'POST /v1/chat/completions': () => stream([
      'data: {"choices":[{"delta":{"role":"assistant","content":"Hi"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
      'data: [DONE]\n\n',
    ]),
  });
  const tokens: string[] = [];
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], onToken: (t) => tokens.push(t) });
  assert.equal(r.text, 'Hi there');
  assert.deepEqual(tokens, ['Hi', ' there']);
  assert.deepEqual(r.usage, { input: 5, output: 2 });
  assert.equal(f.calls[0].body.stream, true);
});

test('structured output uses response_format json_schema', async () => {
  const schema = { type: 'object', properties: { n: { type: 'number' } }, required: ['n'] };
  const f = fakeFetch({ 'POST /v1/chat/completions': () => stream(['data: {"choices":[{"delta":{"content":"{\\"n\\":4}"}}]}\n\n', 'data: [DONE]\n\n']) });
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'user', content: '2+2' }], schema });
  assert.deepEqual(f.calls[0].body.response_format, { type: 'json_schema', json_schema: { name: 'answer', schema, strict: true } });
  assert.deepEqual(r.json, { n: 4 });
});

test('falls back to json_object when the server rejects json_schema', async () => {
  let n = 0;
  const f = fakeFetch({
    'POST /v1/chat/completions': (c) => {
      n++;
      if (c.body.response_format?.type === 'json_schema') return json({ error: { message: "response_format 'json_schema' is not supported" } }, 400);
      return stream(['data: {"choices":[{"delta":{"content":"{\\"n\\":4}"}}]}\n\n', 'data: [DONE]\n\n']);
    },
  });
  const r = await createProvider(cfg, f).chat({ messages: [{ role: 'user', content: 'x' }], schema: { type: 'object' } });
  assert.equal(n, 2);
  assert.deepEqual(f.calls[1].body.response_format, { type: 'json_object' });
  assert.deepEqual(r.json, { n: 4 });
});

test('auth failures are explained', async () => {
  const f = fakeFetch({ 'GET /v1/models': () => json({ error: { message: 'Incorrect API key' } }, 401) });
  await assert.rejects(createProvider(cfg, f).listModels(), (e: AiError) => e.code === 'auth' && /API key/.test(e.message));
});
