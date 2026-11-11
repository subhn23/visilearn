import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '../src/core/index.ts';
import { compilePack } from '../src/packs/concept/packdef.ts';
import { builtinPacks, withPacks } from '../src/packs/index.ts';
import { lessonToScene, numbered, packToText } from '../src/studio/specs.ts';
import type { LessonSpec, PackSpec } from '../src/studio/specs.ts';

export const PACK_SPEC: PackSpec = {
  name: 'sql',
  title: 'SQL "basics"',
  about: 'Tables, rows and queries.',
  kinds: [
    { name: 'table', icon: 'table', swatch: 'mustard', about: 'A table stores rows.', props: ['rows'], show: 'rows', label: false },
    { name: 'row', icon: 'list', swatch: 'sky', about: 'One record.', props: [], show: '', label: false },
    { name: 'query', icon: 'chat', swatch: 'lilac', about: 'A question you ask the database.', props: ['sql'], show: '', label: true },
  ],
  macros: [
    { name: 'insert', params: ['ROW', 'TABLE'], body: ['add row ROW to TABLE', 'flash ROW ok'] },
  ],
};

export const LESSON_SPEC: LessonSpec = {
  id: 'First Table!',
  title: 'Your first table',
  about: 'A table holds rows.',
  entities: [
    { kind: 'table', id: 'users', label: 'users', props: [{ key: 'rows', value: '1' }] },
    { kind: 'row', id: 'r1', label: 'Asha', props: [] },
  ],
  links: [{ from: 'users', to: 'r1' }],
  steps: [
    { text: 'A table', say: 'Each row is one "record".', ask: null, actions: ['highlight users'], buttons: [], goals: [] },
    {
      text: 'Insert a row',
      say: '',
      ask: { question: 'Where does a new row go?', options: ['Into the table', 'Nowhere'], answer: 1 },
      actions: ['insert r2 users'],
      buttons: [],
      goals: ['exists r2'],
    },
    { text: 'Your turn', say: 'Add one more.', ask: null, actions: [], buttons: [{ label: 'INSERT', action: 'insert r3 users' }], goals: ['exists r3', 'count row = 3'] },
  ],
};

test('pack spec → pack text that compiles (quotes escaped, labels, show)', () => {
  const text = packToText(PACK_SPEC);
  assert.match(text, /^pack sql "SQL 'basics'"/);
  assert.match(text, /kind table icon=table swatch=mustard show=rows about="A table stores rows\."/);
  assert.match(text, /kind query .*role=label/);
  assert.match(text, /^  prop rows$/m);
  assert.match(text, /^macro insert ROW TABLE\n  add row ROW to TABLE\n  flash ROW ok$/m);
  const { pack, diags } = compilePack(text, builtinPacks);
  assert.ok(pack, diags.map((d) => d.msg).join('\n'));
});

test('lesson spec → scene text that compiles: predict ask before actions, buttons, goals', () => {
  const { pack } = compilePack(packToText(PACK_SPEC), builtinPacks);
  const registry = withPacks(builtinPacks, [pack!]);
  const src = lessonToScene(LESSON_SPEC, ['sql']);
  assert.match(src, /^scene sql\.first-table "Your first table"/);
  assert.match(src, /^use sql$/m);
  assert.match(src, /^table users label="users" rows=1$/m);
  assert.match(src, /^link users r1$/m);
  assert.match(src, /say "Each row is one \\"record\\"\."/);
  const s2 = src.slice(src.indexOf('step "Insert a row"'));
  assert.ok(s2.indexOf('ask ') < s2.indexOf('insert r2'), 'predict before observe');
  assert.match(src, /ask "Where does a new row go\?" "Into the table" "Nowhere" answer=1/);
  assert.match(src, /button "INSERT" insert r3 users/);
  assert.match(src, /goal exists r3, count row = 3/);
  const { scene, diags } = compile(src, registry);
  assert.ok(scene, diags.map((d) => `L${d.line} ${d.msg}`).join('\n'));
});

test('numbered() prefixes lines so model repairs can follow L<n> errors', () => {
  assert.equal(numbered('a\nb'), '1  a\n2  b');
});
