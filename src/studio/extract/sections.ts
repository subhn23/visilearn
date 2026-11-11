// Split extracted document text into sections (chapters/headings) with page references.
// DOM-free and format-agnostic: PDF, DOCX and Markdown extractors all produce TextLine[].

export interface TextLine {
  text: string;
  /** font size (or heading weight for formats without sizes) */
  size: number;
  page: number;
}

export interface Section {
  title: string;
  /** 1 = top-level heading */
  level: number;
  page: number;
  endPage: number;
  text: string;
}

const round = (n: number) => Math.round(n * 2) / 2;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

/**
 * Running headers/footers and bare page numbers. A line counts as boilerplate when the exact
 * text repeats on >30% of pages, or, if it is the first/last line of its page, when it repeats
 * with only numbers changed ("Page 3 of 10").
 */
function dropBoilerplate(lines: TextLine[]): TextLine[] {
  const pages = new Set(lines.map((l) => l.page)).size;
  const bodySize = median(lines.map((l) => round(l.size)));
  const exact = (t: string) => t.trim().toLowerCase();
  const loose = (t: string) => exact(t).replace(/\d+/g, '#');
  const count = (key: (t: string) => string, subset: TextLine[]) => {
    const m = new Map<string, Set<number>>();
    for (const l of subset) { const k = key(l.text); (m.get(k) ?? m.set(k, new Set()).get(k)!).add(l.page); }
    return m;
  };
  const edges = new Set<TextLine>();
  const byPage = new Map<number, TextLine[]>();
  for (const l of lines) (byPage.get(l.page) ?? byPage.set(l.page, []).get(l.page)!).push(l);
  for (const pl of byPage.values()) { edges.add(pl[0]); edges.add(pl[pl.length - 1]); }
  const exactPages = count(exact, lines);
  const loosePages = count(loose, [...edges]);
  const frequent = (n: number | undefined) => pages >= 4 && (n ?? 0) / pages > 0.3;
  return lines.filter((l) => {
    const t = l.text.trim();
    if (!t || /^\d{1,4}$/.test(t)) return false;
    if (frequent(exactPages.get(exact(t))?.size)) return false;
    // number-insensitive matching only for body-size text, so "Chapter 2: …" headings survive
    return !(edges.has(l) && round(l.size) < bodySize * 1.2 && frequent(loosePages.get(loose(t))?.size));
  });
}

export function splitSections(input: TextLine[], opts: { pagesPerChunk?: number; maxLevels?: number } = {}): Section[] {
  const lines = dropBoilerplate(input);
  if (!lines.length) return [];
  const body = median(lines.map((l) => round(l.size)));
  const dotLeader = (t: string) => /\.{5,}\s*\d*\s*$/.test(t) || /\.{5,}/.test(t);
  const isHeading = (l: TextLine) => round(l.size) >= body * 1.2 && l.text.trim().length <= 120 && !dotLeader(l.text);
  // heading levels come from sizes that repeat (chapters, sections), not one-off cover text
  const counts = new Map<number, number>();
  for (const l of lines) if (isHeading(l)) counts.set(round(l.size), (counts.get(round(l.size)) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n >= 3).map(([sz]) => sz);
  const headingSizes = (repeated.length ? repeated : [...counts.keys()]).sort((a, b) => b - a);
  // only sizes used for real headings start a section; one-off big text (cover pages) stays as text
  const startsSection = (l: TextLine) => isHeading(l) && headingSizes.includes(round(l.size));
  if (!headingSizes.length) {
    const n = opts.pagesPerChunk ?? 8;
    const first = lines[0].page;
    const last = lines[lines.length - 1].page;
    const out: Section[] = [];
    for (let p = first; p <= last; p += n) {
      const end = Math.min(p + n - 1, last);
      const chunk = lines.filter((l) => l.page >= p && l.page <= end);
      if (chunk.length) out.push({ title: `Pages ${p}–${end}`, level: 1, page: p, endPage: end, text: chunk.map((l) => l.text.trim()).join('\n') });
    }
    return out;
  }

  const maxLevels = opts.maxLevels ?? 3;
  const levelOf = (size: number) => {
    const sz = round(size);
    const i = headingSizes.indexOf(sz);
    if (i >= 0) return Math.min(i + 1, maxLevels);
    const below = headingSizes.findIndex((h) => h < sz); // rare size: level of the next smaller repeated size
    return below <= 0 ? 1 : Math.min(below + 1, maxLevels);
  };
  const out: Section[] = [];
  let cur: Section | null = null;
  let lastHeadingSize = 0;
  const buf: string[] = [];
  const flush = () => {
    if (cur) { cur.text = buf.join('\n'); out.push(cur); }
    buf.length = 0;
  };
  for (const l of lines) {
    if (startsSection(l)) {
      // a heading wrapped onto the next line: same size, same page, nothing in between
      if (cur && !buf.length && cur.page === l.page && levelOf(l.size) === cur.level && lastHeadingSize === round(l.size)) {
        cur.title += ' ' + l.text.trim();
        continue;
      }
      lastHeadingSize = round(l.size);
      if (!cur && buf.length) { cur = { title: '(front matter)', level: 1, page: lines[0].page, endPage: lines[0].page, text: '' }; }
      flush();
      cur = { title: l.text.trim(), level: levelOf(l.size), page: l.page, endPage: l.page, text: '' };
    } else {
      if (!cur && !buf.length) cur = null;
      buf.push(l.text.trim());
      if (cur) cur.endPage = l.page;
      else if (!out.length) { /* front matter accumulates until the first heading */ }
    }
  }
  if (!cur && buf.length) cur = { title: '(front matter)', level: 1, page: lines[0].page, endPage: lines[lines.length - 1].page, text: '' };
  flush();
  return out;
}

export interface Chapter {
  title: string;
  page: number;
  endPage: number;
  /** the chapter heading section followed by its sub-sections */
  sections: Section[];
}

/** Group a flat section list into chapters (each level-1 section and everything under it). */
export function groupChapters(sections: Section[]): Chapter[] {
  const out: Chapter[] = [];
  for (const s of sections) {
    if (s.level === 1 || !out.length) out.push({ title: s.title, page: s.page, endPage: s.endPage, sections: [s] });
    else {
      const c = out[out.length - 1];
      c.sections.push(s);
      c.endPage = Math.max(c.endPage, s.endPage);
    }
  }
  return out;
}
