import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatRequest, ChatResult } from '../src/ai/types.ts';
import { builtinPacks } from '../src/packs/index.ts';
import type { Section } from '../src/studio/extract/sections.ts';
import { assembleModule, generateLesson, generateOutline, generatePack } from '../src/studio/pipeline.ts';
import type { StudioEvent } from '../src/studio/pipeline.ts';
import { LESSON_SPEC, PACK_SPEC } from './studio.specs.test.ts';

const sections: Section[] = [
  { title: 'Chapter 1: Tables', level: 1, page: 3, endPage: 4, text: 'A table stores rows. '.repeat(50) },
  { title: 'Chapter 2: Queries', level: 1, page: 5, endPage: 7, text: 'SELECT reads rows. '.repeat(1000) },
];

/** a fake model that answers from a script and records every request */
function scripted(replies: unknown[]) {
  const reqs: ChatRequest[] = [];
  const chat = async (req: ChatRequest): Promise<ChatResult> => {
    reqs.push(req);
    const next = replies.shift();
    if (next === undefined) throw new Error('script exhausted');
    req.onThinking?.('hmm');
    return { text: JSON.stringify(next), json: next, ms: 5 };
  };
  return { chat, reqs };
}

test('generatePack: compiles the model JSON; prompt carries the topic, sections and building blocks', async () => {
  const { chat, reqs } = scripted([PACK_SPEC]);
  const events: StudioEvent[] = [];
  const r = await generatePack({ chat, registry: builtinPacks, onEvent: (e) => events.push(e) }, { topic: 'SQL', sections });
  assert.ok(r.pack);
  assert.equal(r.pack!.name, 'sql');
  assert.equal(r.attempts, 1);
  const prompt = reqs[0].messages.map((m) => m.content).join('\n');
  assert.match(prompt, /SQL/);
  assert.match(prompt, /Chapter 2: Queries/);
  assert.match(prompt, /add KIND ID/, 'building blocks are described');
  assert.equal(reqs[0].schema, undefined, 'no schema by default: small models loop under constrained decoding');
  assert.match(prompt, /"kinds":\s*\[\{"name"/, 'the exact JSON shape is shown as an example');
  assert.ok(reqs[0].maxTokens && reqs[0].maxTokens <= 4000, 'output is capped so a runaway generation cannot hang');
  assert.ok(events.some((e) => e.type === 'thinking'));
});

test('structured: true opts into schema-constrained output (for models that handle it well)', async () => {
  const { chat, reqs } = scripted([PACK_SPEC]);
  await generatePack({ chat, registry: builtinPacks, structured: true }, { topic: 'SQL', sections });
  assert.ok(reqs[0].schema);
});

test('replies are parsed from text and normalized (fences, aliases, invented icons)', async () => {
  const messy = '```json\n' + JSON.stringify({ name: 'sql', description: 'Tables.', kinds: [{ name: 'table', icon: 'grid-table', props: { rows: 'n' } }], macros: [] }) + '\n```';
  const chat = async (): Promise<ChatResult> => ({ text: messy, ms: 1 });
  const r = await generatePack({ chat, registry: builtinPacks }, { topic: 'SQL', sections });
  assert.ok(r.pack, r.errors.join('\n'));
  assert.match(r.source, /kind table icon=table/);
});

test('generatePack: compiler errors go back to the model until it is fixed', async () => {
  // (typos like icon 'databse' are now fixed by the normalizer; use an error only the model can fix)
  const broken = { ...PACK_SPEC, macros: [{ name: 'insert', params: ['ROW', 'TABLE'], body: ['teleport ROW TABLE'] }] };
  const { chat, reqs } = scripted([broken, PACK_SPEC]);
  const r = await generatePack({ chat, registry: builtinPacks }, { topic: 'SQL', sections });
  assert.ok(r.pack);
  assert.equal(r.attempts, 2);
  const repair = reqs[1].messages.map((m) => m.content).join('\n');
  assert.match(repair, /unknown action 'teleport'/);
  assert.match(repair, /^2  about /m, 'numbered pack text is shown');
});

test('generatePack: gives up after maxRepairs and returns the last errors', async () => {
  const bad = { ...PACK_SPEC, macros: [{ name: 'insert', params: ['ROW'], body: ['teleport ROW'] }] };
  const { chat } = scripted([bad, bad, bad]);
  const r = await generatePack({ chat, registry: builtinPacks, maxRepairs: 2 }, { topic: 'x', sections });
  assert.equal(r.pack, null);
  assert.equal(r.attempts, 3);
  assert.match(r.errors.join('\n'), /unknown action 'teleport'/);
});

test('generateOutline: returns editable lesson items with section references', async () => {
  const { chat, reqs } = scripted([{ lessons: [
    { title: 'Tables hold rows', about: 'Meet tables.', sections: [0], key_concepts: ['table', 'row'] },
    { title: 'Asking questions', about: 'SELECT.', sections: [1, 7], key_concepts: ['query'] },
  ] }]);
  const items = await generateOutline({ chat, registry: builtinPacks }, { topic: 'SQL', sections, packVocab: 'kind table', maxLessons: 3 });
  assert.deepEqual(items.map((i) => [i.title, i.sections]), [['Tables hold rows', [0]], ['Asking questions', [1]]], 'out-of-range section refs dropped');
  assert.match(reqs[0].messages.map((m) => m.content).join('\n'), /at most 3 lessons/);
});

test('generateLesson: compiles, verifies the challenge, repairs when the challenge cannot be solved', async () => {
  const { pack } = await generatePack({ chat: scripted([PACK_SPEC]).chat, registry: builtinPacks }, { topic: 'SQL', sections });
  const unsolvable = { ...LESSON_SPEC, steps: LESSON_SPEC.steps.map((s, i) => (i === 2 ? { ...s, goals: ['exists r9'] } : s)) };
  const { chat, reqs } = scripted([unsolvable, LESSON_SPEC]);
  const r = await generateLesson(
    { chat, registry: builtinPacks },
    { item: { title: 'Your first table', about: 'x', sections: [0, 1], key_concepts: [] }, sections, packs: [pack!] },
  );
  assert.ok(r.scene, r.errors.join('\n'));
  assert.equal(r.attempts, 2);
  const repair = reqs[1].messages.map((m) => m.content).join('\n');
  assert.match(repair, /cannot be solved|unknown entity 'r9'/);
  const prompt = reqs[0].messages.map((m) => m.content).join('\n');
  assert.ok(prompt.length < 16000, `prompt stays small for local models (${prompt.length} chars)`);
  assert.match(prompt, /macro insert ROW TABLE/, 'the pack vocabulary is in the prompt');
});

test('generateLesson: honours cancellation', async () => {
  const ctl = new AbortController();
  ctl.abort();
  const { chat } = scripted([LESSON_SPEC]);
  await assert.rejects(generateLesson({ chat, registry: builtinPacks, signal: ctl.signal }, { item: { title: 't', about: '', sections: [0], key_concepts: [] }, sections, packs: [] }), /Cancelled/);
});

test('assembleModule: packs + lessons + sources with pages → a valid v2 module', async () => {
  const p = await generatePack({ chat: scripted([PACK_SPEC]).chat, registry: builtinPacks }, { topic: 'SQL', sections });
  const l = await generateLesson({ chat: scripted([LESSON_SPEC]).chat, registry: builtinPacks }, { item: { title: 't', about: '', sections: [0], key_concepts: [] }, sections, packs: [p.pack!] });
  const m = assembleModule({ title: 'SQL from my notes', author: 'Asha', packSources: [p.source], lessonSources: [l.source], sources: [{ title: 'notes.pdf', pages: 'pp. 3-7' }] }, builtinPacks);
  assert.deepEqual(m.errors, []);
  assert.equal(m.module!.version, 2);
  assert.equal(m.module!.sources[0].pages, 'pp. 3-7');
});
