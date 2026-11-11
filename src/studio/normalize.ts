// Be liberal in what we accept from models: map "almost right" JSON onto our specs.
// Everything here is shaped by real output from small local models (gemma4:12b).
import { PRIMITIVES } from '../packs/concept/core.ts';
import { ICONS } from '../packs/concept/icons.ts';
import { builtinPacks } from '../packs/index.ts';
import type { LessonSpec, OutlineItem, PackSpec } from './specs.ts';

const SWATCHES = ['mustard', 'mint', 'lilac', 'peach', 'sky', 'rose'];
const RESERVED_KINDS = new Set([...PRIMITIVES, 'scene', 'use', 'about', 'link', 'step', 'pack', 'kind', 'prop', 'macro', 'say', 'hint', 'highlight', 'note', 'ask', 'goal', 'wait', 'button']);
const RESERVED_MACROS = new Set([...PRIMITIVES, 'highlight', 'note', 'wait', 'ask', 'goal', 'say', 'hint', 'button']);
const ICON_SYNONYMS: Record<string, string> = {
  document: 'file', doc: 'file', note: 'file', page: 'file', code: 'file', script: 'file', text: 'file',
  fork: 'branch', merge: 'branch', git: 'branch', repo: 'folder', repository: 'folder', directory: 'folder', dir: 'folder',
  user: 'person', human: 'person', client: 'person', users: 'people', team: 'people', group: 'people',
  db: 'database', data: 'database', storage: 'database', disk: 'database', cache: 'database', record: 'list', row: 'list',
  settings: 'gear', config: 'gear', process: 'gear', function: 'gear', engine: 'gear', service: 'gear', worker: 'gear',
  network: 'globe', web: 'globe', internet: 'globe', world: 'globe', message: 'chat', request: 'chat', query: 'chat', email: 'chat',
  time: 'clock', schedule: 'clock', event: 'bolt', signal: 'bolt', warning: 'bolt', error: 'bolt', fast: 'bolt',
  label: 'tag', pointer: 'tag', ref: 'tag', reference: 'tag', name: 'tag', head: 'flag', marker: 'flag', goal: 'flag',
  commit: 'circle', node: 'circle', state: 'circle', point: 'circle', item: 'box', container: 'box', package: 'box', object: 'box', module: 'box',
  machine: 'server', host: 'server', computer: 'cpu', chip: 'cpu', processor: 'cpu', security: 'lock', secret: 'lock', password: 'key', auth: 'key', token: 'key',
  link: 'arrow', edge: 'arrow', flow: 'arrow', stack: 'layers', layer: 'layers', queue: 'list', log: 'list', index: 'list',
  done: 'check', ok: 'check', success: 'check', unknown: 'question', help: 'question', idea: 'star', favorite: 'star', learn: 'book', docs: 'book',
};

const s = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v)).replace(/\s+/g, ' ').trim();
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);
const lines = (v: unknown): string[] => arr(v).flatMap((x) => (typeof x === 'string' ? x.split('\n') : [s(x)])).map(s).filter(Boolean);
const word = (v: unknown) => s(v).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'k-$1');
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function resolveIcon(spec: unknown): string {
  const t = s(spec).toLowerCase();
  if (ICONS[t]) return t;
  for (const part of t.split(/[^a-z]+/).filter(Boolean)) {
    if (ICONS[part]) return part;
    if (ICON_SYNONYMS[part]) return ICON_SYNONYMS[part];
  }
  return 'box';
}

function propNames(v: unknown): string[] {
  const list = v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : arr(v).map((p) => (p && typeof p === 'object' ? p.name ?? p.key : p));
  return [...new Set(list.map((p) => s(p).replace(/[^\w-]+/g, '_')).filter((p) => /^[A-Za-z_]/.test(p)))];
}

export function normalizePack(d: any, reserved = Object.keys(builtinPacks)): PackSpec {
  let name = word(d?.name ?? d?.pack ?? d?.title ?? 'topic').slice(0, 28) || 'topic';
  if (reserved.includes(name) || name.length < 2) name = `${name}-topic`;
  const seen = new Set<string>();
  const kinds = arr(d?.kinds ?? d?.entities ?? d?.types).map((k: any, i: number) => {
    let kn = word(k?.name ?? k?.kind ?? k?.type ?? `thing${i + 1}`) || `thing${i + 1}`;
    if (RESERVED_KINDS.has(kn)) kn = `${kn}-item`;
    const props = propNames(k?.props ?? k?.properties);
    const show = s(k?.show);
    return {
      name: kn,
      icon: resolveIcon(k?.icon),
      swatch: SWATCHES.includes(s(k?.swatch)) ? s(k?.swatch) : SWATCHES[i % SWATCHES.length],
      about: s(k?.about ?? k?.description),
      props,
      show: props.includes(show) ? show : '',
      label: !!(k?.label === true || k?.role === 'label' || k?.pointer === true),
    };
  }).filter((k) => !seen.has(k.name) && seen.add(k.name));
  const macros = arr(d?.macros ?? d?.actions).map((m: any) => {
    let mn = word(m?.name ?? m?.macro) || 'do';
    if (RESERVED_MACROS.has(mn)) mn = `${mn}-action`;
    return {
      name: mn,
      params: arr(m?.params ?? m?.parameters).map((p) => s(p).toUpperCase().replace(/[^A-Z0-9_]+/g, '_').replace(/^(\d)/, 'P$1')).filter(Boolean),
      body: lines(m?.body ?? m?.steps ?? m?.lines),
    };
  }).filter((m) => m.body.length);
  return {
    name,
    title: s(d?.title) || cap(name.replace(/-topic$/, '')),
    about: s(d?.about ?? d?.description ?? d?.summary),
    kinds,
    macros,
  };
}

