import type { Runtime, Scene } from '../../core/types.ts';

export type Proto = 'tcp' | 'udp' | 'icmp' | 'any';

export interface Rule {
  action: 'allow' | 'deny';
  proto: Proto;
  port: number | null; // null = any port
  from: string; // entity id or 'any'
  to: string;
  text: string;
}

export interface FwRules {
  editable: boolean;
  policy: 'allow' | 'deny';
  rules: Rule[];
  initial: string[]; // original rule texts, for "reset"
  initialPolicy: 'allow' | 'deny';
}

export interface NetState {
  rules: Record<string, FwRules>;
  down: Set<string>;
}

export interface NetData {
  rules: Record<string, { editable: boolean; policy: 'allow' | 'deny'; rules: string[] }>;
}

export interface Packet { src: string; dst: string; proto: Exclude<Proto, 'any'>; port: number | null }

export type Outcome =
  | { kind: 'ok'; path: string[] }
  | { kind: 'refused'; path: string[] }
  | { kind: 'blocked'; path: string[]; at: string; rule: number | null; why: string }
  | { kind: 'unreachable'; path: string[]; why: string };

export const WELL_KNOWN: Record<number, string> = {
  20: 'FTP-data', 21: 'FTP', 22: 'SSH', 23: 'Telnet', 25: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3',
  143: 'IMAP', 443: 'HTTPS', 3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 8080: 'HTTP-alt', 27017: 'MongoDB',
};

export function portName(p: Packet): string {
  if (p.proto === 'icmp') return 'ping';
  const n = p.port != null ? WELL_KNOWN[p.port] : undefined;
  return `${p.proto === 'udp' ? 'udp/' : ''}${p.port}${n ? ` (${n})` : ''}`;
}

/** Parse "allow tcp:22 from laptop to web" | "deny any" | "allow icmp" | "deny udp:53 to dns". */
export function parseRule(text: string, isEntity: (id: string) => boolean): { rule?: Rule; error?: string } {
  const t = text.trim().split(/\s+/).filter(Boolean);
  if (!t.length) return { error: 'empty rule' };
  const action = t[0];
  if (action !== 'allow' && action !== 'deny') return { error: `rule must start with allow or deny, got '${action}'` };
  const spec = t[1] ?? 'any';
  const m = /^(tcp|udp|icmp|any)(?::(\d+|any))?$/.exec(spec);
  if (!m) return { error: `bad match '${spec}': use tcp:22, udp:53, icmp or any` };
  const proto = m[1] as Proto;
  const port = m[2] && m[2] !== 'any' ? parseInt(m[2], 10) : null;
  if (port != null && (port < 1 || port > 65535)) return { error: `port ${port} out of range 1-65535` };
  if (proto === 'icmp' && port != null) return { error: 'icmp has no ports' };
  let from = 'any';
  let to = 'any';
  for (let i = 2; i < t.length; i += 2) {
    const key = t[i];
    const val = t[i + 1];
    if ((key !== 'from' && key !== 'to') || !val) return { error: `expected 'from <id>' or 'to <id>' near '${key}'` };
    if (val !== 'any' && !isEntity(val)) return { error: `unknown entity '${val}'` };
    if (key === 'from') from = val; else to = val;
  }
  return { rule: { action, proto, port, from, to, text: t.join(' ') } };
}

export function initNetState(scene: Scene): NetState {
  const data = (scene.data.net ?? { rules: {} }) as NetData;
  const ids = new Set(scene.entities.map((e) => e.id));
  const rules: Record<string, FwRules> = {};
  for (const [fw, r] of Object.entries(data.rules)) {
    rules[fw] = {
      editable: r.editable,
      policy: r.policy,
      initialPolicy: r.policy,
      initial: [...r.rules],
      rules: r.rules.map((txt) => parseRule(txt, (id) => ids.has(id)).rule!).filter(Boolean),
    };
  }
  return { rules, down: new Set() };
}

