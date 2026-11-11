// A small, honest bash-like shell over the Vfs. DOM-free; reports what happened as events
// so the stage can animate it (cwd moves, files appear/disappear, permissions change).
import { baseName, can, cloneNode, joinPath, modeString, newNode, normalize, parentOf, parseChmod } from './vfs.ts';
import type { FsNode, Vfs } from './vfs.ts';

export type ShellEvent =
  | { type: 'cwd'; from: string; to: string }
  | { type: 'create'; path: string; kind: 'dir' | 'file' }
  | { type: 'remove'; path: string }
  | { type: 'write'; path: string }
  | { type: 'mode'; path: string; mode: number }
  | { type: 'read'; path: string }
  | { type: 'denied'; path: string }
  | { type: 'exec'; path: string };

export interface ShellResult {
  out: string[];
  err: string[];
  code: number;
  events: ShellEvent[];
  clear?: boolean;
}

export const COMMANDS = ['cat', 'cd', 'chmod', 'clear', 'cp', 'echo', 'grep', 'head', 'help', 'ls', 'mkdir', 'mv', 'pwd', 'rm', 'sudo', 'touch', 'wc', 'whoami'];

const HELP = [
  'Available commands:',
  '  pwd  ls [-l -a]  cd DIR  cat FILE  echo TEXT [> FILE | >> FILE]',
  '  touch FILE  mkdir [-p] DIR  rm [-r] PATH  mv SRC DST  cp [-r] SRC DST',
  '  chmod MODE FILE  grep [-v -c -i] PATTERN [FILE]  wc -l  head -n N',
  '  whoami  sudo CMD  ./script.sh  clear',
  'Combine commands with | (pipe).',
];

/** split a command line into words, honouring "double" and 'single' quotes */
function words(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let started = false;
  let q: string | null = null;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; else cur += ch; continue; }
    if (ch === '"' || ch === "'") { q = ch; started = true; continue; }
    if (/\s/.test(ch)) { if (started) out.push(cur); cur = ''; started = false; continue; }
    cur += ch;
    started = true;
  }
  if (started) out.push(cur);
  return out;
}

