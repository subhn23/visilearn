import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Shell } from '../src/packs/linux/shell.ts';
import { modeString, normalize, parseChmod, Vfs } from '../src/packs/linux/vfs.ts';
import type { FsSpec } from '../src/packs/linux/vfs.ts';

const spec: FsSpec[] = [
  { name: 'home', type: 'dir', children: [
    { name: 'asha', type: 'dir', children: [
      { name: 'notes.txt', type: 'file', content: 'buy milk\ncall mom' },
      { name: '.secret', type: 'file', content: 'shh' },
      { name: 'deploy.sh', type: 'file', content: 'echo Deploying...\necho Done' },
      { name: 'projects', type: 'dir', children: [{ name: 'app.py', type: 'file', content: "print('hi')" }] },
    ] },
  ] },
  { name: 'etc', type: 'dir', children: [
    { name: 'hosts', type: 'file', content: '127.0.0.1 localhost' },
    { name: 'shadow', type: 'file', content: 'root:x', mode: 0o600 },
  ] },
  { name: 'var', type: 'dir', children: [{ name: 'log', type: 'dir', children: [
    { name: 'app.log', type: 'file', content: 'ok start\nerror disk full\nok retry\nerror timeout\nok done' },
  ] }] },
  { name: 'tmp', type: 'dir', children: [] },
];

const fresh = () => new Shell(Vfs.fromSpec(spec, 'asha'), 'asha', '/home/asha');

// ---- vfs helpers --------------------------------------------------------------

test('normalize resolves relative, ~, . and .. paths', () => {
  assert.equal(normalize('projects', '/home/asha', '/home/asha'), '/home/asha/projects');
  assert.equal(normalize('../..', '/home/asha', '/home/asha'), '/');
  assert.equal(normalize('../../..', '/home/asha', '/home/asha'), '/');
  assert.equal(normalize('~/projects/./app.py', '/', '/home/asha'), '/home/asha/projects/app.py');
  assert.equal(normalize('/etc//hosts/', '/tmp', '/home/asha'), '/etc/hosts');
  assert.equal(normalize('~', '/etc', '/home/asha'), '/home/asha');
});

test('ownership and default modes come from the spec', () => {
  const v = Vfs.fromSpec(spec, 'asha');
  assert.equal(v.get('/home/asha/notes.txt')!.owner, 'asha');
  assert.equal(v.get('/etc/hosts')!.owner, 'root');
  assert.equal(v.get('/home/asha')!.mode, 0o755);
  assert.equal(v.get('/etc/hosts')!.mode, 0o644);
  assert.equal(v.get('/tmp')!.mode, 0o777);
  assert.equal(v.get('/etc/shadow')!.mode, 0o600);
});

test('modeString and parseChmod', () => {
  assert.equal(modeString(0o755, 'dir'), 'drwxr-xr-x');
  assert.equal(modeString(0o640, 'file'), '-rw-r-----');
  assert.equal(parseChmod('755', 0o644), 0o755);
  assert.equal(parseChmod('+x', 0o644), 0o755);
  assert.equal(parseChmod('u+x', 0o644), 0o744);
  assert.equal(parseChmod('go-r', 0o644), 0o600);
  assert.equal(parseChmod('a=r', 0o755), 0o444);
  assert.equal(parseChmod('u+rw,g-r', 0o444), 0o604);
  assert.equal(parseChmod('banana', 0o644), null);
  assert.equal(parseChmod('999', 0o644), null);
});

// ---- navigation -----------------------------------------------------------------

test('pwd, cd and the prompt', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('pwd').out, ['/home/asha']);
  assert.equal(sh.prompt(), 'asha@visilearn:~$');
  const r = sh.run('cd projects');
  assert.equal(r.code, 0);
  assert.deepEqual(r.events, [{ type: 'cwd', from: '/home/asha', to: '/home/asha/projects' }]);
  assert.equal(sh.prompt(), 'asha@visilearn:~/projects$');
  sh.run('cd /etc');
  assert.equal(sh.prompt(), 'asha@visilearn:/etc$');
  sh.run('cd');
  assert.equal(sh.cwd, '/home/asha');
});

test('cd errors', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('cd nope').err, ['cd: nope: No such file or directory']);
  assert.deepEqual(sh.run('cd notes.txt').err, ['cd: notes.txt: Not a directory']);
  assert.equal(sh.run('cd nope').code, 1);
  assert.equal(sh.cwd, '/home/asha');
});

