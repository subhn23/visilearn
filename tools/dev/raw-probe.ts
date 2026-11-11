// Dev probe: raw model output for the pack prompt (to see how structured output misbehaves).
//   node tools/dev/raw-probe.ts [schema|noschema]
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createProvider } from '../../src/ai/providers.ts';
import { extractPdfLines } from '../../src/studio/extract/pdf.ts';
import { groupChapters, splitSections } from '../../src/studio/extract/sections.ts';
import { digest } from '../../src/studio/pipeline.ts';
import { PACK_SYSTEM } from '../../src/studio/prompts.ts';
import { PACK_SCHEMA } from '../../src/studio/specs.ts';

const doc = await extractPdfLines(new Uint8Array(readFileSync('pdfs/GitNotesForProfessionals.pdf')), pdfjs as never);
const sections = groupChapters(splitSections(doc.lines)).filter((c) => /Getting started with Git|^Chapter \d+: Branching/.test(c.title)).flatMap((c) => c.sections);
const p = createProvider({ id: 'p', kind: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', model: process.env.OLLAMA_MODEL ?? 'gemma4:12b' });
const useSchema = process.argv[2] !== 'noschema';
const r = await p.chat({
  messages: [{ role: 'system', content: PACK_SYSTEM }, { role: 'user', content: `Topic: Git\n\nSource sections:\n${digest(sections)}\n\nDesign the pack as JSON.` }],
  ...(useSchema ? { schema: PACK_SCHEMA } : {}), temperature: 0.3, numCtx: 8192, maxTokens: 1500,
}).catch((e) => ({ text: `ERROR ${e.message}`, ms: 0 }));
console.log(`(${r.ms} ms) ${r.text.length} chars:\n${r.text.slice(0, 1500)}\n…\n${r.text.slice(-300)}`);
