import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';
import { buildPacket, labEndpoints } from '../src/packs/net/model/packetLab.ts';

const { scene } = compile(`scene net.t "T"
use net
host a
internet i
fw f
switch s
router r
server b port=80
link a f s r b
link i f
step "x"
  a ping b`, packs);

test('endpoints exclude infrastructure (fw, switch, router)', () => {
  assert.deepEqual(labEndpoints(scene!).map((e) => e.id), ['a', 'i', 'b']);
});

test('buildPacket validates input and builds tcp/udp/icmp packets', () => {
  assert.deepEqual(buildPacket({ from: 'a', to: 'b', proto: 'tcp', port: '80' }), { packet: { src: 'a', dst: 'b', proto: 'tcp', port: 80 } });
  assert.deepEqual(buildPacket({ from: 'a', to: 'b', proto: 'icmp', port: 'junk' }), { packet: { src: 'a', dst: 'b', proto: 'icmp', port: null } });
  assert.match(buildPacket({ from: 'a', to: 'a', proto: 'tcp', port: '80' }).error!, /different/);
  assert.match(buildPacket({ from: 'a', to: 'b', proto: 'udp', port: '70000' }).error!, /1-65535/);
  assert.match(buildPacket({ from: 'a', to: 'b', proto: 'tcp', port: '' }).error!, /1-65535/);
});
