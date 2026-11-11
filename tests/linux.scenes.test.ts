import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compile, createState, headlessFx, present } from '../src/core/index.ts';
import type { Runtime } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';
import { runCommand } from '../src/packs/linux/index.ts';

/** replay the scripted steps before the challenge, then type the hint's solution */
async function solve(file: string, solution: string[]) {
  const { scene, diags } = compile(readFileSync(new URL(`../scenes/linux/${file}`, import.meta.url), 'utf8'), packs);
  assert.ok(scene, diags.map((d) => d.msg).join('\n'));
  const rt: Runtime = { scene: scene!, state: createState(scene!, packs), fx: headlessFx(), headless: true, ask: async () => {} };
  present(rt, packs);
  const last = scene!.steps.length - 1;
  for (const s of scene!.steps.slice(0, last)) for (const a of s.actions) await a.run(rt);
  const goals = scene!.steps[last].goals;
  assert.ok(goals.length, 'final step is a challenge');
  assert.equal(goals.every((g) => g.check(rt)), false, 'challenge is not already solved');
  for (const cmd of solution) await runCommand(rt, cmd, { learner: true });
  const unmet = goals.filter((g) => !g.check(rt)).map((g) => g.label);
  assert.deepEqual(unmet, []);
}

test('navigate: cd /etc + cat hosts', () => solve('navigate.scene', ['cd /etc', 'cat hosts']));
test('permissions: chmod 644 diary + chmod 700 deploy', () => solve('permissions.scene', ['chmod 644 diary.txt', 'chmod 700 deploy.sh']));
test('pipes: grep to a file, then count ok lines', () => solve('pipes.scene', ["grep 'disk full' app.log > /tmp/disk.txt", 'grep ok app.log | wc -l']));
