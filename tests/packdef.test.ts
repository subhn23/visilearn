import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile, createState, headlessFx, layoutScene, resetTransient, simulate } from '../src/core/index.ts';
import type { Runtime, Scene } from '../src/core/index.ts';
import { builtinPacks, withPacks } from '../src/packs/index.ts';
import { compilePack } from '../src/packs/concept/packdef.ts';

export const GIT_PACK = `pack git "Git basics"
about "Commits, branches and merges."
kind commit icon=circle swatch=mustard show=message about="A saved snapshot of the project."
  prop message
kind branch icon=tag swatch=mint tier=0 about="A movable label that points at a commit."
macro commit ID PARENT BRANCH
  add commit ID to PARENT
  point BRANCH ID
  flash ID ok
macro branch NAME AT
  add branch NAME
  point NAME AT`;

const LESSON = `scene git.intro "Your first commits"
use git
commit c1 message="first"
branch main
link main c1
step "Commit"
  commit c2 c1 main
  goal exists c2, linked main c2, linked c1 c2
step "Your turn"
  button "Make a commit" commit c3 c2 main
  goal exists c3, count commit = 3`;

function setup() {
  const { pack, diags } = compilePack(GIT_PACK, builtinPacks);
  assert.ok(pack, diags.map((d) => `L${d.line} ${d.msg}`).join('\n'));
  const registry = withPacks(builtinPacks, [pack!]);
  const { scene, diags: d2 } = compile(LESSON, registry);
  assert.ok(scene, d2.map((d) => `L${d.line} ${d.msg}`).join('\n'));
  return { pack: pack!, registry, scene: scene! };
}
const rtFor = (scene: Scene, registry: typeof builtinPacks): Runtime => ({ scene, state: createState(scene, registry), fx: headlessFx(), headless: true, ask: async () => {} });

// ---- pack definitions ---------------------------------------------------------------

test('a pack definition compiles into kinds, icons and macros', () => {
  const { pack } = setup();
  assert.equal(pack.name, 'git');
  assert.equal(pack.about, 'Commits, branches and merges.');
  assert.deepEqual(Object.keys(pack.entities).filter((k) => ['commit', 'branch'].includes(k)), ['commit', 'branch']);
  assert.equal(pack.entities.commit.swatch, 'mustard');
  assert.equal(pack.entities.branch.tier, 0);
  assert.match(pack.icons!.commit, /<circle|<path/);
  assert.ok(pack.verbs!.commit && pack.verbs!.branch, 'macros become verbs');
  assert.ok(pack.verbs!.add && pack.verbs!.point, 'concept building blocks are available too');
  assert.match(pack.vocab, /macro commit ID PARENT BRANCH/);
});

test('pack definition errors are short and fixable', () => {
  const bad = compilePack(`pack net "Clash"
kind thing icon=databse
kind other icon="path:M0 0 L10 10 <script>"
kind ok swatch=neon
macro go X
  teleport X
  add thing Y`, builtinPacks);
  assert.equal(bad.pack, null);
  const msgs = bad.diags.map((d) => `L${d.line} ${d.msg}`).join('\n');
  assert.match(msgs, /L1 .*'net' is a built-in pack/);
  assert.match(msgs, /L2 .*unknown icon 'databse' \(did you mean 'database'\?\)/);
  assert.match(msgs, /L3 .*icon path may only contain/);
  assert.match(msgs, /L4 .*swatch must be one of/);
  assert.match(msgs, /L6 .*unknown action 'teleport'/);
  assert.match(msgs, /L7 .*'Y' is not a parameter of macro go/);
});

// ---- lessons using a data pack ------------------------------------------------------

test('lessons use the pack: entities added later start hidden; macros expand', async () => {
  const { scene, registry } = setup();
  const c2 = scene.entities.find((e) => e.id === 'c2')!;
  assert.equal(c2.hidden, true, 'entities created by add are declared hidden');
  assert.ok(!layoutScene(scene, registry).pos.has('c2'), 'hidden entities are not laid out');
  const report = await simulate(scene, registry);
  assert.deepEqual(report[0].goals.map((g) => g.metAtEnd), [true, true, true]);
  assert.deepEqual(report[1].goals.map((g) => g.metAtEnd), [false, false], 'button actions wait for the learner');
});

