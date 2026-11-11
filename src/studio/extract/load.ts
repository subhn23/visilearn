// Browser file loading for the Studio. pdf.js (and its worker) load lazily, only when a PDF is opened.
import { extractPdfLines } from './pdf.ts';
import { groupChapters, splitSections } from './sections.ts';
import type { Chapter, TextLine } from './sections.ts';
import { textToLines } from './text.ts';

export interface LoadedFile {
  name: string;
  pages: number;
  chapters: Chapter[];
}

export const ACCEPT = '.pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain';

export async function loadFile(file: File, onProgress?: (done: number, total: number) => void): Promise<LoadedFile> {
  let lines: TextLine[];
  let pages: number;
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    const doc = await extractPdfLines(new Uint8Array(await file.arrayBuffer()), pdfjs as never, onProgress);
    lines = doc.lines;
    pages = doc.pages;
  } else if (/\.(md|markdown|txt)$/i.test(file.name) || file.type.startsWith('text/')) {
    lines = textToLines(await file.text(), file.name);
    pages = lines.length ? lines[lines.length - 1].page : 0;
  } else {
    throw new Error(`Unsupported file type: ${file.name}. Use PDF, Markdown or plain text.`);
  }
  const chapters = groupChapters(splitSections(lines)).filter((c) => c.sections.some((s) => s.text.trim().length > 20 || s.title));
  if (!chapters.length) throw new Error('No readable text found (scanned PDFs need OCR first).');
  return { name: file.name, pages, chapters };
}
