import { splitArgs } from '../../core/parser.ts';
import type { CompileCtx, Effects, Entity, Goal, PackDef, Runtime, Stmt } from '../../core/types.ts';
import { linuxIcons } from './icons.ts';
import { COMMANDS, Shell, suggest } from './shell.ts';
import { baseName, joinPath, modeString, parentOf, Vfs } from './vfs.ts';
import type { FsNode, FsSpec } from './vfs.ts';

// ---- terminal (shared by scripted runs and the learner's prompt) ----------------------

export interface TermLine {
  id: number;
  kind: 'cmd' | 'out' | 'err';
  text: string;
  prompt?: string;
}

export class Terminal {
  lines: TermLine[] = [];
  private subs = new Set<() => void>();
  private seq = 0;

  push(kind: TermLine['kind'], text: string, prompt?: string): TermLine {
    const l: TermLine = { id: ++this.seq, kind, text, prompt };
    this.lines.push(l);
    if (this.lines.length > 300) this.lines.shift();
    this.notify();
    return l;
  }

  clear() { this.lines = []; this.notify(); }
  notify() { for (const f of this.subs) f(); }
  subscribe(f: () => void): () => void { this.subs.add(f); return () => this.subs.delete(f); }
}

export interface LinuxData {
  spec: FsSpec[];
  user: string;
  cwd?: string;
  showPerms: boolean;
}

export interface LinuxState {
  data: LinuxData;
  shell: Shell;
  term: Terminal;
  /** commands the learner typed (scripted runs excluded) */
  ran: string[];
  /** output of the learner's latest command */
  lastOut: string;
  /** directory currently carrying the "you are here" badge */
  badged: string;
}

const HERE = 'you are here';

function freshShell(d: LinuxData): Shell {
  return new Shell(Vfs.fromSpec(d.spec, d.user), d.user, d.cwd);
}

function entityFor(path: string, n: FsNode, showPerms: boolean, line = 0): Entity {
  return {
    id: path,
    kind: n.type,
    pack: 'linux',
    label: path === '/' ? '/' : n.type === 'dir' ? `${n.name}/` : n.name,
    sub: showPerms ? modeString(n.mode, n.type) : undefined,
    props: {},
    line,
  };
}

/** Type a command into the terminal, run it, and turn shell events into stage effects. */
export async function runCommand(rt: Runtime, line: string, opts: { learner: boolean }): Promise<void> {
  const st = rt.state.linux as LinuxState;
  const fx = rt.fx;
  const prompt = st.shell.prompt();
  fx.log(`$ ${line}`);
  if (opts.learner) st.term.push('cmd', line, prompt);
  else {
    const l = st.term.push('cmd', '', prompt);
    for (const ch of line) { l.text += ch; st.term.notify(); await fx.wait(32); }
    await fx.wait(180);
  }

  const r = st.shell.run(line);
  if (r.clear) st.term.clear();
  for (const o of r.out) st.term.push('out', o);
  for (const e of r.err) st.term.push('err', e);
  r.out.slice(0, 3).forEach((o) => fx.log(o));
  if (r.out.length > 3) fx.log(`… ${r.out.length - 3} more line${r.out.length > 4 ? 's' : ''}`);
  r.err.forEach((e) => fx.log(e, 'bad'));
  if (opts.learner) {
    st.ran.push(line.trim());
    st.lastOut = [...r.out, ...r.err].join('\n');
  }

  const showPerms = st.data.showPerms;
  const addTree = (path: string) => {
    const n = st.shell.vfs.get(path);
    if (!n) return;
    fx.addNode(entityFor(path, n, showPerms), parentOf(path));
    for (const name of [...n.children.keys()].sort()) addTree(joinPath(path, name));
  };

  for (const ev of r.events) {
    switch (ev.type) {
      case 'create': addTree(ev.path); await fx.flash(ev.path, 'ok'); break;
      case 'remove': await fx.flash(ev.path, 'bad'); fx.removeNode(ev.path); break;
      case 'write': await fx.flash(ev.path, 'ok'); break;
      case 'mode': if (showPerms) fx.setSub(ev.path, modeString(ev.mode, st.shell.vfs.get(ev.path)?.type ?? 'file')); await fx.flash(ev.path, 'ok'); break;
      case 'read': await fx.flash(ev.path, 'info'); break;
      case 'denied': await fx.flash(ev.path, 'bad'); break;
      case 'exec': await fx.flash(ev.path, 'ok'); break;
      case 'cwd': break; // badge sync below also covers cwd changes caused by rm
    }
  }
  if (st.badged !== st.shell.cwd) {
    fx.badge(st.badged, null);
    fx.badge(st.shell.cwd, HERE);
    st.badged = st.shell.cwd;
  }
}

// ---- compile helpers -----------------------------------------------------------------

const FS_OPTS = ['as', 'cwd', 'show'];

