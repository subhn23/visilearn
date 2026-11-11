import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAiSettings, PRESETS } from '../src/ai/settings.ts';

function mem() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), raw: m };
}

test('starts with Ollama (local) as the active provider', () => {
  const s = createAiSettings(mem());
  assert.equal(s.list().length, 1);
  assert.equal(s.active()!.kind, 'ollama');
  assert.equal(s.active()!.baseUrl, 'http://localhost:11434');
});

test('presets cover local servers first, then cloud', () => {
  assert.deepEqual(PRESETS.map((p) => p.key), ['ollama', 'lmstudio', 'llamacpp', 'openai-compatible', 'openai']);
  assert.ok(PRESETS.slice(0, 3).every((p) => p.local));
});

test('add, update, choose the active one, remove; persisted', () => {
  const store = mem();
  const s = createAiSettings(store);
  const lm = s.add('lmstudio');
  assert.equal(lm.baseUrl, 'http://localhost:1234/v1');
  s.update(lm.id, { model: 'qwen3-8b' });
  s.setActive(lm.id);
  const again = createAiSettings(store);
  assert.equal(again.active()!.id, lm.id);
  assert.equal(again.active()!.model, 'qwen3-8b');
  again.remove(lm.id);
  assert.equal(again.active()!.kind, 'ollama', 'falls back to another provider');
});

test('API keys are kept, but never shown in an export of settings', () => {
  const s = createAiSettings(mem());
  const o = s.add('openai');
  s.update(o.id, { apiKey: 'sk-secret' });
  assert.equal(s.get(o.id)!.apiKey, 'sk-secret');
  assert.ok(!JSON.stringify(s.exportSafe()).includes('sk-secret'));
});

test('corrupt storage falls back to defaults', () => {
  const store = mem();
  store.setItem('visilearn.ai.v1', '{broken');
  assert.equal(createAiSettings(store).active()!.kind, 'ollama');
});
