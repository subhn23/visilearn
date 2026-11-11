import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildModuleCards } from '../src/app/model/modules.ts';
import { createModule } from '../src/modules/format.ts';
import { packs } from '../src/packs/index.ts';

const L = (id: string, steps: number) => `scene net.${id} "Lesson ${id}"
use net
host a
${Array.from({ length: steps }, (_, i) => `step "s${i}"\n  a ping a`).join('\n')}`;

test('module cards list lessons with namespaced keys and progress', () => {
  const m = { ...createModule({ title: 'Mine', author: 'Asha', scenes: [L('one', 2), L('two', 4)] }, { id: 'mine-000001', now: 1 }), added: '', saved: '' };
  const done: Record<string, number[]> = { 'm:mine-000001/net.one': [0, 1], 'm:mine-000001/net.two': [0] };
  const [card] = buildModuleCards([m], packs, (k) => done[k] ?? []);
  assert.equal(card.title, 'Mine');
  assert.equal(card.author, 'Asha');
  assert.deepEqual(card.lessons.map((l) => [l.key, l.title, l.steps, l.pct]), [
    ['m:mine-000001/net.one', 'Lesson one', 2, 100],
    ['m:mine-000001/net.two', 'Lesson two', 4, 25],
  ]);
  assert.equal(card.pct, 50, 'module progress = finished steps / all steps');
  assert.ok(card.swatch);
});

test('a module whose lessons no longer compile is marked broken, not hidden', () => {
  const m = { ...createModule({ title: 'Old', scenes: [L('ok', 1)] }, { id: 'old-0000001', now: 1 }), added: '', saved: '' };
  m.scenes = [{ source: 'scene net.bad "Bad"\nuse net\nstep "s"\n  explode' }];
  const [card] = buildModuleCards([m], packs, () => []);
  assert.equal(card.lessons.length, 0);
  assert.match(card.errors[0], /Lesson 1/);
});