function parseFsChildren(stmts: Stmt[], c: CompileCtx): FsSpec[] {
  const out: FsSpec[] = [];
  for (const s of stmts) {
    if (s.head === '|') { c.error(s.line, `'|' content lines belong under a file`); continue; }
    const isDir = s.head.endsWith('/');
    const name = isDir ? s.head.slice(0, -1) : s.head;
    if (!name || name.includes('/') || name === '.' || name === '..') { c.error(s.line, `bad name '${s.head}' (one name per line; folders end with /)`); continue; }
    const { pos, kv } = splitArgs(s.args);
    const spec: FsSpec = { name, type: isDir ? 'dir' : 'file' };
    if (kv.mode !== undefined) {
      if (/^[0-7]{3}$/.test(kv.mode)) spec.mode = parseInt(kv.mode, 8);
      else c.error(s.line, `bad mode '${kv.mode}' (use 3 octal digits like 644)`);
    }
    if (kv.owner) spec.owner = kv.owner;
    for (const k of Object.keys(kv)) if (k !== 'mode' && k !== 'owner') c.warn(s.line, `unknown option '${k}' (allowed: mode, owner)`);
    if (isDir) {
      if (pos.length) c.error(s.line, `folders have no content; did you mean a file '${name}'?`);
      spec.children = parseFsChildren(s.children, c);
    } else {
      const lines: string[] = pos.length ? [pos.map((t) => t.v).join(' ')] : [];
      for (const ch of s.children) {
        if (ch.head === '|') lines.push(ch.args.map((t) => t.v).join(' '));
        else c.error(ch.line, `'${name}' is a file; only folders (ending in /) can contain items`);
      }
      spec.content = lines.join('\n');
    }
    out.push(spec);
  }
  return out;
}

function absPath(p: string, line: number, c: CompileCtx, what: string): string | null {
  if (!p || !p.startsWith('/')) { c.error(line, `${what} needs an absolute path like /home/asha (got '${p ?? ''}')`); return null; }
  return p.replace(/\/+$/, '') || '/';
}

function quoted(text: string) { return `“${text}”`; }

