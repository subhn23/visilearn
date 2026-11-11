// Validate + simulate every scene:  npm run check   (add -v for a step-by-step report)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { compile, simulate } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.scene') ? [p] : [];
  });
}

const verbose = process.argv.includes('-v');
let failed = 0;
for (const file of walk('scenes')) {
  const { scene, diags } = compile(readFileSync(file, 'utf8'), packs);
  for (const d of diags) console.log(`${file}:${d.line} ${d.severity}: ${d.msg}`);
  if (!scene) { failed++; continue; }
  const report = await simulate(scene, packs);
  console.log(`✓ ${file}  (${scene.entities.length} entities, ${scene.steps.length} steps)`);
  if (verbose) for (const r of report) {
    console.log(`  step ${r.index + 1}: ${r.text}`);
    for (const l of r.log) console.log(`    ${l.msg}`);
    for (const g of r.goals) console.log(`    goal ${g.metAtEnd ? '✓' : '·'} ${g.label}`);
  }
}
process.exit(failed ? 1 : 0);
