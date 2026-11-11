// Live check against a local Ollama, if one is running (skipped otherwise).
//   npm run test:live   (OLLAMA_MODEL=gemma4:12b to pick a model)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testConnection } from '../../src/ai/diagnose.ts';
import { createProvider } from '../../src/ai/providers.ts';

const BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434';
let installed: string[] = [];
try {
  const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
  installed = ((await r.json()) as { models: { name: string }[] }).models.map((m) => m.name);
} catch { /* no Ollama here */ }
const model = process.env.OLLAMA_MODEL ?? installed.find((m) => /gemma/.test(m)) ?? installed[0];
const skip = !model && 'no local Ollama with models';
const cfg = { id: 'live', kind: 'ollama' as const, label: 'Ollama', baseUrl: BASE, model: model ?? '' };

test('live: test connection reaches the model', { skip, timeout: 300_000 }, async () => {
  const r = await testConnection(cfg, { origin: 'http://localhost:5173' });
  assert.equal(r.ok, true, `${r.message} ${r.fix ?? ''}`);
  console.log(`  ${r.summary}`);
});

test('live: structured output returns schema-shaped JSON', { skip, timeout: 300_000 }, async () => {
  const schema = {
    type: 'object',
    properties: { topic: { type: 'string' }, concepts: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
    required: ['topic', 'concepts'],
  };
  const r = await createProvider(cfg).chat({
    messages: [{ role: 'user', content: 'Give the topic "git branching" and exactly three key concepts a beginner must learn. Answer as JSON.' }],
    schema,
    temperature: 0,
  });
  const j = r.json as { topic: string; concepts: string[] };
  assert.equal(typeof j.topic, 'string');
  assert.equal(j.concepts.length, 3);
  console.log(`  ${model}: ${JSON.stringify(j)} (${(r.ms / 1000).toFixed(1)} s, ${r.usage?.output ?? '?'} tokens)`);
});
