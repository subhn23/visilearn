import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson } from '../src/ai/json.ts';

test('plain JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('  [1,2]  '), [1, 2]);
});

test('JSON wrapped in prose or code fences (common with small models)', () => {
  assert.deepEqual(extractJson('Sure! Here it is:\n```json\n{"a": {"b": [1, "}"]}}\n```\nHope that helps.'), { a: { b: [1, '}'] } });
  assert.deepEqual(extractJson('Result: {"ok": true} done'), { ok: true });
  assert.deepEqual(extractJson('<think>let me think {not json}</think>\n{"ok": true}'), { ok: true });
});

test('trailing commas are tolerated; garbage returns undefined', () => {
  assert.deepEqual(extractJson('{"a": [1, 2,], }'), { a: [1, 2] });
  assert.equal(extractJson('no json here'), undefined);
  assert.equal(extractJson('{"unterminated": '), undefined);
});
