// The concept family: a generic, data-driven graph runtime. The built-in `concept` pack and every
// data pack (from modules / the Studio) are built from this. No code from packs is ever executed:
// packs only name kinds and compose these building blocks.
import { splitArgs } from '../../core/parser.ts';
import type { Action, CompileCtx, Entity, EntityKind, Goal, PackDef, Runtime, Scene, Tone, VerbDef } from '../../core/types.ts';

export const GRAPH = '__graph';
export const PRIMITIVES = ['add', 'remove', 'connect', 'disconnect', 'point', 'set', 'flow', 'mark', 'unmark', 'flash'];
const TONES = ['ok', 'bad', 'warn', 'info'];
const RESERVED_PROPS = new Set(['label', 'info', 'col']);

export interface GraphState {
  scene: Scene;
  present: Set<string>;
  props: Map<string, Record<string, string>>;
  links: [string, string][];
  marks: Map<string, string>;
}

function freshGraph(scene: Scene): Omit<GraphState, 'scene'> {
  const visible = scene.entities.filter((e) => !e.hidden);
  const ids = new Set(visible.map((e) => e.id));
  const props = new Map<string, Record<string, string>>();
  for (const e of scene.entities) props.set(e.id, Object.fromEntries(Object.entries(e.props).filter(([k]) => !RESERVED_PROPS.has(k))));
  return { present: ids, props, links: scene.links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => [a, b]), marks: new Map() };
}

const graph = (rt: Runtime) => rt.state[GRAPH] as GraphState;
const ids = (args: { v: string }[]) => args.flatMap((t) => t.v.split(',')).filter(Boolean);
const isLinked = (g: GraphState, a: string, b: string) => g.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

function act(line: number, text: string, run: (rt: Runtime) => Promise<void> | void): Action {
  return { line, text, run };
}

