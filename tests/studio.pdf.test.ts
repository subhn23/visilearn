// Real-document tests against the sample books in pdfs/ (git-ignored; skipped when absent).
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractPdfLines } from '../src/studio/extract/pdf.ts';
import { splitSections } from '../src/studio/extract/sections.ts';

const file = (name: string) => new URL(`../pdfs/${name}`, import.meta.url);
const books = [
  { name: 'GitNotesForProfessionals.pdf', first: /Getting started with Git/ },
  { name: 'PostgreSQLNotesForProfessionals.pdf', first: /Getting started with PostgreSQL/ },
];

for (const book of books) {
  const present = existsSync(file(book.name));
  test(`extracts chapters from ${book.name}`, { skip: !present && 'sample PDF not present', timeout: 60_000 }, async () => {
    const data = new Uint8Array(readFileSync(file(book.name)));
    const t0 = performance.now();
    const doc = await extractPdfLines(data, pdfjs);
    const ms = performance.now() - t0;
    assert.ok(doc.pages > 50, `pages: ${doc.pages}`);
    assert.ok(doc.lines.length > 1000);

    const sections = splitSections(doc.lines);
    const chapters = sections.filter((s) => s.level === 1);
    assert.ok(chapters.length >= 20, `chapters: ${chapters.length}`);
    assert.ok(chapters.some((c) => book.first.test(c.title)), chapters.slice(0, 5).map((c) => c.title).join(' | '));

    // pages are monotonic and every chapter has real content
    for (let i = 1; i < sections.length; i++) assert.ok(sections[i].page >= sections[i - 1].page);
    // leaf sections (no deeper section follows) must carry text; parents may only hold sub-sections
    const leaves = sections.filter((s, i) => !(sections[i + 1] && sections[i + 1].level > s.level));
    const withText = leaves.filter((s) => s.text.length > 40).length;
    assert.ok(withText / leaves.length > 0.85, `leaf sections with text: ${withText}/${leaves.length}`);
    // wrapped chapter titles are joined
    assert.ok(!chapters.some((c) => /,\s*and$/.test(c.title)), 'no half titles');

    // running footer ("GoalKicker.com – … Notes for Professionals") is stripped
    const leaky = sections.filter((s) => /Notes for Professionals\s*\d*$/m.test(s.text)).length;
    assert.ok(leaky / sections.length < 0.05, `footer leaked into ${leaky} sections`);
    console.log(`  ${book.name}: ${doc.pages} pages, ${sections.length} sections (${chapters.length} chapters) in ${Math.round(ms)} ms`);
  });
}
