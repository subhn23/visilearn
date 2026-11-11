import { splitArgs } from '../../core/parser.ts';
import type { Action, CompileCtx, Entity, PackDef, Token } from '../../core/types.ts';
import { netIcons } from './icons.ts';
import { evaluate, initNetState, parseRule, sendPacket } from './sim.ts';
import type { NetData, NetState, Packet } from './sim.ts';

function netData(c: CompileCtx): NetData {
  return (c.scene.data.net ??= { rules: {} }) as NetData;
}

function parseTarget(tok: Token | undefined, c: CompileCtx, line: number): { dst: Entity; port: number | null } | null {
  if (!tok) return null;
  const [id, portStr] = tok.v.split(':');
  const dst = c.entity(id, line);
  if (!dst) return null;
  if (portStr === undefined) return { dst, port: null };
  const port = parseInt(portStr, 10);
  if (!/^\d+$/.test(portStr) || port < 1 || port > 65535) { c.error(line, `bad port '${portStr}' (1-65535)`); return null; }
  return { dst, port };
}

function repeatOf(args: Token[]): number {
  const m = args.map((t) => /^x(\d+)$/.exec(t.v)).find(Boolean);
  return m ? Math.min(parseInt(m[1], 10), 10) : 1;
}

function packetAction(line: number, text: string, p: Packet, times: number): Action {
  return {
    line,
    text,
    async run(rt) {
      for (let i = 0; i < times; i++) await sendPacket(rt, p);
    },
  };
}

