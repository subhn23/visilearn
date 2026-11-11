// Builds examples/modules/starter.visilearn.json from built-in lessons (a sample for import).
import { readFileSync, writeFileSync } from 'node:fs';
import { createModule, serializeModule, validateModule } from '../src/modules/format.ts';
import { packs } from '../src/packs/index.ts';

const read = (f: string) => readFileSync(new URL(`../scenes/${f}`, import.meta.url), 'utf8');
const m = createModule({
  title: 'Starter: networks & the shell',
  description: 'A sample module bundling two built-in lessons. Import it to try modules.',
  author: 'visilearn',
  track: 'net',
  tags: ['sample', 'starter'],
  sources: [{ title: 'visilearn built-in lessons', license: 'same as the project' }],
  scenes: [read('net/ports.scene'), read('linux/navigate.scene')],
}, { id: 'visilearn-starter-sample', now: Date.UTC(2026, 10, 11) });
const check = validateModule(m, packs);
if (!check.module) { console.error(check.errors.join('\n')); process.exit(1); }
writeFileSync(new URL('../examples/modules/starter.visilearn.json', import.meta.url), serializeModule(m));
console.log(`wrote examples/modules/starter.visilearn.json (${check.lessons.length} lessons)`);
