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
const gitModule = createModule({
  title: 'Git basics',
  description: 'Commits and branches, shown the way Git really stores them. Carries its own "git" pack.',
  author: 'visilearn',
  track: 'concept',
  tags: ['git', 'sample', 'data-pack'],
  sources: [{ title: 'Git Notes for Professionals (GoalKicker.com)', pages: 'ch. 1, 4, 5', license: 'CC BY-SA 4.0 (concepts paraphrased)' }],
  packs: [readFileSync(new URL('../examples/packs/git.pack', import.meta.url), 'utf8')],
  scenes: ['commits', 'branches'].map((n) => readFileSync(new URL(`../examples/lessons/git/${n}.scene`, import.meta.url), 'utf8')),
}, { id: 'visilearn-git-basics', now: Date.UTC(2026, 10, 11) });
const gitCheck = validateModule(gitModule, packs);
if (!gitCheck.module) { console.error(gitCheck.errors.join('\n')); process.exit(1); }
writeFileSync(new URL('../examples/modules/git-basics.visilearn.json', import.meta.url), serializeModule(gitModule));
console.log(`wrote examples/modules/git-basics.visilearn.json (${gitCheck.lessons.length} lessons, packs: ${gitCheck.packs.map((p) => p.name).join(', ')})`);
for (const w of gitCheck.warnings) console.log('  warning:', w);

const check = validateModule(m, packs);
if (!check.module) { console.error(check.errors.join('\n')); process.exit(1); }
writeFileSync(new URL('../examples/modules/starter.visilearn.json', import.meta.url), serializeModule(m));
console.log(`wrote examples/modules/starter.visilearn.json (${check.lessons.length} lessons)`);
