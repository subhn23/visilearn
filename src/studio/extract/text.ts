// Markdown / plain text → TextLine[] (same shape as PDF extraction, so sectioning is shared).
import type { TextLine } from './sections.ts';

const LINES_PER_PAGE = 60;
const HEADING_SIZE = [24, 18, 14, 12];

export function textToLines(text: string, filename: string): TextLine[] {
  const md = /\.(md|markdown)$/i.test(filename);
  const out: TextLine[] = [];
  let fence = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    const page = Math.floor(i / LINES_PER_PAGE) + 1;
    const line = raw.trimEnd();
    if (md && /^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (!line.trim()) return;
    const h = md && !fence ? /^(#{1,4})\s+(.+?)\s*#*$/.exec(line) : null;
    if (h) out.push({ text: h[2].trim(), size: HEADING_SIZE[h[1].length - 1], page });
    else out.push({ text: line.trim(), size: 10, page });
  });
  return out;
}
