import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RulesEditor } from '../src/packs/net/model/rulesEditor.ts';
import { parseRule } from '../src/packs/net/sim.ts';
import type { FwRules } from '../src/packs/net/sim.ts';

const ids = new Set(['laptop', 'web', 'ext']);
const isEntity = (id: string) => ids.has(id);
const fw = (): FwRules => ({
  editable: true,
  policy: 'deny',
  initialPolicy: 'deny',
  initial: ['allow tcp:80 to web'],
  rules: [parseRule('allow tcp:80 to web', isEntity).rule!],
});
const texts = (f: FwRules) => f.rules.map((r) => r.text);

test('starts with one row per existing rule', () => {
  const ed = new RulesEditor(fw(), isEntity);
  assert.deepEqual(ed.rows.map((r) => r.text), ['allow tcp:80 to web']);
  assert.equal(ed.rows[0].error, '');
});

test('editing a row re-applies valid rules to the firewall immediately', () => {
  const f = fw();
  const ed = new RulesEditor(f, isEntity);
  ed.add('allow tcp:22 from laptop to web');
  assert.deepEqual(texts(f), ['allow tcp:80 to web', 'allow tcp:22 from laptop to web']);
  ed.update(ed.rows[1].id, 'deny any');
  assert.deepEqual(texts(f), ['allow tcp:80 to web', 'deny any']);
});

test('invalid rows show an error and are left out; empty rows are silent', () => {
  const f = fw();
  const ed = new RulesEditor(f, isEntity);
  ed.add('allow tcp:22 from nobody');
  assert.match(ed.rows[1].error, /unknown entity 'nobody'/);
  ed.add('');
  assert.equal(ed.rows[2].error, '');
  assert.deepEqual(texts(f), ['allow tcp:80 to web']);
  assert.equal(ed.errorCount, 1);
});

test('moveUp and remove change the order the firewall checks', () => {
  const f = fw();
  const ed = new RulesEditor(f, isEntity);
  ed.add('deny any');
  ed.moveUp(ed.rows[1].id);
  assert.deepEqual(texts(f), ['deny any', 'allow tcp:80 to web']);
  ed.moveUp(ed.rows[0].id); // already first: no-op
  assert.deepEqual(texts(f), ['deny any', 'allow tcp:80 to web']);
  ed.remove(ed.rows[0].id);
  assert.deepEqual(texts(f), ['allow tcp:80 to web']);
});

test('policy changes and reset restores the original rules', () => {
  const f = fw();
  const ed = new RulesEditor(f, isEntity);
  ed.setPolicy('allow');
  ed.add('deny any');
  assert.equal(f.policy, 'allow');
  ed.reset();
  assert.equal(f.policy, 'deny');
  assert.deepEqual(texts(f), ['allow tcp:80 to web']);
  assert.deepEqual(ed.rows.map((r) => r.text), ['allow tcp:80 to web']);
});

test('read-only firewalls ignore edits', () => {
  const f = { ...fw(), editable: false };
  const ed = new RulesEditor(f, isEntity);
  ed.add('deny any');
  ed.setPolicy('allow');
  assert.deepEqual(texts(f), ['allow tcp:80 to web']);
  assert.equal(f.policy, 'deny');
});

test('onChange fires after every applied edit', () => {
  let n = 0;
  const ed = new RulesEditor(fw(), isEntity, () => n++);
  ed.add('deny any');
  ed.setPolicy('allow');
  ed.reset();
  assert.equal(n, 3);
});