test('ls hides dotfiles unless -a, and -l shows mode, owner and size', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('ls').out, ['deploy.sh  notes.txt  projects']);
  assert.deepEqual(sh.run('ls -a').out, ['.secret  deploy.sh  notes.txt  projects']);
  assert.deepEqual(sh.run('ls -l').out, [
    '-rw-r--r-- asha    27 deploy.sh',
    '-rw-r--r-- asha    17 notes.txt',
    'drwxr-xr-x asha     - projects',
  ]);
  assert.deepEqual(sh.run('ls /etc').out, ['hosts  shadow']);
  assert.deepEqual(sh.run('ls notes.txt').out, ['notes.txt']);
  assert.deepEqual(sh.run('ls /nope').err, ["ls: cannot access '/nope': No such file or directory"]);
  assert.deepEqual(sh.run('ls /tmp').out, []);
  assert.deepEqual(sh.run('ls /etc').events, [{ type: 'read', path: '/etc' }]);
});

// ---- reading -------------------------------------------------------------------------

test('cat prints files and reports errors', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('cat notes.txt').out, ['buy milk', 'call mom']);
  assert.deepEqual(sh.run('cat notes.txt').events, [{ type: 'read', path: '/home/asha/notes.txt' }]);
  assert.deepEqual(sh.run('cat projects').err, ['cat: projects: Is a directory']);
  assert.deepEqual(sh.run('cat x.txt').err, ['cat: x.txt: No such file or directory']);
  const denied = sh.run('cat /etc/shadow');
  assert.deepEqual(denied.err, ['cat: /etc/shadow: Permission denied']);
  assert.deepEqual(denied.events, [{ type: 'denied', path: '/etc/shadow' }]);
});

test('grep, wc, head and pipes', () => {
  const sh = fresh();
  sh.run('cd /var/log');
  assert.deepEqual(sh.run('grep error app.log').out, ['error disk full', 'error timeout']);
  assert.deepEqual(sh.run('wc -l app.log').out, ['5 app.log']);
  assert.deepEqual(sh.run('head -n 2 app.log').out, ['ok start', 'error disk full']);
  assert.deepEqual(sh.run('cat app.log | grep error | wc -l').out, ['2']);
  assert.deepEqual(sh.run('cat app.log | grep -v ok').out, ['error disk full', 'error timeout']);
  assert.deepEqual(sh.run('grep -c ok app.log').out, ['3']);
});

// ---- writing -------------------------------------------------------------------------

test('echo with > and >> creates and appends files', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('echo hello world').out, ['hello world']);
  const r = sh.run('echo first > todo.txt');
  assert.deepEqual(r.out, []);
  assert.deepEqual(r.events, [{ type: 'create', path: '/home/asha/todo.txt', kind: 'file' }]);
  sh.run('echo second >> todo.txt');
  assert.deepEqual(sh.run('cat todo.txt').out, ['first', 'second']);
  assert.deepEqual(sh.run('echo again > todo.txt').events, [{ type: 'write', path: '/home/asha/todo.txt' }]);
  assert.deepEqual(sh.run('cat todo.txt').out, ['again']);
  assert.deepEqual(sh.run('grep -c o notes.txt > count.txt').out, []);
  assert.deepEqual(sh.run('cat count.txt').out, ['1']);
});

test('touch, mkdir (-p) and rm (-r) emit tree events', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('touch a.txt').events, [{ type: 'create', path: '/home/asha/a.txt', kind: 'file' }]);
  assert.deepEqual(sh.run('mkdir docs').events, [{ type: 'create', path: '/home/asha/docs', kind: 'dir' }]);
  assert.deepEqual(sh.run('mkdir docs').err, ["mkdir: cannot create directory 'docs': File exists"]);
  assert.deepEqual(sh.run('mkdir x/y').err, ["mkdir: cannot create directory 'x/y': No such file or directory"]);
  assert.deepEqual(sh.run('mkdir -p x/y').events, [
    { type: 'create', path: '/home/asha/x', kind: 'dir' },
    { type: 'create', path: '/home/asha/x/y', kind: 'dir' },
  ]);
  assert.deepEqual(sh.run('rm docs').err, ['rm: cannot remove \'docs\': Is a directory']);
  assert.deepEqual(sh.run('rm -r x').events, [{ type: 'remove', path: '/home/asha/x' }]);
  assert.deepEqual(sh.run('rm a.txt').events, [{ type: 'remove', path: '/home/asha/a.txt' }]);
  assert.equal(sh.vfs.get('/home/asha/a.txt'), null);
  assert.deepEqual(sh.run('rm ghost').err, ["rm: cannot remove 'ghost': No such file or directory"]);
});

