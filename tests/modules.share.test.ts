import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createModule } from '../src/modules/format.ts';
import { decodeShare, encodeShare, SHARE_LIMIT, shareUrl } from '../src/modules/share.ts';
import { packs } from '../src/packs/index.ts';

const LESSON = `scene net.hello "Hello network"
use net
host a
server b port=80
link a b
step "Say hi"
  a send b:80`;
const mod = createModule({ title: 'Tiny', scenes: [LESSON] }, { id: 'tiny-000001', now: 5 });

test('a module survives the share-link round trip', async () => {
  const enc = await encodeShare(mod);
  assert.equal(enc.tooLarge, false);
  assert.match(enc.payload, /^[A-Za-z0-9_-]+$/, 'URL-safe characters only');
  assert.ok(enc.payload.length < JSON.stringify(mod).length, 'compressed');
  const dec = await decodeShare(enc.payload, packs);
  assert.deepEqual(dec.errors, []);
  assert.deepEqual(dec.module, mod);
});

test('share URLs put the payload in the fragment (never sent to a server)', () => {
  assert.equal(shareUrl('https://visilearn.web.app/', 'abc'), 'https://visilearn.web.app/#/import/abc');
  assert.equal(shareUrl('http://localhost:5173/#/s/net.firewall', 'abc'), 'http://localhost:5173/#/import/abc');
});

test('damaged links are rejected with a friendly message', async () => {
  const enc = await encodeShare(mod);
  const r = await decodeShare(enc.payload.slice(0, -10) + 'AAAAAAAAAA', packs);
  assert.equal(r.module, null);
  assert.match(r.errors[0], /link is damaged or incomplete/);
  assert.match((await decodeShare('!!!', packs)).errors[0], /link is damaged or incomplete/);
});

test('modules too big for a link are flagged (share as a file instead)', async () => {
  // incompressible text makes a payload larger than the limit
  const bytes = crypto.getRandomValues(new Uint8Array(SHARE_LIMIT));
  const noise = [...bytes].map((b) => String.fromCharCode(33 + (b % 90))).join('');
  const big = { ...mod, description: noise };
  const enc = await encodeShare(big);
  assert.equal(enc.tooLarge, true);
});