/** building blocks available in every concept-family pack */
function primitives(): Record<string, VerbDef> {
  return {
    add: {
      usage: 'add KIND ID [to PARENT] [label="…"] [prop=value…]',
      compile(_s, args, s, c) {
        const { pos, kv } = splitArgs(args);
        const [kindTok, idTok, toTok, parentTok] = pos;
        if (!kindTok || !idTok) { c.error(s.line, `usage: ${this.usage}`); return null; }
        const k = c.kindOf(kindTok.v);
        if (!k) { c.error(s.line, `unknown kind '${kindTok.v}'`); return null; }
        if (toTok && toTok.v !== 'to') { c.error(s.line, `expected 'to PARENT' after the id, got '${toTok.v}'`); return null; }
        const parent = parentTok?.v;
        if (toTok && !parent) { c.error(s.line, 'add … to needs a parent id'); return null; }
        if (parent && !c.entity(parent, s.line)) return null;
        const id = idTok.v;
        if (!/^[A-Za-z][\w-]*$/.test(id)) { c.error(s.line, `invalid id '${id}'`); return null; }
        const e: Entity = { id, kind: kindTok.v, pack: k.pack, label: kv.label ?? id, sub: k.def.show ? kv[k.def.show] : undefined, props: kv, line: s.line, hidden: true };
        if (!c.addEntity(e)) return null;
        return act(s.line, `add ${e.kind} ${id}`, async (rt) => {
          const g = graph(rt);
          g.present.add(id);
          g.props.set(id, Object.fromEntries(Object.entries(kv).filter(([key]) => !RESERVED_PROPS.has(key))));
          if (parent && g.present.has(parent)) g.links.push([parent, id]);
          rt.fx.addNode(e, parent && g.present.has(parent) ? parent : undefined);
          await rt.fx.flash(id, 'ok');
        });
      },
    },
    remove: {
      usage: 'remove ID[, ID]',
      compile(_s, args, s, c) {
        const list = ids(args).filter((id) => c.entity(id, s.line));
        if (!list.length) { if (!args.length) c.error(s.line, 'usage: remove ID'); return null; }
        return act(s.line, `remove ${list.join(', ')}`, async (rt) => {
          const g = graph(rt);
          for (const id of list) {
            if (!g.present.has(id)) continue;
            await rt.fx.flash(id, 'bad');
            g.present.delete(id);
            g.links = g.links.filter(([a, b]) => a !== id && b !== id);
            g.marks.delete(id);
            rt.fx.removeNode(id);
          }
        });
      },
    },
    connect: {
      usage: 'connect A B',
      compile(_s, args, s, c) {
        const [a, b] = args.map((t) => t.v);
        if (!a || !b) { c.error(s.line, 'usage: connect A B'); return null; }
        if (!c.entity(a, s.line) || !c.entity(b, s.line)) return null;
        return act(s.line, `connect ${a} ${b}`, (rt) => {
          const g = graph(rt);
          if (!isLinked(g, a, b)) g.links.push([a, b]);
          rt.fx.link(a, b);
        });
      },
    },
    disconnect: {
      usage: 'disconnect A B',
      compile(_s, args, s, c) {
        const [a, b] = args.map((t) => t.v);
        if (!a || !b) { c.error(s.line, 'usage: disconnect A B'); return null; }
        if (!c.entity(a, s.line) || !c.entity(b, s.line)) return null;
        return act(s.line, `disconnect ${a} ${b}`, (rt) => {
          const g = graph(rt);
          g.links = g.links.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
          rt.fx.unlink(a, b);
        });
      },
    },
    point: {
      usage: 'point A B   (A now points only at B, e.g. a branch label)',
      compile(_s, args, s, c) {
        const [a, b] = args.map((t) => t.v);
        if (!a || !b) { c.error(s.line, 'usage: point A B'); return null; }
        if (!c.entity(a, s.line) || !c.entity(b, s.line)) return null;
        return act(s.line, `point ${a} ${b}`, async (rt) => {
          const g = graph(rt);
          for (const [x, y] of g.links.filter(([x]) => x === a)) rt.fx.unlink(x, y);
          g.links = g.links.filter(([x]) => x !== a);
          g.links.push([a, b]);
          rt.fx.link(a, b);
          await rt.fx.flash(a, 'info');
        });
      },
    },
    set: {
      usage: 'set ID prop=value [prop=value…]',
      compile(_s, args, s, c) {
        const { pos, kv } = splitArgs(args);
        const id = pos[0]?.v;
        if (!id || !Object.keys(kv).length) { c.error(s.line, `usage: ${this.usage}`); return null; }
        const e = c.entity(id, s.line);
        if (!e) return null;
        const show = c.kindOf(e.kind)?.def.show;
        return act(s.line, `set ${id} ${Object.entries(kv).map(([k, v]) => `${k}=${v}`).join(' ')}`, async (rt) => {
          const g = graph(rt);
          g.props.set(id, { ...(g.props.get(id) ?? {}), ...kv });
          if (show && kv[show] !== undefined) rt.fx.setSub(id, kv[show]);
          rt.fx.log(`${id}: ${Object.entries(kv).map(([k, v]) => `${k} = ${v}`).join(', ')}`, 'info');
          await rt.fx.flash(id, 'info');
        });
      },
    },
    flow: {
      usage: 'flow A B [C…] [label="…"] [tone=ok|bad|warn]',
      compile(_s, args, s, c) {
        const { pos, kv } = splitArgs(args);
        const path = ids(pos);
        if (path.length < 2) { c.error(s.line, 'usage: flow A B [C…]'); return null; }
        if (!path.every((id) => c.entity(id, s.line))) return null;
        const tone = (kv.tone ?? 'info') as Tone;
        if (!TONES.includes(tone)) { c.error(s.line, `tone must be one of ${TONES.join(', ')}`); return null; }
        return act(s.line, `flow ${path.join(' → ')}`, async (rt) => {
          await rt.fx.travel(path, { tone, label: kv.label });
          if (tone !== 'info') await rt.fx.flash(path[path.length - 1], tone);
        });
      },
    },
    mark: {
      usage: 'mark ID "text"',
      compile(_s, args, s, c) {
        const [id, ...rest] = args;
        const text = rest.map((t) => t.v).join(' ');
        if (!id || !text) { c.error(s.line, 'usage: mark ID "text"'); return null; }
        if (!c.entity(id.v, s.line)) return null;
        return act(s.line, `mark ${id.v}`, (rt) => { graph(rt).marks.set(id.v, text); rt.fx.badge(id.v, text); });
      },
    },
    unmark: {
      usage: 'unmark ID',
      compile(_s, args, s, c) {
        const id = args[0]?.v;
        if (!id) { c.error(s.line, 'usage: unmark ID'); return null; }
        if (!c.entity(id, s.line)) return null;
        return act(s.line, `unmark ${id}`, (rt) => { graph(rt).marks.delete(id); rt.fx.badge(id, null); });
      },
    },
    flash: {
      usage: 'flash ID [ok|bad|warn|info]',
      compile(_s, args, s, c) {
        const [id, toneTok] = args;
        if (!id) { c.error(s.line, 'usage: flash ID [ok|bad|warn|info]'); return null; }
        if (!c.entity(id.v, s.line)) return null;
        const tone = (toneTok?.v ?? 'info') as Tone;
        if (!TONES.includes(tone)) { c.error(s.line, `tone must be one of ${TONES.join(', ')}`); return null; }
        return act(s.line, `flash ${id.v}`, (rt) => rt.fx.flash(id.v, tone));
      },
    },
  };
}

