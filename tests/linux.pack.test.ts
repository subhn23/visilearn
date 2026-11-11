import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compile, createState, headlessFx, layoutScene, resetTransient, simulate } from '../src/core/index.ts';
import type { Effects, Entity, Runtime, Scene } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';
import { runCommand } from '../src/packs/linux/index.ts';
import type { LinuxState } from '../src/packs/linux/index.ts';

const SRC = `scene linux.t "T"
use linux
fs as=asha show=perms
  home/
    asha/
      notes.txt "buy milk"
      deploy.sh mode=644
        | echo Deploying
        | echo Done
  etc/
    hosts "127.0.0.1 localhost"
  tmp/
step "Where am I"
  run pwd
  run "cd /etc"
  highlight /etc/hosts
step "Challenge"
  goal cwd /home/asha, exists /tmp/b.txt, mode /home/asha/deploy.sh 755, ran ls, output "localhost", contains /tmp/b.txt "milk", missing /home/asha/notes.txt
`;

function build(src = SRC): Scene {
  const { scene, diags } = compile(src, packs);
  assert.ok(scene, diags.map((d) => `L${d.line} ${d.msg}`).join('\n'));
  return scene!;
}

type Call = [string, ...unknown[]];
function recorder(): Effects & { calls: Call[] } {
  const calls: Call[] = [];
  const base = headlessFx();
  return {
    ...base,
    calls,
    badge: (id, t) => calls.push(['badge', id, t]),
    setSub: (id, t) => calls.push(['setSub', id, t]),
    addNode: (e: Entity, parent?: string) => calls.push(['addNode', e.id, e.kind, parent]),
    removeNode: (id) => calls.push(['removeNode', id]),
    flash: async (id, tone) => { calls.push(['flash', id, tone]); },
  };
}

function runtime(scene: Scene, fx: Effects = headlessFx()): Runtime {
  return { scene, state: createState(scene, packs), fx, headless: true, ask: async () => {} };
}

// ---- language ---------------------------------------------------------------------

test('fs block becomes a tree of entities keyed by absolute path', () => {
  const s = build();
  const ids = s.entities.map((e) => e.id);
  assert.deepEqual(ids, ['/', '/home', '/home/asha', '/home/asha/notes.txt', '/home/asha/deploy.sh', '/etc', '/etc/hosts', '/tmp']);
  const byId = Object.fromEntries(s.entities.map((e) => [e.id, e]));
  assert.equal(byId['/'].label, '/');
  assert.equal(byId['/home'].label, 'home/');
  assert.equal(byId['/home/asha/notes.txt'].kind, 'file');
  assert.equal(byId['/home'].kind, 'dir');
  assert.equal(byId['/home/asha/deploy.sh'].sub, '-rw-r--r--', 'show=perms puts the mode under each node');
  assert.ok(s.links.some(([a, b]) => a === '/home' && b === '/home/asha'));
  assert.equal(s.links.length, s.entities.length - 1, 'a tree: one link per non-root node');
});

test('fs and run report helpful errors', () => {
  const bad = compile(`scene linux.b "B"
use linux
fs as=asha colour=red
  notes.txt
    inner.txt
  data/ mode=9z
step "s"
  run sl
  run`, packs);
  assert.equal(bad.scene, null);
  const msgs = bad.diags.map((d) => `L${d.line} ${d.msg}`).join('\n');
  assert.match(msgs, /L3 .*unknown fs option 'colour'/);
  assert.match(msgs, /L5 .*'notes.txt' is a file/);
  assert.match(msgs, /L6 .*bad mode '9z'/);
  assert.match(msgs, /L8 .*unknown command 'sl' \(did you mean 'ls'\?\)/);
  assert.match(msgs, /L9 .*usage: run "command"/);
});

test('steps can reference paths, but unknown paths are reported', () => {
  const r = compile(SRC.replace('highlight /etc/hosts', 'highlight /etc/hostz'), packs);
  assert.match(r.diags.map((d) => d.msg).join('\n'), /unknown entity '\/etc\/hostz' \(did you mean '\/etc\/hosts'\?\)/);
});

