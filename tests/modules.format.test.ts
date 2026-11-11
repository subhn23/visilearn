import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModule, MODULE_LIMITS, parseModule, sceneKey, serializeModule, splitSceneKey, validateModule } from '../src/modules/format.ts';
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
  const newer = { ...make(), version: 2 };
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
