// Example modules must stay valid, and their button challenges must be solvable.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createState, headlessFx, present } from '../src/core/index.ts';
import type { Runtime } from '../src/core/index.ts';
import { parseModule } from '../src/modules/format.ts';
import { packs } from '../src/packs/index.ts';

const dir = new URL('../examples/modules/', import.meta.url);

for (const file of readdirSync(dir).filter((f) => f.endsWith('.visilearn.json'))) {
  test(`example module ${file} is valid and its button challenges are solvable`, async () => {
    const check = parseModule(readFileSync(new URL(file, dir), 'utf8'), packs);
    assert.deepEqual(check.errors, []);
    for (const l of check.lessons) {
      const rt: Runtime = { scene: l.scene, state: createState(l.scene, check.registry), fx: headlessFx(), headless: true, ask: async () => {} };
      present(rt, check.registry);
      for (const step of l.scene.steps) {
        for (const a of step.actions) await a.run(rt);
        if (!step.buttons.length || !step.goals.length) continue;
        assert.equal(step.goals.every((g) => g.check(rt)), false, `${l.sceneId}: "${step.text}" is not solved before pressing`);
        for (const b of step.buttons) await b.action.run(rt);
        const unmet = step.goals.filter((g) => !g.check(rt)).map((g) => g.label);
        assert.deepEqual(unmet, [], `${l.sceneId}: "${step.text}"`);
      }
    }
  });
}
