import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSections } from '../src/studio/extract/sections.ts';
import type { TextLine } from '../src/studio/extract/sections.ts';

const body = (text: string, page: number): TextLine => ({ text, size: 10, page });
const h = (text: string, size: number, page: number): TextLine => ({ text, size, page });

test('larger text becomes headings; levels follow font size', () => {
  const lines: TextLine[] = [
    h('Chapter 1: Getting started', 20, 1),
    body('Git is a version control system.', 1),
    h('Section 1.1: Install', 14, 1),
    body('Download it from the website.', 1),
    body('Then run the installer.', 2),
    h('Chapter 2: Branches', 20, 3),
    body('A branch is a movable pointer.', 3),
  ];
  const s = splitSections(lines);
  assert.deepEqual(s.map((x) => [x.level, x.title, x.page]), [
    [1, 'Chapter 1: Getting started', 1],
    [2, 'Section 1.1: Install', 1],
    [1, 'Chapter 2: Branches', 3],
  ]);
  assert.equal(s[1].text, 'Download it from the website.\nThen run the installer.');
  assert.deepEqual([s[1].page, s[1].endPage], [1, 2]);
});

test('running headers, footers and page numbers are dropped', () => {
  const lines: TextLine[] = [];
  for (let p = 1; p <= 6; p++) {
    lines.push(body('MyBook Notes for Professionals', p));
    if (p === 1) lines.push(h('Chapter 1: Intro', 18, 1));
    lines.push(body(`Content of page ${p} is here.`, p));
    lines.push(body(String(p), p));
  }
  const s = splitSections(lines);
  assert.equal(s.length, 1);
  assert.doesNotMatch(s[0].text, /Notes for Professionals/);
  assert.doesNotMatch(s[0].text, /^\d+$/m);
  assert.match(s[0].text, /Content of page 6/);
});

test('text before the first heading is kept as a front-matter section', () => {
  const s = splitSections([body('Preface words here.', 1), h('Chapter 1: Start', 18, 2), body('Hello there.', 2)]);
  assert.deepEqual(s.map((x) => x.title), ['(front matter)', 'Chapter 1: Start']);
});

test('documents without size differences fall back to page-sized chunks', () => {
  const lines = Array.from({ length: 30 }, (_, i) => body(`Line ${i} with some words.`, Math.floor(i / 3) + 1));
  const s = splitSections(lines, { pagesPerChunk: 5 });
  assert.deepEqual(s.map((x) => x.title), ['Pages 1–5', 'Pages 6–10']);
});

test('one-off giant cover text does not push real chapters down a level', () => {
  const lines: TextLine[] = [h('Git', 90, 1), h('Notes for Professionals', 30, 1)];
  for (let c = 1; c <= 4; c++) {
    lines.push(h(`Chapter ${c}: Topic ${c}`, 26, c + 1));
    // body text differs per page (identical lines on every page would be a running footer)
    lines.push(h(`Section ${c}.1: Part`, 18, c + 1), body(`Intro to topic ${'abcd'[c - 1]}.`, c + 1), body(`Details on ${'wxyz'[c - 1]} here.`, c + 1));
    lines.push(h(`Section ${c}.2: Part`, 18, c + 1), body(`Example ${'efgh'[c - 1]} explained.`, c + 1), body(`Summary of ${'ijkl'[c - 1]}.`, c + 1));
  }
  const s = splitSections(lines);
  const chapters = s.filter((x) => x.level === 1).map((x) => x.title);
  assert.ok(chapters.includes('Chapter 1: Topic 1') && chapters.includes('Chapter 4: Topic 4'), chapters.join(' | '));
  assert.equal(s.find((x) => x.title === 'Section 2.1: Part')!.level, 2);
});

test('table-of-contents lines with dot leaders are not headings', () => {
  const lines: TextLine[] = [
    h('Contents', 26, 1),
    h('Chapter 1: Getting started 2 ....................', 12, 1),
    h('Chapter 2: Branches 9 ...........................', 12, 1),
    body('x', 1),
    h('Chapter 1: Getting started', 26, 2), body('Real text.', 2), body('More.', 2), body('More!', 2),
    h('Chapter 2: Branches', 26, 3), body('Branch text.', 3), body('More.', 3), body('More?', 3),
    h('Chapter 3: Tags', 26, 4), body('Tag text.', 4),
  ];
  const titles = splitSections(lines).map((x) => x.title);
  assert.ok(!titles.some((t) => t.includes('....')), titles.join(' | '));
});

test('a heading that wraps onto two lines becomes one title', () => {
  const lines: TextLine[] = [];
  for (let c = 1; c <= 3; c++) {
    lines.push(h(c === 2 ? 'Chapter 2: Dates, Timestamps, and' : `Chapter ${c}: Topic ${'abc'[c - 1]}`, 26, c));
    if (c === 2) lines.push(h('Intervals', 26, c));
    for (const w of ['first', 'second', 'third']) lines.push(body(`The ${w} point of chapter ${'xyz'[c - 1]}.`, c));
  }
  const titles = splitSections(lines).map((x) => x.title);
  assert.deepEqual(titles, ['Chapter 1: Topic a', 'Chapter 2: Dates, Timestamps, and Intervals', 'Chapter 3: Topic c']);
});
