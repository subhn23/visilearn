import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compile, createState, headlessFx, simulate } from '../src/core/index.ts';
import type { Runtime } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';
import { parseRule } from '../src/packs/net/sim.ts';
import type { NetState } from '../src/packs/net/sim.ts';

const load = (f: string) => readFileSync(new URL(`../scenes/${f}`, import.meta.url), 'utf8');

test('every scene compiles without errors', () => {
  for (const dir of readdirSync(new URL('../scenes', import.meta.url))) {
    for (const f of readdirSync(new URL(`../scenes/${dir}`, import.meta.url))) {
      const { scene, diags } = compile(load(`${dir}/${f}`), packs);
      assert.ok(scene, `${dir}/${f}: ${diags.map((d) => `L${d.line} ${d.msg}`).join('; ')}`);
    }
  }
});

test('firewall challenge: unmet at start, solvable by adding one rule', () => {
  const { scene } = compile(load('net/firewall.scene'), packs);
  const rt: Runtime = { scene: scene!, state: createState(scene!, packs), fx: headlessFx(), headless: true, ask: async () => {} };
  const goals = scene!.steps[2].goals;
  assert.equal(goals.length, 3);
  assert.equal(goals.every((g) => g.check(rt)), false);

  const st = rt.state.net as NetState;
  const rule = parseRule('allow tcp:22 from laptop to web', () => true).rule!;
  st.rules.edge.rules.unshift(rule);
  assert.equal(goals.every((g) => g.check(rt)), true);

  // a too-broad rule must not pass the challenge
  st.rules.edge.rules[0] = parseRule('allow tcp:22', () => true).rule!;
  assert.equal(goals.every((g) => g.check(rt)), false);
});

test('router failure makes the internet unreachable but the LAN still works', async () => {
  const { scene } = compile(load('net/lan-basics.scene'), packs);
  const report = await simulate(scene!, packs);
  const step3 = report[2].log.map((l) => l.msg).join('\n');
  assert.match(step3, /site 443 .*unreachable/);
  assert.match(step3, /pc2 ping delivered/);
});

test('validator gives short, fixable errors', () => {
  const { scene, diags } = compile(`scene net.x "X"
use net
host a
servr b
link a b
step "s"
  a sendd b:80
  goal a->b:80 maybe`, packs);
  assert.equal(scene, null);
  const msgs = diags.map((d) => `L${d.line} ${d.msg}`).join('\n');
  assert.match(msgs, /L4 unknown statement 'servr' \(did you mean 'server'\?\)/);
  assert.match(msgs, /did you mean 'send'/);
  assert.match(msgs, /can't understand goal/);
});

test('ask answers can be given by text or number', () => {
  const src = (ans: string) => `scene net.q "Q"\nuse net\nhost a\nstep "s"\n  ask "?" x|y|z answer=${ans}`;
  assert.equal(compile(src('y'), packs).scene!.steps[0].asks[0].answer, 1);
  assert.equal(compile(src('3'), packs).scene!.steps[0].asks[0].answer, 2);
  assert.equal(compile(src('w'), packs).scene, null);
});
