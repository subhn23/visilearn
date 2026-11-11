// Data packs: a pack defined in text (the pack definition language, see docs/GRAMMAR.md §6).
// The Studio's model writes these; modules carry them; the marketplace distributes them.
// They are data only: kinds (icon, colour, props) + macros over the concept building blocks.
import { parse, splitArgs } from '../../core/parser.ts';
import { didYouMean } from '../../core/suggest.ts';
import type { Action, Diag, EntityKind, PackDef, PackRegistry, Stmt, Token, VerbDef } from '../../core/types.ts';
import { makeConceptPack, PRIMITIVES } from './core.ts';
import { ICONS, iconMarkup } from './icons.ts';

export const PACKDEF_KEYWORDS = ['pack', 'about', 'kind', 'prop', 'macro'];
const SWATCHES = ['mustard', 'mint', 'lilac', 'peach', 'sky', 'rose'];
const CORE_ACTIONS = ['highlight', 'note', 'wait'];
const NAME = /^[a-z][a-z0-9-]{1,31}$/;
const PARAM = /^[A-Z][A-Z0-9_]*$/;
const KIND_OPTS = ['icon', 'swatch', 'tier', 'show', 'about', 'role'];

export interface PackCompileResult {
  pack: PackDef | null;
  diags: Diag[];
}