export const linux: PackDef = {
  name: 'linux',
  about: 'Linux command line: files, folders, permissions, pipes.',
  entities: {
    dir: { tier: 0, swatch: 'mustard', about: 'A directory (folder) holds files and other directories. Paths like /home/asha describe where it lives.' },
    file: { tier: 1, swatch: 'sky', about: 'A file holds data. Its permissions decide who can read, write or run it.' },
  },
  directives: {
    fs: {
      usage: 'fs [as=user] [cwd=/path] [show=perms]  + indented tree (folders end with /)',
      compile(s, c) {
        const { pos, kv } = splitArgs(s.args);
        if (c.scene.data.linux) { c.error(s.line, 'only one fs block per scene'); return; }
        for (const k of Object.keys(kv)) if (!FS_OPTS.includes(k)) c.error(s.line, `unknown fs option '${k}'; allowed: ${FS_OPTS.join(', ')}`);
        if (pos.length) c.error(s.line, `fs takes options only (e.g. fs as=asha); put files on indented lines`);
        if (kv.show && kv.show !== 'perms') c.error(s.line, `show must be 'perms'`);
        const user = kv.as ?? 'learner';
        if (!/^[a-z_][a-z0-9_-]*$/.test(user)) c.error(s.line, `bad user name '${user}'`);
        const spec = parseFsChildren(s.children, c);
        const showPerms = kv.show === 'perms';
        const vfs = Vfs.fromSpec(spec, user);
        if (kv.cwd) {
          const n = vfs.get(kv.cwd);
          if (!n || n.type !== 'dir') c.error(s.line, `cwd=${kv.cwd} is not a folder in this fs`);
        }
        c.scene.data.linux = { spec, user, cwd: kv.cwd, showPerms } satisfies LinuxData;

        // entities in declaration order: root first, then a depth-first walk of the spec
        c.addEntity(entityFor('/', vfs.root, showPerms, s.line));
        const visit = (items: FsSpec[], dir: string, stmts: Stmt[]) => {
          items.forEach((it, i) => {
            const p = joinPath(dir, it.name);
            const st = stmts.filter((x) => x.head !== '|')[i];
            c.addEntity(entityFor(p, vfs.get(p)!, showPerms, st?.line ?? s.line));
            c.addLink(dir, p);
            if (it.children) visit(it.children, p, st?.children ?? []);
          });
        };
        visit(spec, '/', s.children);
      },
    },
  },
  verbs: {
    run: {
      usage: 'run "command"',
      compile(_s, args, s, c) {
        const line = args.map((t) => t.v).join(' ').trim();
        if (!line) { c.error(s.line, 'usage: run "command"  e.g. run "ls -l"'); return null; }
        for (const seg of line.split('|')) {
          const w = seg.trim().split(/\s+/)[0] === 'sudo' ? seg.trim().split(/\s+/)[1] : seg.trim().split(/\s+/)[0];
          if (w && !COMMANDS.includes(w) && !/^(\.\/|\/|~\/)/.test(w)) c.error(s.line, `unknown command '${w}'${suggest(w)}; known: ${COMMANDS.join(' ')}`);
        }
        return { line: s.line, text: `run ${line}`, run: (rt) => runCommand(rt, line, { learner: false }) };
      },
    },
  },
  goalUsage: 'cwd /path | exists /path | missing /path | mode /path 755 | ran cmd | output text | contains /path text',
  parseGoal(text, line, c): Goal | null {
    const [kw, ...rest] = text.split(/\s+/);
    const arg = rest.join(' ');
    const st = (rt: Runtime) => rt.state.linux as LinuxState;
    switch (kw) {
      case 'cwd': {
        const p = absPath(rest[0], line, c, 'cwd goal');
        return p ? { line, label: `Be in ${p}`, check: (rt) => st(rt).shell.cwd === p } : null;
      }
      case 'exists':
      case 'missing': {
        const p = absPath(rest[0], line, c, `${kw} goal`);
        return p ? { line, label: kw === 'exists' ? `${p} exists` : `${p} is gone`, check: (rt) => !!st(rt).shell.vfs.get(p) === (kw === 'exists') } : null;
      }
      case 'mode': {
        const p = absPath(rest[0], line, c, 'mode goal');
        if (!p) return null;
        if (!/^[0-7]{3}$/.test(rest[1] ?? '')) { c.error(line, `mode goal needs 3 octal digits: mode ${p} 755`); return null; }
        const m = parseInt(rest[1], 8);
        return { line, label: `${p} has mode ${rest[1]}`, check: (rt) => (st(rt).shell.vfs.get(p)?.mode ?? -1) === m };
      }
      case 'ran': {
        if (!arg) { c.error(line, 'usage: goal ran <command>'); return null; }
        return {
          line,
          label: `Run ${arg}`,
          check: (rt) => st(rt).ran.some((l) => {
            const x = l.replace(/^sudo\s+/, '');
            return x === arg || x.startsWith(arg + ' ') || x.split('|').some((seg) => seg.trim() === arg || seg.trim().startsWith(arg + ' '));
          }),
        };
      }
      case 'output': {
        if (!arg) { c.error(line, 'usage: goal output "text"'); return null; }
        return { line, label: `Output shows ${quoted(arg)}`, check: (rt) => st(rt).lastOut.includes(arg) };
      }
      case 'contains': {
        const p = absPath(rest[0], line, c, 'contains goal');
        const needle = rest.slice(1).join(' ');
        if (!p) return null;
        if (!needle) { c.error(line, `usage: goal contains ${p} "text"`); return null; }
        return { line, label: `${p} contains ${quoted(needle)}`, check: (rt) => (st(rt).shell.vfs.get(p)?.content ?? '').includes(needle) };
      }
    }
    return null;
  },
  icons: linuxIcons,
  initState(scene): LinuxState {
    const data = (scene.data.linux as LinuxData | undefined) ?? { spec: [], user: 'learner', showPerms: false };
    const shell = freshShell(data);
    return { data, shell, term: new Terminal(), ran: [], lastOut: '', badged: shell.cwd };
  },
  resetTransient(st: LinuxState) {
    st.shell = freshShell(st.data);
    st.term.clear();
    st.ran = [];
    st.lastOut = '';
    st.badged = st.shell.cwd;
  },
  present(st: LinuxState, fx: Effects) {
    fx.badge(st.shell.cwd, HERE);
    st.badged = st.shell.cwd;
  },
  describe(st: LinuxState, id: string) {
    const n = st.shell.vfs.get(id);
    if (!n) return null;
    const size = n.type === 'dir' ? `${n.children.size} item${n.children.size === 1 ? '' : 's'}` : `${n.content.length} bytes`;
    const out = [id, `${modeString(n.mode, n.type)}  owner: ${n.owner}  ${size}`];
    if (n.type === 'file' && n.content) {
      const first = n.content.split('\n')[0];
      out.push(quoted(first.length > 40 ? first.slice(0, 39) + '…' : first));
    }
    return out;
  },
  vocab: `# pack: linux
fs [as=asha] [cwd=/path] [show=perms]      # one per scene; indented tree, folders end with /
  home/
    asha/
      notes.txt "one-line content"
      deploy.sh mode=644                  # mode=755 owner=root also allowed
        | echo Deploying                  # multi-line content
  etc/
    hosts "127.0.0.1 localhost"
Owners: /home/<as> → that user, else root. Defaults: dirs 755, files 644, /tmp 777.
Entities are absolute paths: highlight /etc/hosts · note /home/asha "your home"
actions: run "cmd"     # typed into the terminal; commands: ${COMMANDS.join(' ')} ./script | pipes > >>
goal cwd /etc · exists /p · missing /p · mode /p 755 · ran cat · output "text" · contains /p "text"
The learner gets a live terminal (history, Tab). "ran"/"output" goals only count the learner's commands.`,
};

export { baseName };