test('mv renames/moves and cp copies', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('mv notes.txt todo.txt').events, [
    { type: 'remove', path: '/home/asha/notes.txt' },
    { type: 'create', path: '/home/asha/todo.txt', kind: 'file' },
  ]);
  sh.run('mv todo.txt projects');
  assert.ok(sh.vfs.get('/home/asha/projects/todo.txt'));
  assert.deepEqual(sh.run('cp projects/todo.txt /tmp/backup.txt').events, [{ type: 'create', path: '/tmp/backup.txt', kind: 'file' }]);
  assert.deepEqual(sh.run('cat /tmp/backup.txt').out, ['buy milk', 'call mom']);
  assert.deepEqual(sh.run('cp projects /tmp').err, ["cp: -r not specified; omitting directory 'projects'"]);
  sh.run('cp -r projects /tmp/proj');
  assert.ok(sh.vfs.get('/tmp/proj/app.py'));
});

// ---- permissions -------------------------------------------------------------------

test('writing outside your files needs permission; sudo runs as root', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('touch /etc/motd').err, ["touch: cannot touch '/etc/motd': Permission denied"]);
  assert.deepEqual(sh.run('touch /etc/motd').events, [{ type: 'denied', path: '/etc' }]);
  assert.equal(sh.run('sudo touch /etc/motd').code, 0);
  assert.equal(sh.vfs.get('/etc/motd')!.owner, 'root');
  assert.deepEqual(sh.run('sudo cat /etc/shadow').out, ['root:x']);
  assert.deepEqual(sh.run('whoami').out, ['asha']);
  assert.deepEqual(sh.run('sudo whoami').out, ['root']);
  assert.ok(sh.run('touch /tmp/ok').code === 0, '/tmp is world-writable');
});

test('chmod changes modes; only the owner (or root) may', () => {
  const sh = fresh();
  assert.deepEqual(sh.run('chmod +x deploy.sh').events, [{ type: 'mode', path: '/home/asha/deploy.sh', mode: 0o755 }]);
  assert.deepEqual(sh.run('chmod 600 /etc/hosts').err, ["chmod: changing permissions of '/etc/hosts': Operation not permitted"]);
  assert.deepEqual(sh.run('chmod wat deploy.sh').err, ["chmod: invalid mode: 'wat'"]);
  assert.equal(sh.run('sudo chmod 600 /etc/hosts').code, 0);
});

test('scripts need the execute bit to run', () => {
  const sh = fresh();
  const no = sh.run('./deploy.sh');
  assert.deepEqual(no.err, ['bash: ./deploy.sh: Permission denied']);
  assert.equal(no.code, 126);
  sh.run('chmod u+x deploy.sh');
  const yes = sh.run('./deploy.sh');
  assert.deepEqual(yes.out, ['Deploying...', 'Done']);
  assert.deepEqual(yes.events[0], { type: 'exec', path: '/home/asha/deploy.sh' });
  assert.deepEqual(sh.run('./ghost.sh').err, ['bash: ./ghost.sh: No such file or directory']);
});

// ---- misc ----------------------------------------------------------------------------

test('unknown commands, empty lines, quotes and clear', () => {
  const sh = fresh();
  const r = sh.run('sl');
  assert.deepEqual(r.err, ['sl: command not found (did you mean \'ls\'?)']);
  assert.equal(r.code, 127);
  assert.deepEqual(sh.run('   ').out, []);
  assert.deepEqual(sh.run('echo "two  spaces" \'single\'').out, ['two  spaces single']);
  assert.equal(sh.run('clear').clear, true);
  assert.ok(sh.run('help').out.join(' ').includes('ls'));
});

test('tab completion for commands and paths', () => {
  const sh = fresh();
  assert.equal(sh.complete('ca'), 'cat ');
  assert.equal(sh.complete('cd pro'), 'cd projects/');
  assert.equal(sh.complete('cat /etc/ho'), 'cat /etc/hosts ');
  assert.equal(sh.complete('cat /etc/'), 'cat /etc/'); // ambiguous: unchanged
  assert.equal(sh.complete('ls ~/pro'), 'ls ~/projects/');
  assert.equal(sh.complete('c'), 'c'); // cat/cd/chmod/cp/clear: ambiguous
  assert.deepEqual(sh.candidates('c').sort(), ['cat', 'cd', 'chmod', 'clear', 'cp']);
});
