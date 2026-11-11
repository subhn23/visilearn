import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TermInput } from '../src/packs/linux/model/termInput.ts';

const shellish = {
  complete: (l: string) => (l === 'ca' ? 'cat ' : l === 'cd pro' ? 'cd projects/' : l),
  candidates: (l: string) => (l === 'c' ? ['cat', 'cd', 'cp'] : l === 'ca' ? ['cat'] : []),
};

test('submit returns the trimmed line, records history and clears the input', () => {
  const t = new TermInput(shellish);
  t.value = '  ls -l  ';
  assert.equal(t.submit(), 'ls -l');
  assert.equal(t.value, '');
  t.value = '   ';
  assert.equal(t.submit(), null, 'blank lines are ignored');
  t.value = 'ls -l';
  t.submit();
  assert.deepEqual(t.history, ['ls -l'], 'consecutive duplicates are stored once');
});

test('up/down walk history and restore the unfinished draft', () => {
  const t = new TermInput(shellish);
  for (const c of ['pwd', 'ls', 'cd /etc']) { t.value = c; t.submit(); }
  t.value = 'ca';
  t.up(); assert.equal(t.value, 'cd /etc');
  t.up(); assert.equal(t.value, 'ls');
  t.up(); t.up(); assert.equal(t.value, 'pwd', 'stops at the oldest entry');
  t.down(); assert.equal(t.value, 'ls');
  t.down(); t.down(); assert.equal(t.value, 'ca', 'back to the draft');
  t.down(); assert.equal(t.value, 'ca');
});

test('tab completes a unique match, or lists the options', () => {
  const t = new TermInput(shellish);
  t.value = 'ca';
  assert.deepEqual(t.tab(), []);
  assert.equal(t.value, 'cat ');
  t.value = 'c';
  assert.deepEqual(t.tab(), ['cat', 'cd', 'cp']);
  assert.equal(t.value, 'c');
});