export const CONCEPT_GOALS = 'ID.prop = value | ID.prop != value | exists ID | missing ID | linked A B | count KIND = N (>=, <=)';

function parseGoal(text: string, line: number, c: CompileCtx): Goal | null {
  const g = (rt: Runtime) => graph(rt);
  let m = /^([A-Za-z][\w-]*)\.([A-Za-z_][\w-]*)\s*(=|!=)\s*(.+)$/.exec(text);
  if (m) {
    const [, id, prop, op, value] = m;
    if (!c.entity(id, line)) return { line, label: text, check: () => false };
    const want = value.trim();
    return { line, label: `${id}.${prop} ${op === '=' ? 'is' : 'is not'} ${want}`, check: (rt) => ((g(rt).props.get(id)?.[prop] ?? '') === want) === (op === '=') };
  }
  m = /^(exists|missing)\s+([A-Za-z][\w-]*)$/.exec(text);
  if (m) {
    const [, kw, id] = m;
    if (!c.entity(id, line)) return { line, label: text, check: () => false };
    return { line, label: kw === 'exists' ? `${id} exists` : `${id} is gone`, check: (rt) => g(rt).present.has(id) === (kw === 'exists') };
  }
  m = /^linked\s+([A-Za-z][\w-]*)\s+([A-Za-z][\w-]*)$/.exec(text);
  if (m) {
    const [, a, b] = m;
    if (!c.entity(a, line) || !c.entity(b, line)) return { line, label: text, check: () => false };
    return { line, label: `${a} ↔ ${b} linked`, check: (rt) => isLinked(g(rt), a, b) };
  }
  m = /^count\s+([a-z][\w-]*)\s*(=|>=|<=)\s*(\d+)$/.exec(text);
  if (m) {
    const [, kind, op, nStr] = m;
    if (!c.kindOf(kind)) { c.error(line, `unknown kind '${kind}' in goal`); return { line, label: text, check: () => false }; }
    const n = parseInt(nStr, 10);
    const cmp = (x: number) => (op === '=' ? x === n : op === '>=' ? x >= n : x <= n);
    return {
      line,
      label: `${op === '=' ? '' : op === '>=' ? 'at least ' : 'at most '}${n} ${kind}${n === 1 ? '' : 's'}`,
      check: (rt) => cmp(rt.scene.entities.filter((e) => e.kind === kind && g(rt).present.has(e.id)).length),
    };
  }
  return null;
}

export interface ConceptPackSpec {
  name: string;
  about: string;
  kinds: Record<string, EntityKind>;
  icons: Record<string, string>;
  macros?: Record<string, VerbDef>;
  vocab: string;
  origin: 'builtin' | 'data';
}

export function makeConceptPack(spec: ConceptPackSpec): PackDef {
  return {
    name: spec.name,
    about: spec.about,
    origin: spec.origin,
    stateKey: GRAPH,
    entities: spec.kinds,
    verbs: { ...primitives(), ...(spec.macros ?? {}) },
    goalUsage: CONCEPT_GOALS,
    parseGoal,
    icons: spec.icons,
    initState: (scene: Scene): GraphState => ({ scene, ...freshGraph(scene) }),
    resetTransient(st: GraphState) { Object.assign(st, freshGraph(st.scene)); },
    describe(st: GraphState, id: string) {
      const props = st.props.get(id);
      const lines = props ? Object.entries(props).map(([k, v]) => `${k}: ${v}`) : [];
      const mark = st.marks.get(id);
      return mark ? [...lines, `marked: ${mark}`] : lines;
    },
    vocab: spec.vocab,
  };
}
