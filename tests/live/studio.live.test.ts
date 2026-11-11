// Live Studio run: local Ollama model + a sample book → pack, outline, lesson, module.
//   npm run test:live        (needs Ollama and pdfs/GitNotesForProfessionals.pdf; skipped otherwise)
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProvider } from '../../src/ai/providers.ts';
import { serializeModule } from '../../src/modules/format.ts';
import { builtinPacks } from '../../src/packs/index.ts';
import { extractPdfLines } from '../../src/studio/extract/pdf.ts';
import { groupChapters, splitSections } from '../../src/studio/extract/sections.ts';
import { assembleModule, generateLesson, generateOutline, generatePack } from '../../src/studio/pipeline.ts';
import type { StudioEvent } from '../../src/studio/pipeline.ts';

const BASE = process.env.OLLAMA_URL ?? 'http://localhost:11434';
const BOOK = new URL('../../pdfs/GitNotesForProfessionals.pdf', import.meta.url);
let installed: string[] = [];
try {
  const r = await fetch(`${BASE}/api/tags`, { signal: AbortSignal.timeout(1500) });
  installed = ((await r.json()) as { models: { name: string }[] }).models.map((m) => m.name);
} catch { /* no Ollama */ }
const model = process.env.OLLAMA_MODEL ?? installed.find((m) => /gemma/.test(m)) ?? installed[0];
const skip = (!model && 'no local Ollama') || (!existsSync(BOOK) && 'sample book not present');

test('live studio: Git book → pack → outline → lesson → module', { skip, timeout: 1_800_000 }, async () => {
  const doc = await extractPdfLines(new Uint8Array(readFileSync(BOOK)), pdfjs);
  const chapters = groupChapters(splitSections(doc.lines)).filter((c) => /Getting started with Git|^Chapter \d+: Branching/.test(c.title));
  const sections = chapters.flatMap((c) => c.sections);
  assert.ok(sections.length >= 4, `selected ${sections.length} sections`);

  const provider = createProvider({ id: 'live', kind: 'ollama', label: 'Ollama', baseUrl: BASE, model: model! });
  const log: string[] = [];
  const t0 = performance.now();
  const stamp = () => `${((performance.now() - t0) / 1000).toFixed(0)}s`;
  const deps = {
    chat: provider.chat,
    registry: builtinPacks,
    onEvent: (e: StudioEvent) => {
      if (e.type === 'status' || e.type === 'attempt') log.push(`${stamp()} ${e.message}`);
      if (e.type === 'problem') log.push(`${stamp()} ${e.message}\n    ${e.errors.slice(0, 5).join('\n    ')}`);
    },
  };

  const pack = await generatePack(deps, { topic: 'Git', sections });
  console.log(log.splice(0).join('\n'));
  assert.ok(pack.pack, `pack failed after ${pack.attempts} attempts:\n${pack.errors.join('\n')}\n${pack.source}`);
  console.log(`--- pack (${pack.attempts} attempt(s)):\n${pack.source}`);

  const outline = await generateOutline(deps, { topic: 'Git', sections, packVocab: pack.pack!.vocab, maxLessons: 2 });
  console.log(log.splice(0).join('\n'));
  console.log(`--- outline:\n${outline.map((o) => `- ${o.title}: ${o.about} [${o.sections.join(',')}]`).join('\n')}`);
  assert.ok(outline.length >= 1);

  const lesson = await generateLesson(deps, { item: outline[0], sections, packs: [pack.pack!] });
  console.log(log.splice(0).join('\n'));
  console.log(`--- lesson (${lesson.attempts} attempt(s)):\n${lesson.source}`);
  assert.ok(lesson.scene, `lesson failed:\n${lesson.errors.join('\n')}`);

  const m = assembleModule({ title: 'Git (Studio, live test)', author: model, packSources: [pack.source], lessonSources: [lesson.source], sources: [{ title: 'Git Notes for Professionals', pages: `pp. ${sections[0].page}-${sections[sections.length - 1].endPage}`, license: 'CC BY-SA 4.0' }] }, builtinPacks);
  assert.deepEqual(m.errors, []);
  const out = join(mkdtempSync(join(tmpdir(), 'visilearn-studio-')), 'git-studio.visilearn.json');
  writeFileSync(out, serializeModule(m.module!));
  console.log(`--- module written to ${out} in ${stamp()}`);
});