export const net: PackDef = {
  name: 'net',
  about: 'Computer networking: hosts, servers, firewalls, routers, packets.',
  entities: {
    internet: { tier: 0, sub: 'ip', about: 'The public Internet: anyone, anywhere.' },
    user: { tier: 0, about: 'A person using a device.' },
    host: { tier: 0, sub: 'ip', about: 'A client computer. It starts connections; it usually does not listen on ports.', props: { port: 'listening ports, e.g. 22,80' } },
    router: { tier: 1, sub: 'ip', about: 'A router forwards packets between different networks.' },
    fw: { tier: 2, sub: 'ip', about: 'A firewall checks every packet against its rules, top to bottom. The first matching rule wins; if none match, the default policy applies.' },
    switch: { tier: 3, about: 'A switch connects devices inside one local network (LAN).' },
    server: { tier: 4, sub: 'ip', about: 'A server listens on ports and answers requests.', props: { port: 'listening ports, e.g. 80,443' } },
  },
  directives: {
    rules: {
      usage: 'rules <fw> [editable] [policy=allow|deny]  + indented rule lines',
      compile(s, c) {
        const { pos, kv } = splitArgs(s.args);
        const fw = pos[0] && c.entity(pos[0].v, s.line);
        if (!fw) { if (!pos[0]) c.error(s.line, 'usage: rules <fw> [editable] [policy=deny]'); return; }
        if (fw.kind !== 'fw') c.warn(s.line, `'${fw.id}' is a ${fw.kind}, rules usually belong to a fw`);
        const policy = kv.policy ?? 'deny';
        if (policy !== 'allow' && policy !== 'deny') c.error(s.line, `policy must be allow or deny`);
        const editable = pos.slice(1).some((t) => t.v === 'editable');
        const rules: string[] = [];
        for (const r of s.children) {
          const text = [r.head, ...r.args.map((t) => t.v)].join(' ');
          const res = parseRule(text, c.hasEntity);
          if (res.error) c.error(r.line, res.error);
          else rules.push(res.rule!.text);
        }
        netData(c).rules[fw.id] = { editable, policy: policy as 'allow' | 'deny', rules };
      },
    },
  },
  verbs: {
    send: {
      usage: 'A send B:PORT [xN] [proto=udp]',
      subject: true,
      compile(src, args, s, c) {
        const { pos, kv } = splitArgs(args);
        const t = parseTarget(pos[0], c, s.line);
        if (!t) { if (!pos[0]) c.error(s.line, 'usage: A send B:PORT [xN]'); return null; }
        if (t.port == null) { c.error(s.line, `send needs a port: ${src!.id} send ${t.dst.id}:80 (use 'ping' for ICMP)`); return null; }
        const proto = kv.proto ?? 'tcp';
        if (proto !== 'tcp' && proto !== 'udp') { c.error(s.line, `proto must be tcp or udp`); return null; }
        const n = repeatOf(pos);
        return packetAction(s.line, `${src!.id} send ${t.dst.id}:${t.port}${n > 1 ? ` x${n}` : ''}`, { src: src!.id, dst: t.dst.id, proto, port: t.port }, n);
      },
    },
    ping: {
      usage: 'A ping B [xN]',
      subject: true,
      compile(src, args, s, c) {
        const t = parseTarget(args[0], c, s.line);
        if (!t) { if (!args[0]) c.error(s.line, 'usage: A ping B'); return null; }
        const n = repeatOf(args);
        return packetAction(s.line, `${src!.id} ping ${t.dst.id}`, { src: src!.id, dst: t.dst.id, proto: 'icmp', port: null }, n);
      },
    },
    kill: {
      usage: 'kill A[, B]   (device fails)',
      compile(_s, args, s, c) {
        const ids = args.flatMap((t) => t.v.split(',')).filter(Boolean).filter((id) => c.entity(id, s.line));
        if (!ids.length) return null;
        return {
          line: s.line,
          text: `kill ${ids.join(', ')}`,
          async run(rt) {
            for (const id of ids) {
              (rt.state.net as NetState).down.add(id);
              rt.fx.setDown(id, true);
              rt.fx.log(`⚡ ${id} is down`, 'bad');
            }
            await rt.fx.wait(400);
          },
        };
      },
    },
    revive: {
      usage: 'revive A[, B]',
      compile(_s, args, s, c) {
        const ids = args.flatMap((t) => t.v.split(',')).filter(Boolean).filter((id) => c.entity(id, s.line));
        if (!ids.length) return null;
        return {
          line: s.line,
          text: `revive ${ids.join(', ')}`,
          async run(rt) {
            for (const id of ids) {
              (rt.state.net as NetState).down.delete(id);
              rt.fx.setDown(id, false);
              rt.fx.log(`↺ ${id} is back up`, 'ok');
            }
            await rt.fx.wait(300);
          },
        };
      },
    },
  },
  goalUsage: 'A->B:PORT ok|blocked|refused|unreachable  (A->B ping ok)',
  parseGoal(text, line, c) {
    const m = /^([A-Za-z][\w-]*)\s*(?:->|→)\s*([A-Za-z][\w-]*)(?::(\d+))?(?:\/(tcp|udp))?\s*(ping)?\s+(ok|blocked|refused|unreachable)$/.exec(text);
    if (!m) return null;
    const [, a, b, portStr, proto, ping, want] = m;
    if (!c.entity(a, line) || !c.entity(b, line)) return { line, label: text, check: () => false };
    if (!portStr && !ping) { c.error(line, `goal '${text}' needs :PORT or 'ping'`); return { line, label: text, check: () => false }; }
    const p: Packet = portStr
      ? { src: a, dst: b, proto: (proto as 'tcp' | 'udp') ?? 'tcp', port: parseInt(portStr, 10) }
      : { src: a, dst: b, proto: 'icmp', port: null };
    const verb = { ok: 'gets through', blocked: 'is blocked', refused: 'is refused', unreachable: 'is unreachable' }[want];
    return {
      line,
      label: `${a} → ${b} ${portStr ? `:${portStr}` : 'ping'} ${verb}`,
      check: (rt) => evaluate(rt.scene, rt.state.net as NetState, p).kind === want,
    };
  },
  icons: netIcons,
  initState: initNetState,
  resetTransient(st: NetState) {
    st.down.clear();
  },
  exportUser(st: NetState) {
    const out: Record<string, { policy: string; rules: string[] }> = {};
    for (const [fw, r] of Object.entries(st.rules)) if (r.editable) out[fw] = { policy: r.policy, rules: r.rules.map((x) => x.text) };
    return out;
  },
  importUser(st: NetState, data: unknown) {
    if (!data || typeof data !== 'object') return;
    for (const [fw, saved] of Object.entries(data as Record<string, { policy: string; rules: string[] }>)) {
      const r = st.rules[fw];
      if (!r?.editable || !Array.isArray(saved.rules)) continue;
      if (saved.policy === 'allow' || saved.policy === 'deny') r.policy = saved.policy;
      r.rules = saved.rules.map((t) => parseRule(t, () => true).rule!).filter(Boolean);
    }
  },
  vocab: `# pack: net
kinds (tier left→right): internet, user, host [ip] → router [ip] → fw [ip] → switch → server [ip]
props: port=80,443 (listening; server/host)
e.g.  server web 203.0.113.10 port=80,22 label="Web server"
rules <fw> [editable] [policy=deny|allow]     # first match wins; no match → policy
  allow tcp:22 from laptop to web
  deny udp:53 | allow icmp | deny any
actions:
  A send B:PORT [xN] [proto=udp]   # animates; ok / blocked (at fw) / refused (port closed) / unreachable
  A ping B [xN]
  kill A[, B]   revive A[, B]      # device failure; packets reroute or become unreachable
goal A->B:PORT ok|blocked|refused|unreachable   goal A->B ping ok
Editable rules get a live rule editor + packet lab for the learner.`,
};
