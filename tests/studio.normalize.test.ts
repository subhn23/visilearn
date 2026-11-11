// Small local models answer in "almost the right shape". These cases come from real gemma4:12b output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compilePack } from '../src/packs/concept/packdef.ts';
import { builtinPacks } from '../src/packs/index.ts';
import { normalizeLesson, normalizeOutline, normalizePack } from '../src/studio/normalize.ts';
import { packToText } from '../src/studio/specs.ts';

test('pack: aliases, object props, hex colours, invented icons, snake_case names', () => {
  const p = normalizePack({
    name: 'git',
    description: 'Version control concepts.',
    kinds: [
      { name: 'repository', icon: 'folder', swatch: '#336699', props: { status: 'active|archived', location: 'local|remote' }, show: 'status' },
      { name: 'commit', icon: 'file-check', swatch: '#009933', props: { hash: 'SHA-1' }, show: 'hash' },
      { name: 'branch', icon: 'branch-fork', props: { name: 'n' }, label: true, show: 'name' },
      { name: 'remote file', icon: 'document', show: 'nope' },
      { name: 'Thing', icon: 'unicorn' },
    ],
    macros: [{ name: 'create_branch', params: ['to_repo', 'NEW BRANCH'], body: 'add branch NEW_BRANCH to TO_REPO' }],
  });
  assert.equal(p.title, 'Git');
  assert.equal(p.about, 'Version control concepts.');
  assert.deepEqual(p.kinds.map((k) => k.icon), ['folder', 'file', 'branch', 'file', 'box']);
  assert.ok(p.kinds.every((k) => ['mustard', 'mint', 'lilac', 'peach', 'sky', 'rose'].includes(k.swatch)));
  assert.deepEqual(p.kinds[0].props, ['status', 'location']);
  assert.equal(p.kinds[3].name, 'remote-file');
  assert.equal(p.kinds[3].show, '', 'show must name a declared prop');
  assert.equal(p.kinds[4].name, 'thing');
  assert.equal(p.macros[0].name, 'create-branch');
  assert.deepEqual(p.macros[0].params, ['TO_REPO', 'NEW_BRANCH']);
  assert.deepEqual(p.macros[0].body, ['add branch NEW_BRANCH to TO_REPO']);
  const { pack, diags } = compilePack(packToText(p), builtinPacks);
  assert.ok(pack, diags.map((d) => `L${d.line} ${d.msg}`).join('\n'));
});

test('pack: reserved/clashing names are renamed rather than failing', () => {
  const p = normalizePack({ name: 'linux', title: 'x', kinds: [{ name: 'add', icon: 'box' }, { name: 'step', icon: 'box' }], macros: [{ name: 'set', params: [], body: ['flash X'] }] });
  assert.notEqual(p.name, 'linux');
  assert.deepEqual(p.kinds.map((k) => k.name), ['add-item', 'step-item']);
  assert.equal(p.macros[0].name, 'set-action');
});

test('outline: string section refs, alias fields', () => {
  const items = normalizeOutline({ lessons: [{ title: 'A', description: 'd', sections: ['[1]', '2', 'x'], concepts: ['c'] }, { name: 'B' }] });
  assert.deepEqual(items, [
    { title: 'A', about: 'd', sections: [1, 2], key_concepts: ['c'] },
    { title: 'B', about: '', sections: [], key_concepts: [] },
  ]);
});

test('lesson: props objects, missing ask, string answers/actions/goals, alias fields, link forms', () => {
  const l = normalizeLesson({
    name: 'Commits',
    entities: [{ type: 'commit', id: 'C1', label: 'first', props: { message: 'init' } }],
    links: [['c1', 'c2'], 'main -> c1', { source: 'a', target: 'b' }],
    steps: [
      { title: 'Intro', say: 'Hello', actions: 'highlight c1' },
      { text: 'Guess', ask: { question: 'Which?', options: ['x', 'y'], answer: 'y' }, actions: [], goals: 'exists c2, linked c1 c2' },
      { text: 'Try', buttons: [{ text: 'Commit', action: 'commit c2 c1 main' }], ask: { question: 'Q', options: ['a', 'b'], answer: 0 } },
    ],
  });
  assert.equal(l.title, 'Commits');
  assert.deepEqual(l.entities[0], { kind: 'commit', id: 'c1', label: 'first', props: [{ key: 'message', value: 'init' }] });
  assert.deepEqual(l.links, [{ from: 'c1', to: 'c2' }, { from: 'main', to: 'c1' }, { from: 'a', to: 'b' }]);
  assert.equal(l.steps[0].text, 'Intro');
  assert.deepEqual(l.steps[0].actions, ['highlight c1']);
  assert.equal(l.steps[0].ask, null);
  assert.equal(l.steps[1].ask!.answer, 2, 'answer given as option text');
  assert.deepEqual(l.steps[1].goals, ['exists c2', 'linked c1 c2']);
  assert.equal(l.steps[2].buttons[0].label, 'Commit');
  assert.equal(l.steps[2].ask!.answer, 1, '0 is read as a zero-based index');
});
