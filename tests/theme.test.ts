import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nextPref, readPref, resolveTheme, writePref } from '../src/app/model/theme.ts';

test('resolveTheme: explicit choice wins, system follows the OS', () => {
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});

test('nextPref cycles system → light → dark → system', () => {
  assert.equal(nextPref('system'), 'light');
  assert.equal(nextPref('light'), 'dark');
  assert.equal(nextPref('dark'), 'system');
});

test('readPref tolerates missing, invalid and throwing storage', () => {
  assert.equal(readPref(null), 'system');
  assert.equal(readPref({ getItem: () => 'dark' }), 'dark');
  assert.equal(readPref({ getItem: () => 'neon' }), 'system');
  assert.equal(readPref({ getItem: () => { throw new Error('blocked'); } }), 'system');
});

test('writePref stores the choice and never throws', () => {
  const mem = new Map<string, string>();
  writePref({ setItem: (k, v) => mem.set(k, v) }, 'dark');
  assert.equal([...mem.values()][0], 'dark');
  assert.doesNotThrow(() => writePref({ setItem: () => { throw new Error('full'); } }, 'light'));
  assert.doesNotThrow(() => writePref(null, 'light'));
});