test('buttons run their action when pressed and goals react', async () => {
  const { scene, registry } = setup();
  const rt = rtFor(scene, registry);
  for (const a of scene.steps[0].actions) await a.run(rt);
  const btn = scene.steps[1].buttons[0];
  assert.equal(btn.label, 'Make a commit');
  await btn.action.run(rt);
  assert.ok(scene.steps[1].goals.every((g) => g.check(rt)));
});

test('concept building blocks: set/show, remove, connect, point, count, reset', async () => {
  const src = `scene concept.demo "Demo"
use concept
box a label="Server"
box b
store db
link a db
step "s"
  set a status=up
  connect a b
  remove db
  goal a.status = up, linked a b, missing db, count box = 2, a.status != down`;
  const { scene, diags } = compile(src, builtinPacks);
  assert.ok(scene, diags.map((d) => d.msg).join('\n'));
  const rt = rtFor(scene!, builtinPacks);
  const goals = scene!.steps[0].goals;
  assert.deepEqual(goals.map((g) => g.check(rt)), [false, false, false, true, true]);
  for (const a of scene!.steps[0].actions) await a.run(rt);
  assert.ok(goals.every((g) => g.check(rt)));
  resetTransient(rt, builtinPacks);
  assert.deepEqual(goals.map((g) => g.check(rt)), [false, false, false, true, true], 'reset restores the starting graph');
});

test('two concept-family packs in one lesson share one graph', async () => {
  const { registry } = setup();
  const { scene, diags } = compile(`scene git.mix "Mix"
use git, concept
box note1 label="Remember"
commit c1
step "s"
  connect note1 c1
  goal linked note1 c1`, registry);
  assert.ok(scene, diags.map((d) => d.msg).join('\n'));
  const rt = rtFor(scene!, registry);
  for (const a of scene!.steps[0].actions) await a.run(rt);
  assert.equal(scene!.steps[0].goals[0].check(rt), true);
});

test('lesson errors still point at the lesson line', () => {
  const { registry } = setup();
  const r = compile(`scene git.bad "Bad"
use git
commit c1
step "s"
  commit c2 c9 main`, registry);
  assert.match(r.diags.map((d) => `L${d.line} ${d.msg}`).join('\n'), /L5 .*unknown entity 'c9'/);
});

test('role=label kinds sit in the column of what they point at; history flows left to right', () => {
  const { pack, diags } = compilePack(`pack gitl "G"
kind commit icon=circle
kind branch icon=tag tier=0 role=label
kind head icon=flag tier=0 role=label`, builtinPacks);
  assert.ok(pack, diags.map((d) => d.msg).join('\n'));
  assert.equal(pack!.entities.branch.role, 'label');
  const registry = withPacks(builtinPacks, [pack!]);
  const { scene } = compile(`scene gitl.x "X"
use gitl
commit c1
commit c2
commit c3
branch main
head here
link c1 c2
link c2 c3
link main c3
link here main
step "s"
  flash c1`, registry);
  const { pos } = layoutScene(scene!, registry);
  const x = (id: string) => pos.get(id)!.x;
  assert.ok(x('c1') < x('c2') && x('c2') < x('c3'), 'oldest commit on the left');
  assert.equal(x('main'), x('c3'), 'branch label stacks on its commit');
  assert.equal(x('here'), x('c3'), 'HEAD stacks with its branch');
  assert.equal(new Set([...pos.values()].map((p) => `${p.x},${p.y}`)).size, pos.size, 'no overlaps');
  const y = (id: string) => pos.get(id)!.y;
  assert.ok(y('here') < y('main') && y('main') < y('c3'), 'chain stacks in order: HEAD over main over c3');
});
