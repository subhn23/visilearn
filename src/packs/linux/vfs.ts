// In-memory filesystem with owners and permission bits. DOM-free.

export type NodeType = 'dir' | 'file';

export interface FsSpec {
  name: string;
  type: NodeType;
  content?: string;
  mode?: number;
  owner?: string;
  children?: FsSpec[];
}

export interface FsNode {
  type: NodeType;
  name: string;
  mode: number;
  owner: string;
  content: string;
  children: Map<string, FsNode>;
}

export function normalize(path: string, cwd: string, home: string): string {
  let p = path;
  if (p === '~' || p.startsWith('~/')) p = home + p.slice(1);
  const parts = (p.startsWith('/') ? p : `${cwd}/${p}`).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

export const parentOf = (path: string) => (path === '/' ? '/' : path.slice(0, path.lastIndexOf('/')) || '/');
export const baseName = (path: string) => (path === '/' ? '/' : path.slice(path.lastIndexOf('/') + 1));
export const joinPath = (dir: string, name: string) => (dir === '/' ? `/${name}` : `${dir}/${name}`);

export function modeString(mode: number, type: NodeType): string {
  const bits = 'rwxrwxrwx';
  let s = type === 'dir' ? 'd' : '-';
  for (let i = 0; i < 9; i++) s += mode & (0o400 >> i) ? bits[i] : '-';
  return s;
}

/** chmod spec → new mode, or null if invalid. Supports 755 and u+x,go-w,a=r forms. */
export function parseChmod(spec: string, mode: number): number | null {
  if (/^[0-7]{3}$/.test(spec)) return parseInt(spec, 8);
  let m = mode;
  for (const clause of spec.split(',')) {
    const r = /^([ugoa]*)([+\-=])([rwx]+)$/.exec(clause);
    if (!r) return null;
    const who = r[1] || 'a';
    let perm = 0;
    for (const ch of r[3]) perm |= ch === 'r' ? 4 : ch === 'w' ? 2 : 1;
    let mask = 0;
    for (const w of who === 'a' ? 'ugo' : who) mask |= perm << (w === 'u' ? 6 : w === 'g' ? 3 : 0);
    const whoMask = [...(who === 'a' ? 'ugo' : who)].reduce((acc, w) => acc | (7 << (w === 'u' ? 6 : w === 'g' ? 3 : 0)), 0);
    if (r[2] === '+') m |= mask;
    else if (r[2] === '-') m &= ~mask;
    else m = (m & ~whoMask) | mask;
  }
  return m & 0o777;
}

export type Access = 'r' | 'w' | 'x';

export function can(node: FsNode, user: string, a: Access): boolean {
  if (user === 'root') return a !== 'x' || node.type === 'dir' || (node.mode & 0o111) !== 0;
  const bit = a === 'r' ? 4 : a === 'w' ? 2 : 1;
  return (node.mode & (node.owner === user ? bit << 6 : bit)) !== 0;
}

export function newNode(type: NodeType, name: string, owner: string, mode?: number, content = ''): FsNode {
  return { type, name, owner, content, mode: mode ?? (type === 'dir' ? 0o755 : 0o644), children: new Map() };
}

export function cloneNode(n: FsNode, owner?: string): FsNode {
  const c = { ...n, owner: owner ?? n.owner, children: new Map<string, FsNode>() };
  for (const [k, v] of n.children) c.children.set(k, cloneNode(v, owner));
  return c;
}

export class Vfs {
  root: FsNode;

  constructor(root: FsNode) {
    this.root = root;
  }

  /** Build from a spec. Files under /home/<user> belong to that user; everything else to root. */
  static fromSpec(spec: FsSpec[], user: string): Vfs {
    const root = newNode('dir', '/', 'root');
    const add = (parent: FsNode, items: FsSpec[], path: string) => {
      for (const s of items) {
        const p = joinPath(path, s.name);
        const inHome = p === `/home/${user}` || p.startsWith(`/home/${user}/`);
        const defMode = s.type === 'dir' && p === '/tmp' ? 0o777 : undefined;
        const n = newNode(s.type, s.name, s.owner ?? (inHome ? user : 'root'), s.mode ?? defMode, s.content ?? '');
        parent.children.set(s.name, n);
        if (s.children) add(n, s.children, p);
      }
    };
    add(root, spec, '/');
    return new Vfs(root);
  }

  clone(): Vfs {
    return new Vfs(cloneNode(this.root));
  }

  get(path: string): FsNode | null {
    let n: FsNode | undefined = this.root;
    for (const part of path.split('/').filter(Boolean)) {
      if (n.type !== 'dir') return null;
      n = n.children.get(part);
      if (!n) return null;
    }
    return n;
  }

  /** depth-first list of every path (root first) — used to draw the tree */
  walk(): { path: string; node: FsNode }[] {
    const out: { path: string; node: FsNode }[] = [];
    const visit = (n: FsNode, p: string) => {
      out.push({ path: p, node: n });
      for (const [name, c] of [...n.children].sort(([a], [b]) => a.localeCompare(b))) visit(c, joinPath(p, name));
    };
    visit(this.root, '/');
    return out;
  }
}