export function findPath(scene: Scene, down: Set<string>, a: string, b: string): string[] | null {
  if (down.has(a) || down.has(b)) return null;
  const adj = new Map<string, string[]>();
  for (const [x, y] of scene.links) {
    (adj.get(x) ?? adj.set(x, []).get(x)!).push(y);
    (adj.get(y) ?? adj.set(y, []).get(y)!).push(x);
  }
  const prev = new Map<string, string>([[a, '']]);
  const q = [a];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === b) break;
    for (const n of adj.get(cur) ?? []) {
      if (prev.has(n) || down.has(n)) continue;
      prev.set(n, cur);
      q.push(n);
    }
  }
  if (!prev.has(b)) return null;
  const path = [b];
  while (path[0] !== a) path.unshift(prev.get(path[0])!);
  return path;
}

function matches(r: Rule, p: Packet): boolean {
  return (r.proto === 'any' || r.proto === p.proto)
    && (r.port == null || r.port === p.port)
    && (r.from === 'any' || r.from === p.src)
    && (r.to === 'any' || r.to === p.dst);
}

export function evaluate(scene: Scene, st: NetState, p: Packet): Outcome {
  if (st.down.has(p.src)) return { kind: 'unreachable', path: [], why: `${p.src} is down` };
  const path = findPath(scene, st.down, p.src, p.dst);
  if (!path) {
    const why = st.down.has(p.dst) ? `${p.dst} is down` : `no route from ${p.src} to ${p.dst}`;
    return { kind: 'unreachable', path: [], why };
  }
  for (let i = 1; i < path.length - 1; i++) {
    const fw = st.rules[path[i]];
    if (!fw) continue;
    const idx = fw.rules.findIndex((r) => matches(r, p));
    if (idx >= 0) {
      if (fw.rules[idx].action === 'deny') {
        return { kind: 'blocked', path: path.slice(0, i + 1), at: path[i], rule: idx, why: `rule ${idx + 1}: ${fw.rules[idx].text}` };
      }
    } else if (fw.policy === 'deny') {
      return { kind: 'blocked', path: path.slice(0, i + 1), at: path[i], rule: null, why: 'no rule matched → default policy deny' };
    }
  }
  if (p.proto !== 'icmp') {
    const dst = scene.entities.find((e) => e.id === p.dst)!;
    const listening = (dst.props.port ?? '').split(',').map((x) => parseInt(x, 10));
    if (!listening.includes(p.port!)) return { kind: 'refused', path };
  }
  return { kind: 'ok', path };
}

/** Animate + log one packet. Shared by the `send`/`ping` verbs and the packet lab. */
export async function sendPacket(rt: Runtime, p: Packet): Promise<Outcome> {
  const st = rt.state.net as NetState;
  const o = evaluate(rt.scene, st, p);
  const label = p.proto === 'icmp' ? 'ping' : `:${p.port}`;
  const what = `${p.src} → ${p.dst} ${portName(p)}`;
  switch (o.kind) {
    case 'ok':
      await rt.fx.travel(o.path, { tone: 'ok', label });
      await rt.fx.flash(p.dst, 'ok');
      rt.fx.log(`✓ ${what} delivered${o.path.some((id) => st.rules[id]) ? '; reply allowed back (stateful firewall)' : ''}`, 'ok');
      await rt.fx.travel([...o.path].reverse(), { tone: 'reply', dashed: true, label: p.proto === 'icmp' ? 'pong' : 'reply' });
      break;
    case 'refused':
      await rt.fx.travel(o.path, { tone: 'warn', label });
      await rt.fx.flash(p.dst, 'warn');
      rt.fx.log(`↩ ${what} refused: nothing listening on that port`, 'warn');
      await rt.fx.travel([...o.path].reverse(), { tone: 'warn', dashed: true, label: 'RST' });
      break;
    case 'blocked':
      await rt.fx.travel(o.path, { tone: 'bad', label });
      await rt.fx.flash(o.at, 'bad');
      rt.fx.log(`✕ ${what} dropped by ${o.at} (${o.why})`, 'bad');
      break;
    case 'unreachable':
      if (!st.down.has(p.src)) await rt.fx.flash(p.src, 'bad');
      rt.fx.log(`✕ ${what} unreachable: ${o.why}`, 'bad');
      break;
  }
  return o;
}
