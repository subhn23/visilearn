// Dev helper: print the sections found in a PDF.  node tools/dev/pdf-sections.ts file.pdf [level]
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfLines } from '../../src/studio/extract/pdf.ts';
import { splitSections } from '../../src/studio/extract/sections.ts';
const doc = await extractPdfLines(new Uint8Array(readFileSync(process.argv[2])), pdfjs as any);
const maxLevel = Number(process.argv[3] ?? 9);
for (const s of splitSections(doc.lines)) if (s.level <= maxLevel) console.log(`${'  '.repeat(s.level - 1)}L${s.level} p${s.page}-${s.endPage} [${s.text.length}] ${s.title}`);
