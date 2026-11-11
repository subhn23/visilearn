// What the model fills in (JSON, schema-constrained) and the deterministic converters that turn it
// into pack / lesson text. The model never writes our syntax directly, so it cannot get it wrong.
import { ICONS } from '../packs/concept/icons.ts';

export interface PackSpec {
  name: string;
  title: string;
  about: string;
  kinds: { name: string; icon: string; swatch: string; about: string; props: string[]; show: string; label: boolean }[];
  macros: { name: string; params: string[]; body: string[] }[];
}

export interface OutlineItem {
  title: string;
  about: string;
  /** indexes into the selected sections */
  sections: number[];
  key_concepts: string[];
}

export interface LessonSpec {
  id: string;
  title: string;
  about: string;
  entities: { kind: string; id: string; label: string; props: { key: string; value: string }[] }[];
  links: { from: string; to: string }[];
  steps: {
    text: string;
    say: string;
    /** a prediction question; null or an empty question means none */
    ask: { question: string; options: string[]; answer: number } | null;
    actions: string[];
    buttons: { label: string; action: string }[];
    goals: string[];
  }[];
}

const SWATCHES = ['mustard', 'mint', 'lilac', 'peach', 'sky', 'rose'];
const str = { type: 'string' };
const strs = { type: 'array', items: str };

export const PACK_SCHEMA = {
  type: 'object',
  properties: {
    name: str, title: str, about: str,
    kinds: {
      type: 'array', minItems: 1, maxItems: 8,
      items: {
        type: 'object',
        properties: { name: str, icon: { type: 'string', enum: Object.keys(ICONS) }, swatch: { type: 'string', enum: SWATCHES }, about: str, props: strs, show: str, label: { type: 'boolean' } },
        required: ['name', 'icon', 'swatch', 'about', 'props', 'show', 'label'],
      },
    },
    macros: {
      type: 'array', maxItems: 8,
      items: { type: 'object', properties: { name: str, params: strs, body: strs }, required: ['name', 'params', 'body'] },
    },
  },
  required: ['name', 'title', 'about', 'kinds', 'macros'],
};

export const OUTLINE_SCHEMA = {
  type: 'object',
  properties: {
    lessons: {
      type: 'array', minItems: 1, maxItems: 8,
      items: { type: 'object', properties: { title: str, about: str, sections: { type: 'array', items: { type: 'integer' } }, key_concepts: strs }, required: ['title', 'about', 'sections', 'key_concepts'] },
    },
  },
  required: ['lessons'],
};

export const LESSON_SCHEMA = {
  type: 'object',
  properties: {
    id: str, title: str, about: str,
    entities: {
      type: 'array', maxItems: 12,
      items: {
        type: 'object',
        properties: { kind: str, id: str, label: str, props: { type: 'array', items: { type: 'object', properties: { key: str, value: str }, required: ['key', 'value'] } } },
        required: ['kind', 'id', 'label', 'props'],
      },
    },
    links: { type: 'array', items: { type: 'object', properties: { from: str, to: str }, required: ['from', 'to'] } },
    steps: {
      type: 'array', minItems: 2, maxItems: 7,
      items: {
        type: 'object',
        properties: {
          text: str, say: str,
          ask: { type: 'object', properties: { question: str, options: strs, answer: { type: 'integer' } }, required: ['question', 'options', 'answer'] },
          actions: strs,
          buttons: { type: 'array', maxItems: 3, items: { type: 'object', properties: { label: str, action: str }, required: ['label', 'action'] } },
          goals: strs,
        },
        required: ['text', 'say', 'ask', 'actions', 'buttons', 'goals'],
      },
    },
  },
  required: ['id', 'title', 'about', 'entities', 'links', 'steps'],
};

const one = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
/** pack text: quotes inside strings become apostrophes (the pack parser has no escapes in kv values) */
const pq = (s: unknown) => one(s).replace(/"/g, "'");
/** scene text: escape quotes with a backslash */
const sq = (s: unknown) => `"${one(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
export const slug = (s: string) => one(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lesson';
const kindName = (s: string) => one(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

export function packToText(p: PackSpec): string {
  const out = [`pack ${slug(p.name).slice(0, 32)} "${pq(p.title)}"`, `about "${pq(p.about)}"`];
  for (const k of p.kinds ?? []) {
    const opts = [`icon=${one(k.icon) || 'box'}`, `swatch=${one(k.swatch) || 'sky'}`];
    if (one(k.show)) opts.push(`show=${one(k.show)}`);
    if (k.label) opts.push('role=label');
    out.push(`kind ${kindName(k.name)} ${opts.join(' ')} about="${pq(k.about)}"`);
    for (const pr of k.props ?? []) if (one(pr)) out.push(`  prop ${one(pr).replace(/\s+/g, '_')}`);
  }
  for (const m of p.macros ?? []) {
    out.push(`macro ${kindName(m.name)} ${(m.params ?? []).map((x) => one(x).toUpperCase()).join(' ')}`.trimEnd());
    for (const line of m.body ?? []) if (one(line)) out.push(`  ${one(line)}`);
  }
  return out.join('\n') + '\n';
}

export function lessonToScene(l: LessonSpec, packNames: string[]): string {
  const uses = packNames.length ? packNames : ['concept'];
  const out = [`scene ${uses[0]}.${slug(l.id || l.title)} ${sq(l.title)}`];
  if (one(l.about)) out.push(`about ${sq(l.about)}`);
  out.push(`use ${uses.join(', ')}`, '');
  for (const e of l.entities ?? []) {
    const props = (e.props ?? []).filter((p) => one(p.key)).map((p) => {
      const v = one(p.value);
      return `${one(p.key).replace(/\s+/g, '_')}=${/[\s"]/.test(v) || !v ? sq(v) : v}`;
    });
    out.push([one(e.kind), one(e.id), `label=${sq(e.label || e.id)}`, ...props].join(' '));
  }
  for (const k of l.links ?? []) out.push(`link ${one(k.from)} ${one(k.to)}`);
  for (const s of l.steps ?? []) {
    out.push('', `step ${sq(s.text)}`);
    if (one(s.say)) out.push(`  say ${sq(s.say)}`);
    if (s.ask && one(s.ask.question) && (s.ask.options ?? []).length >= 2) {
      out.push(`  ask ${sq(s.ask.question)} ${s.ask.options.map(sq).join(' ')} answer=${s.ask.answer}`);
    }
    for (const a of s.actions ?? []) if (one(a)) out.push(`  ${one(a)}`);
    for (const b of s.buttons ?? []) if (one(b.action)) out.push(`  button ${sq(b.label || 'Try it')} ${one(b.action)}`);
    const goals = (s.goals ?? []).map(one).filter(Boolean);
    if (goals.length) out.push(`  goal ${goals.join(', ')}`);
  }
  return out.join('\n') + '\n';
}

export const numbered = (text: string) => text.replace(/\n$/, '').split('\n').map((l, i) => `${i + 1}  ${l}`).join('\n');