export function normalizeOutline(d: any): OutlineItem[] {
  const list = arr(d?.lessons ?? d?.outline ?? d?.plan ?? (Array.isArray(d) ? d : []));
  return list.map((l: any) => ({
    title: s(l?.title ?? l?.name),
    about: s(l?.about ?? l?.description ?? l?.goal ?? l?.summary),
    sections: arr(l?.sections ?? l?.section_refs ?? l?.sources)
      .map((x) => (typeof x === 'number' ? x : Number(/\d+/.exec(s(x))?.[0] ?? NaN)))
      .filter((n) => Number.isInteger(n)),
    key_concepts: arr(l?.key_concepts ?? l?.concepts ?? l?.keyConcepts).map(s).filter(Boolean),
  })).filter((l) => l.title);
}

function kv(v: unknown): { key: string; value: string }[] {
  if (v && typeof v === 'object' && !Array.isArray(v)) return Object.entries(v as object).map(([key, value]) => ({ key: s(key), value: s(value) }));
  return arr(v).map((p: any) => ({ key: s(p?.key ?? p?.name), value: s(p?.value) })).filter((p) => p.key);
}

function answerIndex(raw: unknown, options: string[]): number {
  if (typeof raw === 'string' && options.includes(raw.trim())) return options.indexOf(raw.trim()) + 1;
  const n = typeof raw === 'number' ? raw : Number(/\d+/.exec(s(raw))?.[0] ?? NaN);
  if (!Number.isInteger(n)) return 1;
  if (n === 0) return 1; // zero-based answer
  return Math.min(Math.max(n, 1), options.length);
}

export function normalizeLesson(d: any): LessonSpec {
  const idMap = new Map<string, string>();
  const entities = arr(d?.entities ?? d?.nodes ?? d?.objects).map((e: any) => {
    const orig = s(e?.id ?? e?.name);
    const id = orig.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').replace(/^(\d)/, 'n$1') || 'item';
    if (orig && orig !== id) idMap.set(orig, id);
    return { kind: word(e?.kind ?? e?.type), id, label: s(e?.label ?? e?.name ?? e?.title) || id, props: kv(e?.props ?? e?.properties) };
  });
  const fix = (t: string) => {
    let out = t;
    for (const [from, to] of idMap) out = out.replace(new RegExp(`(?<![\\w-])${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`, 'g'), to);
    return out;
  };
  const links = arr(d?.links ?? d?.edges ?? d?.connections).map((k: any) => {
    if (Array.isArray(k)) return { from: s(k[0]), to: s(k[1]) };
    if (typeof k === 'string') { const [a, b] = k.split(/\s*(?:->|→|--|<->)\s*/); return { from: s(a), to: s(b) }; }
    return { from: s(k?.from ?? k?.source ?? k?.a), to: s(k?.to ?? k?.target ?? k?.b) };
  }).filter((k) => k.from && k.to).map((k) => ({ from: fix(k.from), to: fix(k.to) }));
  const steps = arr(d?.steps).map((st: any) => {
    const q = st?.ask ?? st?.question ?? st?.predict;
    const options = arr(q?.options ?? q?.choices).map(s).filter(Boolean);
    const ask = q && s(q.question ?? q.text) && options.length >= 2 ? { question: s(q.question ?? q.text), options, answer: answerIndex(q.answer ?? q.correct, options) } : null;
    return {
      text: s(st?.text ?? st?.title ?? st?.name ?? st?.heading),
      say: s(st?.say ?? st?.explanation ?? st?.description ?? st?.narration),
      ask,
      actions: lines(st?.actions ?? st?.action).map(fix),
      buttons: arr(st?.buttons ?? st?.button ?? st?.controls).map((b: any) =>
        typeof b === 'string' ? { label: 'Try it', action: fix(s(b)) } : { label: s(b?.label ?? b?.text ?? b?.title) || 'Try it', action: fix(s(b?.action ?? b?.command ?? b?.run)) }).filter((b) => b.action),
      goals: arr(st?.goals ?? st?.goal).flatMap((g) => (typeof g === 'string' ? g.split(',') : [s(g)])).map(s).filter(Boolean).map(fix),
    };
  });
  const title = s(d?.title ?? d?.name) || 'Lesson';
  return { id: s(d?.id) || title, title, about: s(d?.about ?? d?.description ?? d?.summary), entities, links, steps };
}