/** split on | outside quotes */
function pipeline(line: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let q: string | null = null;
  for (const ch of line) {
    if (q) { if (ch === q) q = null; cur += ch; continue; }
    if (ch === '"' || ch === "'") q = ch;
    if (ch === '|') { parts.push(cur); cur = ''; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
}

function flags(args: string[]): { f: Set<string>; rest: string[] } {
  const f = new Set<string>();
  const rest: string[] = [];
  for (const a of args) {
    if (/^-[A-Za-z]+$/.test(a)) for (const ch of a.slice(1)) f.add(ch);
    else rest.push(a);
  }
  return { f, rest };
}

function suggest(cmd: string): string {
  const sorted = (s: string) => [...s].sort().join('');
  const hit = COMMANDS.find((c) => (c.length === cmd.length && sorted(c) === sorted(cmd)) || (Math.abs(c.length - cmd.length) <= 1 && c.startsWith(cmd.slice(0, -1)) && cmd.length > 1));
  return hit ? ` (did you mean '${hit}'?)` : '';
}

class Ctx {
  out: string[] = [];
  err: string[] = [];
  events: ShellEvent[] = [];
  code = 0;
  user: string;
  constructor(user: string) { this.user = user; }
  fail(msg: string, code = 1) { this.err.push(msg); this.code = code; }
}

export class Shell {
  vfs: Vfs;
  user: string;
  cwd: string;
  home: string;
  private depth = 0;

  constructor(vfs: Vfs, user: string, cwd?: string) {
    this.vfs = vfs;
    this.user = user;
    this.home = user === 'root' ? '/root' : `/home/${user}`;
    this.cwd = cwd ?? (vfs.get(this.home) ? this.home : '/');
  }

  prompt(): string {
    const p = this.cwd === this.home ? '~' : this.cwd.startsWith(this.home + '/') ? '~' + this.cwd.slice(this.home.length) : this.cwd;
    return `${this.user}@visilearn:${p}$`;
  }

  private abs(p: string) { return normalize(p, this.cwd, this.home); }

  run(line: string): ShellResult {
    const segments = pipeline(line).map((s) => s.trim());
    if (segments.every((s) => !s)) return { out: [], err: [], code: 0, events: [] };
    let input: string[] | null = null;
    let res: ShellResult = { out: [], err: [], code: 0, events: [] };
    const events: ShellEvent[] = [];
    const errs: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      let argv = words(segments[i]);
      let redirect: { file: string; append: boolean } | null = null;
      const r = argv.findIndex((w) => w === '>' || w === '>>');
      if (r >= 0 && i === segments.length - 1) {
        redirect = { file: argv[r + 1] ?? '', append: argv[r] === '>>' };
        argv = argv.slice(0, r);
      }
      res = this.exec(argv, input, this.user);
      events.push(...res.events);
      errs.push(...res.err);
      if (redirect) {
        const ctx = new Ctx(this.user);
        this.writeFile(ctx, redirect.file, res.out, redirect.append, 'bash');
        events.push(...ctx.events);
        errs.push(...ctx.err);
        res = { ...res, out: [], code: ctx.code || res.code };
      }
      input = res.out;
    }
    return { out: res.out, err: errs, code: res.code, events, clear: res.clear };
  }

  private exec(argv: string[], input: string[] | null, user: string): ShellResult {
    const [cmd, ...args] = argv;
    const c = new Ctx(user);
    const done = (extra: Partial<ShellResult> = {}): ShellResult => ({ out: c.out, err: c.err, code: c.code, events: c.events, ...extra });
    if (!cmd) return done();

    if (cmd.startsWith('./') || cmd.startsWith('/') || cmd.startsWith('~/')) return this.script(c, cmd, done);

    switch (cmd) {
      case 'pwd': c.out.push(this.cwd); break;
      case 'whoami': c.out.push(user); break;
      case 'clear': return done({ clear: true });
      case 'help': c.out.push(...HELP); break;
      case 'echo': c.out.push(args.join(' ')); break;
      case 'sudo': {
        if (!args.length) { c.fail('usage: sudo COMMAND'); break; }
        return this.exec(args, input, 'root');
      }
      case 'cd': {
        const target = this.abs(args[0] ?? '~');
        const n = this.vfs.get(target);
        if (!n) c.fail(`cd: ${args[0]}: No such file or directory`);
        else if (n.type !== 'dir') c.fail(`cd: ${args[0]}: Not a directory`);
        else if (!can(n, user, 'x')) { c.fail(`cd: ${args[0]}: Permission denied`); c.events.push({ type: 'denied', path: target }); }
        else if (target !== this.cwd) { c.events.push({ type: 'cwd', from: this.cwd, to: target }); this.cwd = target; }
        break;
      }
      case 'ls': {
        const { f, rest } = flags(args);
        for (const a of rest.length ? rest : ['.']) {
          const p = this.abs(a);
          const n = this.vfs.get(p);
          if (!n) { c.fail(`ls: cannot access '${a}': No such file or directory`, 2); continue; }
          if (n.type === 'dir' && !can(n, user, 'r')) { c.fail(`ls: cannot open directory '${a}': Permission denied`, 2); c.events.push({ type: 'denied', path: p }); continue; }
          c.events.push({ type: 'read', path: p });
          const items = n.type === 'dir'
            ? [...n.children.values()].filter((x) => f.has('a') || !x.name.startsWith('.')).sort((x, y) => x.name.localeCompare(y.name))
            : [n];
          if (f.has('l')) {
            for (const x of items) c.out.push(`${modeString(x.mode, x.type)} ${x.owner.padEnd(5)} ${(x.type === 'dir' ? '-' : String(x.content.length)).padStart(4)} ${x.name}`);
          } else if (items.length) c.out.push(items.map((x) => x.name).join('  '));
        }
        break;
      }
      case 'cat': {
        if (!args.length) { c.out.push(...(input ?? [])); break; }
        for (const a of args) {
          const n = this.readable(c, 'cat', a);
          if (n) c.out.push(...lines(n.content));
        }
        break;
      }
      case 'grep': {
        const { f, rest } = flags(args);
        const [pattern, file] = rest;
        if (pattern === undefined) { c.fail('usage: grep [-v -c -i] PATTERN [FILE]', 2); break; }
        let src = input ?? [];
        if (file) { const n = this.readable(c, 'grep', file); if (!n) break; src = lines(n.content); }
        const needle = f.has('i') ? pattern.toLowerCase() : pattern;
        const hits = src.filter((l) => (f.has('i') ? l.toLowerCase() : l).includes(needle) !== f.has('v'));
        if (f.has('c')) c.out.push(String(hits.length)); else c.out.push(...hits);
        if (!hits.length) c.code = 1;
        break;
      }
      case 'wc': {
        const { rest } = flags(args);
        if (rest[0]) { const n = this.readable(c, 'wc', rest[0]); if (n) c.out.push(`${lines(n.content).length} ${rest[0]}`); }
        else c.out.push(String((input ?? []).length));
        break;
      }
      case 'head': {
        let n = 10;
        const rest: string[] = [];
        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-n') n = parseInt(args[++i] ?? '10', 10) || 10;
          else rest.push(args[i]);
        }
        let src = input ?? [];
        if (rest[0]) { const node = this.readable(c, 'head', rest[0]); if (!node) break; src = lines(node.content); }
        c.out.push(...src.slice(0, n));
        break;
      }
      case 'touch': {
        for (const a of args) {
          const p = this.abs(a);
          if (this.vfs.get(p)) continue;
          this.create(c, 'touch', `cannot touch '${a}'`, p, 'file');
        }
        break;
      }
      case 'mkdir': {
        const { f, rest } = flags(args);
        for (const a of rest) {
          const p = this.abs(a);
          if (this.vfs.get(p)) { if (!f.has('p')) c.fail(`mkdir: cannot create directory '${a}': File exists`); continue; }
          if (f.has('p')) {
            const parts = p.split('/').filter(Boolean);
            let cur = '';
            for (const part of parts) {
              cur += '/' + part;
              if (!this.vfs.get(cur) && !this.create(c, 'mkdir', `cannot create directory '${a}'`, cur, 'dir')) break;
            }
          } else this.create(c, 'mkdir', `cannot create directory '${a}'`, p, 'dir');
        }
        break;
      }
      case 'rm': {
        const { f, rest } = flags(args);
        for (const a of rest) {
          const p = this.abs(a);
          const n = this.vfs.get(p);
          if (!n || p === '/') { c.fail(`rm: cannot remove '${a}': No such file or directory`); continue; }
          if (n.type === 'dir' && !f.has('r')) { c.fail(`rm: cannot remove '${a}': Is a directory`); continue; }
          if (!this.writableDir(c, 'rm', `cannot remove '${a}'`, parentOf(p))) continue;
          this.vfs.get(parentOf(p))!.children.delete(baseName(p));
          c.events.push({ type: 'remove', path: p });
          if (this.cwd === p || this.cwd.startsWith(p + '/')) this.cwd = parentOf(p);
        }
        break;
      }
      case 'mv':
      case 'cp': {
        const { f, rest } = flags(args);
        const [srcA, dstA] = rest;
        if (!srcA || !dstA) { c.fail(`${cmd}: missing file operand`); break; }
        const src = this.abs(srcA);
        const node = this.vfs.get(src);
        if (!node) { c.fail(`${cmd}: cannot stat '${srcA}': No such file or directory`); break; }
        if (cmd === 'cp' && node.type === 'dir' && !f.has('r')) { c.fail(`cp: -r not specified; omitting directory '${srcA}'`); break; }
        if (cmd === 'cp' && !can(node, user, 'r')) { c.fail(`cp: cannot open '${srcA}': Permission denied`); c.events.push({ type: 'denied', path: src }); break; }
        let dst = this.abs(dstA);
        if (this.vfs.get(dst)?.type === 'dir') dst = joinPath(dst, baseName(src));
        if (dst === src || dst.startsWith(src + '/')) { c.fail(`${cmd}: cannot move '${srcA}' into itself`); break; }
        if (!this.writableDir(c, cmd, `cannot create '${dstA}'`, parentOf(dst))) break;
        if (cmd === 'mv') {
          if (!this.writableDir(c, cmd, `cannot move '${srcA}'`, parentOf(src))) break;
          this.vfs.get(parentOf(src))!.children.delete(baseName(src));
          c.events.push({ type: 'remove', path: src });
        }
        const existed = !!this.vfs.get(dst);
        const copy = cmd === 'mv' ? { ...node, name: baseName(dst) } : { ...cloneNode(node, user), name: baseName(dst) };
        this.vfs.get(parentOf(dst))!.children.set(baseName(dst), copy);
        c.events.push(existed ? { type: 'write', path: dst } : { type: 'create', path: dst, kind: node.type });
        break;
      }
      case 'chmod': {
        const [spec, ...files] = args;
        if (!spec || !files.length) { c.fail('usage: chmod MODE FILE'); break; }
        for (const a of files) {
          const p = this.abs(a);
          const n = this.vfs.get(p);
          if (!n) { c.fail(`chmod: cannot access '${a}': No such file or directory`); continue; }
          if (user !== 'root' && n.owner !== user) { c.fail(`chmod: changing permissions of '${a}': Operation not permitted`); c.events.push({ type: 'denied', path: p }); continue; }
          const m = parseChmod(spec, n.mode);
          if (m === null) { c.fail(`chmod: invalid mode: '${spec}'`); break; }
          n.mode = m;
          c.events.push({ type: 'mode', path: p, mode: m });
        }
        break;
      }
      default:
        c.fail(`${cmd}: command not found${suggest(cmd)}`, 127);
    }
    return done();
  }

  private script(c: Ctx, cmd: string, done: (e?: Partial<ShellResult>) => ShellResult): ShellResult {
    const p = this.abs(cmd);
    const n = this.vfs.get(p);
    if (!n) { c.fail(`bash: ${cmd}: No such file or directory`, 127); return done(); }
    if (n.type === 'dir') { c.fail(`bash: ${cmd}: Is a directory`, 126); return done(); }
    if (!can(n, c.user, 'x') || !can(n, c.user, 'r')) {
      c.fail(`bash: ${cmd}: Permission denied`, 126);
      c.events.push({ type: 'denied', path: p });
      return done();
    }
    c.events.push({ type: 'exec', path: p });
    if (this.depth > 3) return done();
    this.depth++;
    try {
      for (const line of lines(n.content)) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const r = this.run(line);
        c.out.push(...r.out);
        c.err.push(...r.err);
        c.events.push(...r.events);
        c.code = r.code;
      }
    } finally {
      this.depth--;
    }
    return done();
  }

  private readable(c: Ctx, cmd: string, a: string): FsNode | null {
    const p = this.abs(a);
    const n = this.vfs.get(p);
    if (!n) { c.fail(`${cmd}: ${a}: No such file or directory`); return null; }
    if (n.type === 'dir') { c.fail(`${cmd}: ${a}: Is a directory`); return null; }
    if (!can(n, c.user, 'r')) { c.fail(`${cmd}: ${a}: Permission denied`); c.events.push({ type: 'denied', path: p }); return null; }
    c.events.push({ type: 'read', path: p });
    return n;
  }

  private writableDir(c: Ctx, cmd: string, what: string, dir: string): boolean {
    const d = this.vfs.get(dir);
    if (!d || d.type !== 'dir') { c.fail(`${cmd}: ${what}: No such file or directory`); return false; }
    if (!can(d, c.user, 'w')) { c.fail(`${cmd}: ${what}: Permission denied`); c.events.push({ type: 'denied', path: dir }); return false; }
    return true;
  }

  private create(c: Ctx, cmd: string, what: string, p: string, kind: 'dir' | 'file'): boolean {
    if (!this.writableDir(c, cmd, what, parentOf(p))) return false;
    this.vfs.get(parentOf(p))!.children.set(baseName(p), newNode(kind, baseName(p), c.user));
    c.events.push({ type: 'create', path: p, kind });
    return true;
  }

  private writeFile(c: Ctx, file: string, out: string[], append: boolean, cmd: string) {
    if (!file) { c.fail(`${cmd}: syntax error near unexpected token 'newline'`, 2); return; }
    const p = this.abs(file);
    const n = this.vfs.get(p);
    const text = out.join('\n');
    if (n) {
      if (n.type === 'dir') { c.fail(`${cmd}: ${file}: Is a directory`); return; }
      if (!can(n, c.user, 'w')) { c.fail(`${cmd}: ${file}: Permission denied`); c.events.push({ type: 'denied', path: p }); return; }
      n.content = append && n.content ? `${n.content}\n${text}` : text;
      c.events.push({ type: 'write', path: p });
    } else if (this.create(c, cmd, file, p, 'file')) {
      this.vfs.get(p)!.content = text;
    }
  }

  // ---- tab completion ------------------------------------------------------------

  candidates(line: string): string[] {
    const ws = line.split(' ');
    const last = ws[ws.length - 1];
    if (ws.length === 1) return COMMANDS.filter((c) => c.startsWith(last));
    const slash = last.lastIndexOf('/');
    const dirPart = slash >= 0 ? last.slice(0, slash + 1) : '';
    const prefix = last.slice(slash + 1);
    const dir = this.vfs.get(this.abs(dirPart || '.'));
    if (!dir || dir.type !== 'dir') return [];
    return [...dir.children.values()]
      .filter((n) => n.name.startsWith(prefix) && (prefix.startsWith('.') || !n.name.startsWith('.')))
      .map((n) => n.name + (n.type === 'dir' ? '/' : ''));
  }

  complete(line: string): string {
    const ws = line.split(' ');
    const last = ws[ws.length - 1];
    const cands = this.candidates(line);
    if (cands.length !== 1) return line;
    const head = ws.slice(0, -1).join(' ');
    const slash = last.lastIndexOf('/');
    const dirPart = ws.length === 1 ? '' : slash >= 0 ? last.slice(0, slash + 1) : '';
    const name = cands[0];
    const done = ws.length === 1 || !name.endsWith('/') ? `${name} `.replace(/\/ $/, '/') : name;
    return (head ? head + ' ' : '') + dirPart + done;
  }
}

function lines(content: string): string[] {
  return content === '' ? [] : content.split('\n');
}
