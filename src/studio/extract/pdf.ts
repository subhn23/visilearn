// PDF → TextLine[] using pdf.js. The pdf.js module is injected so the same code runs in the
// browser (with a worker) and in Node tests (legacy build).
import type { TextLine } from './sections.ts';

interface PdfTextItem { str: string; transform: number[]; height: number; hasEOL?: boolean }
interface PdfJsLike {
  getDocument(src: { data: Uint8Array; isEvalSupported?: boolean; disableFontFace?: boolean; useSystemFonts?: boolean }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
    }>;
    destroy(): Promise<void>;
  };
}

export interface ExtractedDoc {
  pages: number;
  lines: TextLine[];
}

export async function extractPdfLines(
  data: Uint8Array,
  pdfjs: PdfJsLike,
  onProgress?: (page: number, pages: number) => void,
): Promise<ExtractedDoc> {
  const task = pdfjs.getDocument({ data, isEvalSupported: false, disableFontFace: true, useSystemFonts: false });
  const doc = await task.promise;
  const lines: TextLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const { items } = await page.getTextContent();
      let text = '';
      let size = 0;
      let lastY: number | null = null;
      const push = () => {
        const t = text.replace(/\s+/g, ' ').trim();
        if (t) lines.push({ text: t, size: Math.round(size * 10) / 10, page: p });
        text = '';
        size = 0;
      };
      for (const raw of items) {
        const it = raw as PdfTextItem;
        if (typeof it.str !== 'string') continue;
        const y = it.transform[5];
        const h = it.height || Math.hypot(it.transform[2], it.transform[3]);
        if (lastY !== null && Math.abs(y - lastY) > Math.max(h, size) * 0.5) push();
        if (it.str.trim()) { text += (text && !text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str; size = Math.max(size, h); }
        lastY = y;
        if (it.hasEOL) { push(); lastY = null; }
      }
      push();
      page.cleanup();
      onProgress?.(p, doc.numPages);
    }
  } finally {
    await task.destroy();
  }
  return { pages: doc.numPages, lines };
}
