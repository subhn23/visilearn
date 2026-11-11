// The Studio agent: pack → outline → lessons → module. DOM-free; the model is injected as `chat`.
// Every model answer is structured JSON; our converters produce the text; our compiler and simulator
// check it; errors go back to the model (repair loop).
import { extractJson } from '../ai/json.ts';
import { AiError } from '../ai/types.ts';
import type { ChatMessage, ChatRequest, ChatResult } from '../ai/types.ts';
import { compile } from '../core/compile.ts';
import { createState, headlessFx, present } from '../core/runtime.ts';
import type { PackDef, PackRegistry, Runtime, Scene } from '../core/types.ts';
import { createModule, validateModule } from '../modules/format.ts';
import type { ModuleCheck, ModuleSource } from '../modules/format.ts';
import { CONCEPT_VOCAB } from '../packs/concept/index.ts';
import { compilePack } from '../packs/concept/packdef.ts';
import { withPacks } from '../packs/index.ts';
import type { Section } from './extract/sections.ts';
import { lessonSystem, OUTLINE_SYSTEM, PACK_SYSTEM, REPAIR } from './prompts.ts';
import { normalizeLesson, normalizeOutline, normalizePack } from './normalize.ts';
import { LESSON_SCHEMA, lessonToScene, numbered, OUTLINE_SCHEMA, PACK_SCHEMA, packToText } from './specs.ts';
import type { LessonSpec, OutlineItem, PackSpec } from './specs.ts';

export type StudioEvent =
  | { type: 'status'; message: string }
  | { type: 'thinking'; chars: number }
  | { type: 'writing'; chars: number }
  | { type: 'attempt'; message: string }
  | { type: 'problem'; message: string; errors: string[] };

export interface StudioDeps {
  chat(req: ChatRequest): Promise<ChatResult>;
  registry: PackRegistry;
  onEvent?: (e: StudioEvent) => void;
  signal?: AbortSignal;
  /** extra rounds after the first attempt (default 3) */
  maxRepairs?: number;
  temperature?: number;
  /**
   * Ask for schema-constrained output. Off by default: small local models (gemma4:12b) can loop
   * forever under grammar-constrained decoding. We show the JSON shape in the prompt instead and
   * parse + normalize defensively.
   */
  structured?: boolean;
}

const CTX = 8192;
/** output caps per stage (tokens, including any reasoning): a runaway generation stops here */
export const MAX_TOKENS = { pack: 3000, outline: 2000, lesson: 4000 };

async function askJson(deps: StudioDeps, messages: ChatMessage[], schema: object, maxTokens: number): Promise<unknown> {
  if (deps.signal?.aborted) throw new AiError('aborted', 'Cancelled.');
  let thinking = 0;
  let writing = 0;
  const r = await deps.chat({
    messages,
    ...(deps.structured ? { schema } : {}),
    temperature: deps.temperature ?? 0.3,
    numCtx: CTX,
    maxTokens,
    signal: deps.signal,
    onThinking: (t) => { thinking += t.length; deps.onEvent?.({ type: 'thinking', chars: thinking }); },
    onToken: (t) => { writing += t.length; deps.onEvent?.({ type: 'writing', chars: writing }); },
  });
  const json = r.json ?? extractJson(r.text);
  if (json === undefined) throw new AiError('bad_response', 'The model did not return JSON (the answer may have been cut off).', 'Try again or use a larger model.');
  return json;
}

interface Built<T> { value: T | null; text: string; errors: string[] }

