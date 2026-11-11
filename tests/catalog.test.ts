import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCatalog, SWATCHES } from '../src/app/model/catalog.ts';
import type { CatalogEntry } from '../src/app/model/catalog.ts';

const scene = (id: string, packs: string[], steps: number) => ({ id, title: id.toUpperCase(), about: `about ${id}`, packs, steps });
const entries: CatalogEntry[] = [
  { file: 'a.scene', scene: scene('net.a', ['net'], 4), errors: [] },
  { file: 'b.scene', scene: scene('net.b', ['net'], 2), errors: [] },
  { file: 'c.scene', scene: scene('linux.c', ['linux'], 3), errors: [] },
  { file: 'bad.scene', scene: null, errors: ['L3: unknown statement'] },
];
const done: Record<string, number[]> = { 'net.a': [0, 1, 2, 3], 'net.b': [0] };

test('groups scenes by their first pack, in a stable track order', () => {
  const c = buildCatalog(entries, (id) => done[id] ?? []);
  assert.deepEqual(c.tracks.map((t) => t.key), ['net', 'linux']);
  assert.equal(c.tracks[0].name, 'Networking');
  assert.deepEqual(c.tracks[0].cards.map((x) => x.id), ['net.a', 'net.b']);
});

test('card status, percent and call to action follow progress', () => {
  const [a, b] = buildCatalog(entries, (id) => done[id] ?? []).tracks[0].cards;
  assert.deepEqual([a.pct, a.status, a.cta], [100, 'done', 'Review']);
  assert.deepEqual([b.pct, b.status, b.cta], [50, 'started', 'Continue']);
  const c = buildCatalog(entries, (id) => done[id] ?? []).tracks[1].cards[0];
  assert.deepEqual([c.pct, c.status, c.cta], [0, 'new', 'Start']);
});

test('steps beyond the current scene length do not inflate progress', () => {
  const c = buildCatalog(entries, () => [0, 1, 7, 9]);
  assert.equal(c.tracks[0].cards[1].pct, 100); // net.b has 2 steps
  assert.equal(c.tracks[0].cards[0].pct, 50);
});

test('every card gets a colour swatch, cycling through the palette', () => {
  const cards = buildCatalog(entries, () => []).tracks.flatMap((t) => t.cards);
  cards.forEach((card, i) => assert.equal(card.swatch, SWATCHES[i % SWATCHES.length]));
});

test('broken scenes are listed separately with their errors, and totals are counted', () => {
  const c = buildCatalog(entries, (id) => done[id] ?? []);
  assert.deepEqual(c.broken, [{ file: 'bad.scene', errors: ['L3: unknown statement'] }]);
  assert.deepEqual(c.stats, { total: 3, done: 1, started: 1 });
});