// ---- runtime --------------------------------------------------------------------

test('scripted run lines type into the terminal and execute', async () => {
  const s = build();
  const report = await simulate(s, packs);
  assert.deepEqual(report[0].log.map((l) => l.msg), ['$ pwd', '/home/asha', '$ cd /etc']);
  const rt = runtime(s);
  for (const a of s.steps[0].actions) await a.run(rt);
  const st = rt.state.linux as LinuxState;
  assert.equal(st.shell.cwd, '/etc');
  assert.deepEqual(st.term.lines.map((l) => [l.kind, l.text]), [['cmd', 'pwd'], ['out', '/home/asha'], ['cmd', 'cd /etc']]);
  assert.equal(st.term.lines[0].prompt, 'asha@visilearn:~$');
});

test('learner commands drive goals', async () => {
  const s = build();
  const rt = runtime(s);
  const goals = s.steps[1].goals;
  assert.equal(goals.length, 7);
  const met = () => goals.map((g) => g.check(rt));
  assert.deepEqual(met(), [true, false, false, false, false, false, false]);
  for (const cmd of ['cat /etc/hosts', 'ls', 'chmod +x deploy.sh', 'cp notes.txt /tmp/b.txt', 'rm notes.txt']) await runCommand(rt, cmd, { learner: true });
  // `output` checks the latest learner output, which is now empty (rm prints nothing)
  assert.deepEqual(met(), [true, true, true, true, false, true, true]);
  await runCommand(rt, 'cat /etc/hosts', { learner: true });
  assert.ok(met().every(Boolean));
  assert.deepEqual(goals.map((g) => g.label).slice(0, 3), ['Be in /home/asha', '/tmp/b.txt exists', '/home/asha/deploy.sh has mode 755']);
});

test('scripted runs do not count toward "ran" goals', async () => {
  const s = build(SRC.replace('run pwd', 'run ls'));
  const rt = runtime(s);
  for (const a of s.steps[0].actions) await a.run(rt);
  assert.equal(s.steps[1].goals[3].check(rt), false);
});

test('shell events become stage effects', async () => {
  const s = build();
  const fx = recorder();
  const rt = runtime(s, fx);
  await runCommand(rt, 'mkdir /tmp/logs', { learner: true });
  await runCommand(rt, 'cd /tmp/logs', { learner: true });
  await runCommand(rt, 'chmod +x deploy.sh', { learner: true }); // relative to /tmp/logs: fails
  await runCommand(rt, 'chmod +x ~/deploy.sh', { learner: true });
  await runCommand(rt, 'rm ~/notes.txt', { learner: true });
  await runCommand(rt, 'cat /etc/hosts', { learner: true });
  const c = fx.calls.filter(([k]) => k !== 'flash' || true);
  assert.deepEqual(c.find(([k]) => k === 'addNode'), ['addNode', '/tmp/logs', 'dir', '/tmp']);
  assert.ok(c.some((x) => x[0] === 'badge' && x[1] === '/home/asha' && x[2] === null));
  assert.ok(c.some((x) => x[0] === 'badge' && x[1] === '/tmp/logs' && x[2] === 'you are here'));
  assert.ok(c.some((x) => x[0] === 'setSub' && x[1] === '/home/asha/deploy.sh' && x[2] === '-rwxr-xr-x'));
  assert.ok(c.some((x) => x[0] === 'removeNode' && x[1] === '/home/asha/notes.txt'));
  assert.ok(c.some((x) => x[0] === 'flash' && x[1] === '/etc/hosts' && x[2] === 'info'));
});

