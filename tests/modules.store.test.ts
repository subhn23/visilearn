import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModule } from '../src/modules/format.ts';
import { createModuleStore, memoryKV } from '../src/modules/store.ts';

const LESSON = (id: string) => `scene net.${id} "L ${id}"
use net
host a
step "s"
  a ping a`;
const mod = (id: string, title = id) => createModule({ title, scenes: [LESSON('x')] }, { id, now: 1 });

test('save, get, list (newest first) and remove', async () => {
  let t = 100;
  const store = createModuleStore(memoryKV(), () => t);
  await store.save(mod('first-00001'));
  t = 200;
  await store.save(mod('second-0001'));
  assert.deepEqual((await store.list()).map((m) => m.id), ['second-0001', 'first-00001']);
  assert.equal((await store.get('first-00001'))!.title, 'first-00001');
  await store.remove('first-00001');
  assert.equal(await store.get('first-00001'), null);
  assert.deepEqual((await store.list()).map((m) => m.id), ['second-0001']);
});

test('saving again updates the module but keeps when it was first added', async () => {
  let t = 100;
  const store = createModuleStore(memoryKV(), () => t);
  await store.save(mod('same-000001', 'v1'));
  t = 300;
  await store.save(mod('same-000001', 'v2'));
  const all = await store.list();
  assert.equal(all.length, 1);
  assert.equal(all[0].title, 'v2');
  assert.equal(all[0].added, new Date(100).toISOString());
  assert.equal(all[0].saved, new Date(300).toISOString());
});

test('has() tells the import screen whether it would replace a module', async () => {
  const store = createModuleStore(memoryKV());
  assert.equal(await store.has('x-00000001'), false);
  await store.save(mod('x-00000001'));
  assert.equal(await store.has('x-00000001'), true);
});

test('a broken backend does not crash the app', async () => {
  const broken = { get: async () => { throw new Error('denied'); }, set: async () => { throw new Error('denied'); }, del: async () => { throw new Error('denied'); }, keys: async () => { throw new Error('denied'); } };
  const store = createModuleStore(broken);
  assert.deepEqual(await store.list(), []);
  await assert.rejects(store.save(mod('y-00000001')), /could not be saved/);
});
