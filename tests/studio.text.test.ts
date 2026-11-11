import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSections } from '../src/studio/extract/sections.ts';
import { textToLines } from '../src/studio/extract/text.ts';

test('markdown headings become sized lines, so sections follow the document structure', () => {
  const md = '# Git\nIntro text.\n\n## Commits\nA commit is a snapshot.\nMore.\n\n## Branches\nA branch is a label.\n\n# Merging\nCombine work.';
  const lines = textToLines(md, 'notes.md');
  assert.deepEqual(lines.slice(0, 3).map((l) => [l.text, l.size]), [['Git', 24], ['Intro text.', 10], ['Commits', 18]]);
  const s = splitSections(lines);
  assert.deepEqual(s.map((x) => [x.level, x.title]), [[1, 'Git'], [2, 'Commits'], [2, 'Branches'], [1, 'Merging']]);
});

test('plain text gets virtual pages and no headings (page chunks)', () => {
  const txt = Array.from({ length: 130 }, (_, i) => `line ${i} of some notes`).join('\n');
  const lines = textToLines(txt, 'notes.txt');
  assert.equal(lines.at(-1)!.page, 3, '60 lines per virtual page');
  assert.ok(lines.every((l) => l.size === 10));
});

test('markdown code fences are kept as text, not headings', () => {
  const lines = textToLines('# T\n```\n# not a heading\n```\nbody', 'a.md');
  assert.equal(lines.filter((l) => l.size > 10).length, 1);
});