async function withRepair<T>(deps: StudioDeps, first: ChatMessage[], schema: object, maxTokens: number, what: string, build: (json: any) => Built<T> | Promise<Built<T>>) {
  const max = deps.maxRepairs ?? 3;
  let messages = first;
  let last: Built<T> = { value: null, text: '', errors: ['no answer'] };
  let json: unknown;
  for (let attempt = 1; attempt <= max + 1; attempt++) {
    deps.onEvent?.({ type: 'attempt', message: attempt === 1 ? `Writing ${what}…` : `Fixing ${what} (round ${attempt - 1})…` });
    try {
      json = await askJson(deps, messages, schema, maxTokens);
    } catch (e) {
      if (!(e instanceof AiError) || e.code !== 'bad_response') throw e;
      last = { value: null, text: '', errors: [e.message] };
      deps.onEvent?.({ type: 'problem', message: `${what}: unreadable answer`, errors: last.errors });
      messages = [...first, { role: 'user', content: 'Your last answer was not complete JSON. Answer again with ONLY the JSON object, shorter.' }];
      continue;
    }
    last = await build(json);
    if (last.value) return { ...last, json, attempts: attempt };
    deps.onEvent?.({ type: 'problem', message: `${what}: ${last.errors.length} problem${last.errors.length === 1 ? '' : 's'}`, errors: last.errors });
    messages = [...first, { role: 'assistant', content: JSON.stringify(json) }, { role: 'user', content: REPAIR(numbered(last.text), last.errors.slice(0, 12)) }];
  }
  return { ...last, json, attempts: max + 1 };
}

/** short digest of the selected sections: numbered titles + a little text each */
export function digest(sections: Section[], perSection = 220, total = 6000): string {
  const lines: string[] = [];
  let used = 0;
  sections.forEach((s, i) => {
    const text = s.text.replace(/\s+/g, ' ').slice(0, perSection);
    const line = `[${i}] ${s.title} (p. ${s.page}${s.endPage > s.page ? `-${s.endPage}` : ''})${text ? `: ${text}` : ''}`;
    if (used + line.length > total) return;
    used += line.length;
    lines.push(line);
  });
  return lines.join('\n');
}

/** the source text a lesson may draw on */
export function excerpt(sections: Section[], idx: number[], max = 6000): string {
  const parts = idx.filter((i) => sections[i]).map((i) => `## ${sections[i].title}\n${sections[i].text}`);
  const text = parts.join('\n\n').replace(/[ \t]+/g, ' ');
  return text.length > max ? `${text.slice(0, max)}\n[…]` : text;
}

// ---- 1. pack -------------------------------------------------------------------------

export async function generatePack(deps: StudioDeps, input: { topic: string; sections: Section[] }) {
  deps.onEvent?.({ type: 'status', message: 'Designing a pack for the topic…' });
  const first: ChatMessage[] = [
    { role: 'system', content: PACK_SYSTEM },
    { role: 'user', content: `Topic: ${input.topic}\n\nSource sections:\n${digest(input.sections)}\n\nDesign the pack as JSON.` },
  ];
  const r = await withRepair<PackDef>(deps, first, PACK_SCHEMA, MAX_TOKENS.pack, 'the pack', (json: unknown) => {
    const text = packToText(normalizePack(json));
    const c = compilePack(text, deps.registry);
    return { value: c.pack, text, errors: c.diags.filter((d) => d.severity === 'error').map((d) => `L${d.line} ${d.msg}`) };
  });
  return { pack: r.value, source: r.text, spec: normalizePack(r.json ?? {}) as PackSpec, attempts: r.attempts, errors: r.value ? [] : r.errors };
}

// ---- 2. outline ----------------------------------------------------------------------

export async function generateOutline(deps: StudioDeps, input: { topic: string; sections: Section[]; packVocab: string; maxLessons: number }): Promise<OutlineItem[]> {
  deps.onEvent?.({ type: 'status', message: 'Planning the lessons…' });
  const json = await askJson(deps, [
    { role: 'system', content: OUTLINE_SYSTEM },
    {
      role: 'user',
      content: `Topic: ${input.topic}\nThe lessons can draw these things:\n${input.packVocab}\n\nSource sections:\n${digest(input.sections)}\n\nPlan at most ${input.maxLessons} lessons as JSON.`,
    },
  ], OUTLINE_SCHEMA, MAX_TOKENS.outline);
  const items = normalizeOutline(json)
    .slice(0, input.maxLessons)
    .map((l) => ({
      title: String(l.title).trim(),
      about: String(l.about ?? '').trim(),
      sections: [...new Set((l.sections ?? []).filter((i) => Number.isInteger(i) && i >= 0 && i < input.sections.length))],
      key_concepts: (l.key_concepts ?? []).map(String).slice(0, 8),
    }));
  if (!items.length) throw new AiError('bad_response', 'The model did not propose any lessons.');
  return items;
}

// ---- 3. lessons ----------------------------------------------------------------------

