import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createProgressStore } from '../src/app/model/progress.ts';

function memStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), dump: () => m };
}

test('markDone records unique, sorted steps and persists them', () => {
  const s = memStorage();
  const p = createProgressStore(s, () => 1000);
  p.markDone('net.a', 2, 4);
  p.markDone('net.a', 0, 4);
  p.markDone('net.a', 2, 4);
  assert.deepEqual(p.get('net.a')!.done, [0, 2]);
  assert.equal(createProgressStore(s).get('net.a')!.done.length, 2);
  assert.equal(p.percent('net.a', 4), 50);
});

test('corrupt or blocked storage falls back to empty progress and never throws', () => {
  assert.equal(createProgressStore(memStorage({ 'visilearn.progress.v1': '{oops' })).get('x'), undefined);
  const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  const p = createProgressStore(throwing);
  assert.doesNotThrow(() => p.markDone('net.a', 0, 1));
  assert.deepEqual(p.get('net.a')!.done, [0]); // kept in memory for this session
});

test('user data (learner edits) is stored per pack', () => {
  const p = createProgressStore(memStorage());
  p.setUser('net.a', 3, 'net', { edge: ['deny any'] });
  assert.deepEqual(p.get('net.a')!.user, { net: { edge: ['deny any'] } });
});

test('import merges: union of steps, newer learner edits win, bad files are rejected', () => {
  let now = 100;
  const p = createProgressStore(memStorage(), () => now);
  p.markDone('net.a', 0, 3);
  p.setUser('net.a', 3, 'net', 'local');
  const file = JSON.stringify({ app: 'visilearn', v: 1, scenes: {
    'net.a': { done: [1, 2], total: 3, user: { net: 'imported' }, updated: 500 },
    'net.b': { done: [0], total: 1, updated: 50 },
  } });
  now = 200;
  assert.equal(p.importText(file), 2);
  assert.deepEqual(p.get('net.a')!.done, [0, 1, 2]);
  assert.deepEqual(p.get('net.a')!.user, { net: 'imported' });
  assert.deepEqual(p.get('net.b')!.done, [0]);
  assert.throws(() => p.importText('{"hello":1}'), /Not a visilearn progress file/);
  assert.throws(() => p.importText('not json'));
});

test('exportText round-trips and reset clears everything', () => {
  const p = createProgressStore(memStorage());
  p.markDone('net.a', 1, 2);
  const q = createProgressStore(memStorage());
  q.importText(p.exportText());
  assert.deepEqual(q.get('net.a')!.done, [1]);
  q.reset();
  assert.equal(q.get('net.a'), undefined);
});