test('present() marks the starting directory; reset restores files, cwd and terminal', async () => {
  const s = build();
  const fx = recorder();
  const rt = runtime(s, fx);
  packs.linux.present!(rt.state.linux, fx);
  assert.deepEqual(fx.calls.at(-1), ['badge', '/home/asha', 'you are here']);
  await runCommand(rt, 'rm notes.txt', { learner: true });
  await runCommand(rt, 'cd /tmp', { learner: true });
  resetTransient(rt, packs);
  const st = rt.state.linux as LinuxState;
  assert.ok(st.shell.vfs.get('/home/asha/notes.txt'));
  assert.equal(st.shell.cwd, '/home/asha');
  assert.deepEqual(st.term.lines, []);
  assert.deepEqual(st.ran, []);
});

test('terminal listeners hear every new line', async () => {
  const s = build();
  const rt = runtime(s);
  const st = rt.state.linux as LinuxState;
  let n = 0;
  const off = st.term.subscribe(() => n++);
  await runCommand(rt, 'echo hi', { learner: true });
  assert.ok(n >= 2);
  off();
  const before = n;
  await runCommand(rt, 'echo again', { learner: true });
  assert.equal(n, before);
  await runCommand(rt, 'clear', { learner: true });
  assert.deepEqual(st.term.lines, []);
});

test('describe() gives inspector details for a path', () => {
  const s = build();
  const rt = runtime(s);
  const info = packs.linux.describe!(rt.state.linux, '/home/asha/notes.txt');
  assert.deepEqual(info, ['/home/asha/notes.txt', '-rw-r--r--  owner: asha  8 bytes', '“buy milk”']);
});

test('tree layout: deeper paths sit further right', () => {
  const s = build();
  const { pos } = layoutScene(s, packs);
  assert.ok(pos.get('/')!.x < pos.get('/home')!.x);
  assert.ok(pos.get('/home')!.x < pos.get('/home/asha')!.x);
  assert.ok(pos.get('/home/asha')!.x < pos.get('/home/asha/notes.txt')!.x);
  assert.equal(pos.get('/etc')!.x, pos.get('/home')!.x);
});

test('tree layout: parents centred on their children, siblings in order, no overlaps, no crossings', () => {
  const s = build(`scene linux.tree "T"
use linux
fs as=asha
  home/
    asha/
      notes.txt
      projects/
        app.py
        README.md
        tests/
          t.py
  etc/
    hosts
  tmp/
step "s"
  run pwd`);
  const { pos } = layoutScene(s, packs);
  const y = (id: string) => pos.get(id)!.y;
  // siblings keep declaration order top → bottom
  assert.ok(y('/home') < y('/etc') && y('/etc') < y('/tmp'));
  assert.ok(y('/home/asha/projects/app.py') < y('/home/asha/projects/README.md'));
  // a parent sits midway between its first and last child
  const mid = (p: string, a: string, b: string) => assert.equal(y(p), (y(a) + y(b)) / 2, p);
  mid('/home/asha/projects', '/home/asha/projects/app.py', '/home/asha/projects/tests');
  mid('/', '/home', '/tmp');
  // every node has its own spot
  const spots = new Set([...pos.values()].map((p) => `${p.x},${p.y}`));
  assert.equal(spots.size, pos.size);
  // edges between adjacent columns never cross: child order follows parent order
  const cols = new Map<number, string[]>();
  for (const [id, p] of pos) cols.set(p.x, [...(cols.get(p.x) ?? []), id]);
  for (const [a1, b1] of s.links) for (const [a2, b2] of s.links) {
    if (pos.get(a1)!.x !== pos.get(a2)!.x || a1 === a2) continue;
    if (y(a1) < y(a2)) assert.ok(y(b1) <= y(b2), `${a1}->${b1} crosses ${a2}->${b2}`);
  }
});

test('non-tree graphs (several parents) keep the general layout', () => {
  const { scene } = compile(`scene net.x "X"
use net
host a
host b
switch s
server z
link a s z
link b s
step "s"
  a ping z`, packs);
  const { pos } = layoutScene(scene!, packs);
  assert.equal(pos.get('a')!.x, pos.get('b')!.x, 'both hosts share the left column');
});