/** headless check: plain goals must be reachable; button challenges must start unsolved and be solvable */
export async function verifyLesson(scene: Scene, registry: PackRegistry): Promise<string[]> {
  const problems: string[] = [];
  const rt: Runtime = { scene, state: createState(scene, registry), fx: headlessFx(), headless: true, ask: async () => {} };
  present(rt, registry);
  let interactive = false;
  for (const [i, step] of scene.steps.entries()) {
    try {
      for (const a of step.actions) await a.run(rt);
    } catch (e) {
      problems.push(`Step ${i + 1}: an action failed while running (${(e as Error).message}).`);
      continue;
    }
    if (step.asks.length) interactive = true;
    if (!step.goals.length) continue;
    if (step.buttons.length) {
      interactive = true;
      if (step.goals.every((g) => g.check(rt))) problems.push(`Step ${i + 1}: the challenge is already solved before any button is pressed; goals must depend on the buttons.`);
      for (const b of step.buttons) await b.action.run(rt);
    }
    const unmet = step.goals.filter((g) => !g.check(rt)).map((g) => g.label);
    if (unmet.length) problems.push(`Step ${i + 1}: ${step.buttons.length ? 'the challenge cannot be solved' : 'goals are never met'}: still unmet after ${step.buttons.length ? 'pressing every button' : 'its actions'}: ${unmet.join('; ')}.`);
  }
  if (!interactive) problems.push('The lesson needs an ask (prediction) or a final step with buttons and goals.');
  return problems;
}

export async function generateLesson(deps: StudioDeps, input: { item: OutlineItem; sections: Section[]; packs: PackDef[]; maxSourceChars?: number }) {
  if (deps.signal?.aborted) throw new AiError('aborted', 'Cancelled.');
  const registry = withPacks(deps.registry, input.packs.filter((p) => p.origin === 'data'));
  const names = input.packs.map((p) => p.name);
  const needsConcept = !names.length || input.packs.some((p) => p.stateKey);
  const vocab = [...input.packs.map((p) => p.vocab), ...(needsConcept && !names.includes('concept') ? [CONCEPT_VOCAB] : [])].join('\n\n');
  deps.onEvent?.({ type: 'status', message: `Writing lesson “${input.item.title}”…` });
  const first: ChatMessage[] = [
    { role: 'system', content: lessonSystem(vocab) },
    {
      role: 'user',
      content: [
        `Lesson: ${input.item.title}`,
        input.item.about ? `Goal: ${input.item.about}` : '',
        input.item.key_concepts.length ? `Key concepts: ${input.item.key_concepts.join(', ')}` : '',
        '',
        'Source material (explain it in your own words):',
        excerpt(input.sections, input.item.sections.length ? input.item.sections : input.sections.map((_, i) => i).slice(0, 2), input.maxSourceChars ?? 6000),
        '',
        'Write the lesson as JSON.',
      ].join('\n'),
    },
  ];
  const r = await withRepair<Scene>(deps, first, LESSON_SCHEMA, MAX_TOKENS.lesson, 'the lesson', async (json: unknown) => {
    const text = lessonToScene(normalizeLesson(json), names);
    const c = compile(text, registry);
    const errors = c.diags.filter((d) => d.severity === 'error').map((d) => `L${d.line} ${d.msg}`);
    if (!c.scene) return { value: null, text, errors };
    const problems = await verifyLesson(c.scene, registry);
    return { value: problems.length ? null : c.scene, text, errors: problems };
  });
  return { scene: r.value, source: r.text, spec: normalizeLesson(r.json ?? {}) as LessonSpec, attempts: r.attempts, errors: r.value ? [] : r.errors };
}

// ---- 4. module -----------------------------------------------------------------------

export function assembleModule(
  input: { title: string; author?: string; description?: string; track?: string; packSources: string[]; lessonSources: string[]; sources: ModuleSource[]; id?: string },
  registry: PackRegistry,
): ModuleCheck {
  const m = createModule({
    title: input.title,
    author: input.author,
    description: input.description,
    track: input.track ?? 'concept',
    tags: ['studio'],
    sources: input.sources,
    packs: input.packSources,
    scenes: input.lessonSources,
  }, input.id ? { id: input.id } : {});
  return validateModule(m, registry);
}
