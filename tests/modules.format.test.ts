import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModule, MODULE_LIMITS, MODULE_VERSION, parseModule, sceneKey, serializeModule, splitSceneKey, validateModule } from '../src/modules/format.ts';
import { packs } from '../src/packs/index.ts';

const LESSON_A = `scene net.hello "Hello network"
use net
host a
server b port=80
link a b
step "Say hi"
  a send b:80`;
const LESSON_B = `scene linux.hello "Hello shell"
use linux
fs as=asha
  home/
    asha/
step "Where am I?"
  run pwd`;

const make = () => createModule({ title: 'Starter pack', author: 'Asha', track: 'net', tags: ['intro'], scenes: [LESSON_A, LESSON_B] }, { id: 'starter-pack-abc123', now: 1000 });

test('createModule fills the envelope', () => {
  const m = make();
  assert.equal(m.format, 'visilearn.module');
  assert.equal(m.version, 1);
  assert.equal(m.id, 'starter-pack-abc123');
  assert.equal(m.created, new Date(1000).toISOString());
  assert.deepEqual(m.scenes.map((s) => s.source), [LESSON_A, LESSON_B]);
  assert.match(createModule({ title: 'Git: The Basics!', scenes: [LESSON_A] }).id, /^git-the-basics-[a-z0-9]{6}$/);
});

test('a valid module round-trips through serialize/parse', () => {
  const m = make();
  const r = parseModule(serializeModule(m), packs);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.module, m);
  assert.deepEqual(r.lessons.map((l) => [l.sceneId, l.title, l.steps]), [['net.hello', 'Hello network', 1], ['linux.hello', 'Hello shell', 1]]);
});

test('shape errors are reported in plain language', () => {
  assert.match(parseModule('not json', packs).errors[0], /not a valid module file/i);
  assert.match(validateModule({ hello: 1 }, packs).errors[0], /not a visilearn module/i);
  const newer = { ...make(), version: MODULE_VERSION + 1 };
  assert.match(validateModule(newer, packs).errors[0], /newer version of visilearn/);
  const noTitle = { ...make(), title: '  ' };
  assert.ok(validateModule(noTitle, packs).errors.some((e) => /title/.test(e)));
  const badId = { ...make(), id: 'Bad ID!' };
  assert.ok(validateModule(badId, packs).errors.some((e) => /id/.test(e)));
  const empty = { ...make(), scenes: [] };
  assert.ok(validateModule(empty, packs).errors.some((e) => /at least one lesson/.test(e)));
});

test('every lesson must compile; errors name the lesson and line', () => {
  const broken = { ...make(), scenes: [{ source: LESSON_A }, { source: LESSON_B.replace('run pwd', 'run sl') }] };
  const r = validateModule(broken, packs);
  assert.equal(r.module, null);
  assert.ok(r.errors.some((e) => /^Lesson 2 \(linux\.hello\): L7 unknown command 'sl'/.test(e)), r.errors.join('\n'));
});

test('lesson ids must be unique within a module', () => {
  const dup = { ...make(), scenes: [{ source: LESSON_A }, { source: LESSON_A }] };
  assert.ok(validateModule(dup, packs).errors.some((e) => /duplicate lesson id 'net.hello'/.test(e)));
});

test('size limits protect the app', () => {
  const many = { ...make(), scenes: Array.from({ length: MODULE_LIMITS.maxScenes + 1 }, (_, i) => ({ source: LESSON_A.replace('net.hello', `net.h${i}`) })) };
  assert.ok(validateModule(many, packs).errors.some((e) => /at most/.test(e)));
  const huge = { ...make(), description: 'x'.repeat(MODULE_LIMITS.maxBytes) };
  assert.ok(validateModule(huge, packs).errors.some((e) => /too large/.test(e)));
});

test('unknown extra fields are ignored but kept out of the result', () => {
  const r = validateModule({ ...make(), evil: '<script>' }, packs);
  assert.deepEqual(r.errors, []);
  assert.equal((r.module as any).evil, undefined);
});

test('scene keys namespace module lessons', () => {
  assert.equal(sceneKey('starter-pack-abc123', 'net.hello'), 'm:starter-pack-abc123/net.hello');
  assert.deepEqual(splitSceneKey('m:starter-pack-abc123/net.hello'), { moduleId: 'starter-pack-abc123', sceneId: 'net.hello' });
  assert.equal(splitSceneKey('net.firewall'), null);
});

test('docs/MODULES.md specifies the current format version and every field', async () => {
  const { readFileSync } = await import('node:fs');
  const doc = readFileSync(new URL('../docs/MODULES.md', import.meta.url), 'utf8');
  assert.match(doc, new RegExp(`Module format version: ${MODULE_VERSION}\\b`));
  for (const key of [...Object.keys(make()), 'packs']) assert.ok(doc.includes(`\`${key}\``), `MODULES.md is missing field \`${key}\``);
  assert.match(doc, /#\/import\//, 'share-link scheme documented');
});

test('modules can carry their own packs; such modules are format version 2', async () => {
  const { GIT_PACK } = await import('./packdef.test.ts');
  const lesson = `scene git.one "One"
use git
commit c1
step "s"
  flash c1 ok`;
  const m = createModule({ title: 'Git', packs: [GIT_PACK], scenes: [lesson] }, { id: 'git-mod-0001', now: 1 });
  assert.equal(m.version, 2);
  const r = validateModule(m, packs);
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.packs.map((p) => p.name), ['git']);
  assert.ok(r.registry.git, 'module registry includes its packs');
  // without the pack, the lesson cannot compile
  const r2 = validateModule({ ...m, packs: [] }, packs);
  assert.ok(r2.errors.some((e) => /unknown pack 'git'/.test(e)));
  // pack problems are reported with the pack's position
  const r3 = validateModule({ ...m, packs: [{ source: 'pack linux "x"' }] }, packs);
  assert.ok(r3.errors.some((e) => /^Pack 1 \(linux\): L1 .*built-in/.test(e)), r3.errors.join('\n'));
  const r4 = validateModule({ ...m, packs: [{ source: GIT_PACK }, { source: GIT_PACK }] }, packs);
  assert.ok(r4.errors.some((e) => /duplicate pack 'git'/.test(e)));
});