export function compilePack(src: string, base: PackRegistry): PackCompileResult {
  const { stmts, diags } = parse(src);
  const error = (line: number, msg: string) => diags.push({ line, severity: 'error', msg });
  const warn = (line: number, msg: string) => diags.push({ line, severity: 'warning', msg });

  const head = stmts[0];
  if (!head || head.head !== 'pack') {
    error(head?.line ?? 1, 'first line must be: pack <name> "Title"');
    return { pack: null, diags };
  }
  const { pos: hp } = splitArgs(head.args);
  const name = hp[0]?.v ?? '';
  const title = hp[1]?.v ?? '';
  if (!NAME.test(name)) error(head.line, `pack name '${name}' must be 2-32 lowercase letters, digits or dashes`);
  else if (base[name]) error(head.line, `'${name}' is a built-in pack; choose another name`);
  if (!title) error(head.line, 'pack needs a "Title"');

  let about = title;
  const kinds: Record<string, EntityKind> = {};
  const icons: Record<string, string> = {};
  const macroStmts: Stmt[] = [];
  const vocabKinds: string[] = [];

  for (const s of stmts.slice(1)) {
    switch (s.head) {
      case 'pack': error(s.line, 'only one pack per definition'); break;
      case 'about': about = s.args.map((t) => t.v).join(' '); break;
      case 'kind': {
        const { pos, kv } = splitArgs(s.args);
        const k = pos[0]?.v ?? '';
        if (!/^[a-z][a-z0-9-]*$/.test(k)) { error(s.line, `kind name '${k}' must be lowercase (letters, digits, dashes)`); break; }
        if (kinds[k]) { error(s.line, `duplicate kind '${k}'`); break; }
        if (PRIMITIVES.includes(k) || ['scene', 'use', 'about', 'link', 'step'].includes(k)) { error(s.line, `'${k}' is a reserved word`); break; }
        for (const key of Object.keys(kv)) if (!KIND_OPTS.includes(key)) warn(s.line, `unknown kind option '${key}'${didYouMean(key, KIND_OPTS)}; allowed: ${KIND_OPTS.join(', ')}`);
        const iconSpec = kv.icon ?? 'box';
        const icon = iconMarkup(iconSpec);
        if (icon.error) error(s.line, icon.error + (iconSpec.startsWith('path:') ? '' : didYouMean(iconSpec, Object.keys(ICONS))));
        const swatch = kv.swatch ?? SWATCHES[Object.keys(kinds).length % SWATCHES.length];
        if (!SWATCHES.includes(swatch)) error(s.line, `swatch must be one of ${SWATCHES.join(', ')}`);
        const tier = kv.tier !== undefined ? Number(kv.tier) : 1;
        if (!Number.isInteger(tier) || tier < 0 || tier > 9) error(s.line, 'tier must be a whole number 0-9');
        const props: Record<string, string> = {};
        for (const p of s.children) {
          if (p.head !== 'prop') { error(p.line, `only 'prop NAME ["description"]' lines may be indented under a kind`); continue; }
          const pn = p.args[0]?.v ?? '';
          if (!/^[A-Za-z_][\w-]*$/.test(pn)) { error(p.line, `bad prop name '${pn}'`); continue; }
          props[pn] = p.args.slice(1).map((t) => t.v).join(' ');
        }
        if (kv.show && !props[kv.show] && props[kv.show] !== '') warn(s.line, `show=${kv.show} is not a declared prop of '${k}'`);
        if (kv.role && kv.role !== 'label') error(s.line, `role must be 'label' (a pointer drawn next to what it points at)`);
        kinds[k] = { tier, swatch, about: kv.about ?? `${k} (from the ${name} pack)`, props, ...(kv.show ? { show: kv.show } : {}), ...(kv.role === 'label' ? { role: 'label' as const } : {}) };
        if (icon.svg) icons[k] = icon.svg;
        vocabKinds.push(`kind ${k}${Object.keys(props).length ? ` props: ${Object.keys(props).join(' ')}` : ''}${kv.show ? ` (shows ${kv.show})` : ''}`);
        break;
      }
      case 'macro': macroStmts.push(s); break;
      default: error(s.line, `unknown statement '${s.head}'${didYouMean(s.head, PACKDEF_KEYWORDS)}; a pack has: ${PACKDEF_KEYWORDS.join(', ')}`);
    }
  }
  if (!Object.keys(kinds).length) error(head.line, 'a pack needs at least one kind');

  // ---- macros: named sequences of building blocks, with UPPERCASE parameters ----
  const macroNames = new Set(macroStmts.map((m) => m.args[0]?.v).filter(Boolean));
  const macros: Record<string, VerbDef> = {};
  const vocabMacros: string[] = [];
  for (const m of macroStmts) {
    const [nameTok, ...paramToks] = m.args;
    const mname = nameTok?.v ?? '';
    if (!/^[a-z][a-z0-9-]*$/.test(mname)) { error(m.line, `macro name '${mname}' must be lowercase`); continue; }
    if (PRIMITIVES.includes(mname) || CORE_ACTIONS.includes(mname) || ['ask', 'goal', 'say', 'hint', 'button'].includes(mname)) { error(m.line, `'${mname}' is a built-in action; choose another macro name`); continue; }
    if (macros[mname]) { error(m.line, `duplicate macro '${mname}'`); continue; }
    const params = paramToks.map((t) => t.v);
    const badParam = params.find((p) => !PARAM.test(p));
    if (badParam) { error(m.line, `macro parameters are UPPERCASE words (got '${badParam}')`); continue; }
    if (!m.children.length) { error(m.line, `macro ${mname} has no body (indent its action lines)`); continue; }
    let ok = true;
    for (const b of m.children) {
      if (![...PRIMITIVES, ...CORE_ACTIONS].includes(b.head) && !macroNames.has(b.head)) {
        error(b.line, `unknown action '${b.head}'${didYouMean(b.head, [...PRIMITIVES, ...CORE_ACTIONS, ...macroNames])}; macros may use: ${PRIMITIVES.join(' ')} ${CORE_ACTIONS.join(' ')} and other macros`);
        ok = false;
      }
      for (const t of b.args) {
        for (const w of t.v.match(/\b[A-Z][A-Z0-9_]*\b/g) ?? []) {
          if (!params.includes(w) && !t.q) { error(b.line, `'${w}' is not a parameter of macro ${mname} (parameters: ${params.join(' ') || 'none'})`); ok = false; }
        }
      }
    }
    if (!ok) continue;
    const body = m.children;
    let depth = 0;
    macros[mname] = {
      usage: `${mname} ${params.join(' ')}`.trim(),
      compile(_subject, args, s, c) {
        if (args.length !== params.length) { c.error(s.line, `usage: ${mname} ${params.join(' ')}`); return null; }
        if (depth > 8) { c.error(s.line, `macro ${mname} calls itself too deeply`); return null; }
        const values = Object.fromEntries(params.map((p, i) => [p, args[i].v]));
        const sub = (t: Token): Token => ({ q: t.q, v: t.v.replace(/\b[A-Z][A-Z0-9_]*\b/g, (w) => values[w] ?? w) });
        const actions: Action[] = [];
        depth++;
        try {
          for (const b of body) {
            const a = c.compileAction(values[b.head] ?? b.head, b.args.map(sub), s.line);
            if (!a) return null;
            actions.push(a);
          }
        } finally {
          depth--;
        }
        return { line: s.line, text: `${mname} ${args.map((t) => t.v).join(' ')}`, run: async (rt) => { for (const a of actions) await a.run(rt); } };
      },
    };
    vocabMacros.push(`macro ${mname} ${params.join(' ')}`.trim());
  }

  if (diags.some((d) => d.severity === 'error')) return { pack: null, diags };
  const vocab = [`# pack: ${name}: ${about}`, ...vocabKinds, ...vocabMacros, 'plus every concept building block (add remove connect point set flow mark flash) and goals'].join('\n');
  return { pack: makeConceptPack({ name, about, kinds, icons, macros, vocab, origin: 'data' }), diags };
}
