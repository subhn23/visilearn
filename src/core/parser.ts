import type { Diag, Stmt, Token } from './types.ts';

/**
 * Line-oriented syntax:
 *   head arg arg key=value "quoted string"   # comment
 *     child (indented)
 */
export function parse(src: string): { stmts: Stmt[]; diags: Diag[] } {
  const diags: Diag[] = [];
  const root: Stmt = { line: 0, indent: -1, head: '', args: [], children: [] };
  const stack: Stmt[] = [root];

  src.split(/\r?\n/).forEach((rawLine, i) => {
    const line = i + 1;
    const expanded = rawLine.replace(/\t/g, '  ');
    const indent = expanded.length - expanded.trimStart().length;
    const tokens = tokenizeLine(expanded.trim(), line, diags);
    if (!tokens.length) return;

    const [first, ...args] = tokens;
    const stmt: Stmt = { line, indent, head: first.v, args, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    stack[stack.length - 1].children.push(stmt);
    stack.push(stmt);
  });

  return { stmts: root.children, diags };
}

function tokenizeLine(s: string, line: number, diags: Diag[]): Token[] {
  const out: Token[] = [];
  let cur = '';
  let started = false;
  let quotedStart = false;
  let inQuote = false;

  const push = () => {
    if (started) out.push({ v: cur, q: quotedStart });
    cur = '';
    started = false;
    quotedStart = false;
  };

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      if (ch === '\\' && i + 1 < s.length) cur += s[++i];
      else if (ch === '"') inQuote = false;
      else cur += ch;
      continue;
    }
    if (ch === '#' && !started) break; // comment
    if (ch === ' ') { push(); continue; }
    if (ch === '"') {
      if (!started) quotedStart = true;
      started = true;
      inQuote = true;
      continue;
    }
    started = true;
    cur += ch;
  }
  if (inQuote) diags.push({ line, severity: 'error', msg: 'unclosed quote' });
  push();
  return out;
}

const KV = /^([A-Za-z_][\w.-]*)=(.*)$/s;

/** Split args into positional values and key=value props. */
export function splitArgs(args: Token[]): { pos: Token[]; kv: Record<string, string> } {
  const pos: Token[] = [];
  const kv: Record<string, string> = {};
  for (const t of args) {
    const m = !t.q && KV.exec(t.v);
    if (m) kv[m[1]] = m[2];
    else pos.push(t);
  }
  return { pos, kv };
}

/** Read "a, b,c" style id lists from the start of pos; returns ids and the remaining tokens. */
export function takeIdList(pos: Token[]): { ids: string[]; rest: Token[] } {
  const ids: string[] = [];
  let i = 0;
  for (; i < pos.length; i++) {
    const t = pos[i];
    if (t.q) break;
    const parts = t.v.split(',').filter(Boolean);
    ids.push(...parts);
    if (!t.v.endsWith(',') && !(pos[i + 1]?.v.startsWith(','))) { i++; break; }
  }
  return { ids, rest: pos.slice(i) };
}
