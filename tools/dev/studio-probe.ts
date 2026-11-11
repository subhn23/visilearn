// Dev probe: run ONE Studio stage against local Ollama and stream what the model does.
//   node tools/dev/studio-probe.ts [maxTokens]
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProvider } from '../../src/ai/providers.ts';
import { builtinPacks } from '../../src/packs/index.ts';
import { extractPdfLines } from '../../src/studio/extract/pdf.ts';
import { groupChapters, splitSections } from '../../src/studio/extract/sections.ts';
import { generatePack } from '../../src/studio/pipeline.ts';

const doc = await extractPdfLines(new Uint8Array(readFileSync('pdfs/GitNotesForProfessionals.pdf')), pdfjs as never);
const sections = groupChapters(splitSections(doc.lines)).filter((c) => /Getting started with Git|^Chapter \d+: Branching/.test(c.title)).flatMap((c) => c.sections);
const p = createProvider({ id: 'p', kind: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', model: process.env.OLLAMA_MODEL ?? 'gemma4:12b' });
const t0 = performance.now();
let think = 0, write = 0, last = 0;
const tick = () => { const now = performance.now(); if (now - last > 5000) { last = now; console.log(`${((now - t0) / 1000).toFixed(0)}s thinking=${think} writing=${write}`); } };
const r = await generatePack({
  chat: (req) => p.chat({ ...req, maxTokens: Number(process.argv[2] ?? 4000) }),
  registry: builtinPacks,
  maxRepairs: 1,
  onEvent: (e) => {
    if (e.type === 'thinking') { think = e.chars; tick(); } else if (e.type === 'writing') { write = e.chars; tick(); }
    else console.log(`${((performance.now() - t0) / 1000).toFixed(0)}s ${'message' in e ? e.message : ''} ${'errors' in e ? e.errors.join(' | ') : ''}`);
  },
}, { topic: 'Git', sections });
console.log(`done in ${((performance.now() - t0) / 1000).toFixed(0)}s, attempts ${r.attempts}, ok=${!!r.pack}`);
console.log(r.source);
console.log(r.errors.join('\n'));
