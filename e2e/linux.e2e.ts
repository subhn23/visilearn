// Browser tests for the linux pack: terminal + live filesystem tree.
//   npm run build && npm run e2e
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

const PORT = 4181;
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let server: ReturnType<typeof spawn>;
let browser: Browser;
const errors: string[] = [];

before(async () => {
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch { /* not up yet */ }
    await sleep(100);
  }
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});

after(async () => {
  await browser?.close();
  server?.kill();
});

async function open(path: string, width = 1280): Promise<Page> {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport({ width, height: 900 });
  await p.goto(BASE + path, { waitUntil: 'networkidle0' });
  return p;
}

async function type(p: Page, cmd: string) {
  await p.click('input[aria-label="Terminal command"]');
  await p.keyboard.type(cmd);
  await p.keyboard.press('Enter');
  await sleep(700);
}

const badgeHolder = (p: Page) => p.$$eval('.node', (els) => els.filter((e) => e.querySelector('.badge')).map((e) => e.getAttribute('aria-label')));
const termText = (p: Page) => p.$eval('.term-screen', (e) => e.textContent ?? '');

test('the tree renders and the cwd badge marks the home folder', async () => {
  const p = await open('#/s/linux.navigate');
  await sleep(400);
  const labels = await p.$$eval('.node .label', (els) => els.map((e) => e.textContent));
  assert.ok(labels.includes('/') && labels.includes('etc/') && labels.includes('notes.txt'));
  assert.deepEqual(await badgeHolder(p), ['asha/ (dir)']);
  await p.close();
});

test('typing cd moves the badge and updates the prompt; the challenge completes', async () => {
  const p = await open('#/s/linux.navigate');
  await p.click('button[aria-label^="Step 6"]');
  await sleep(400);
  await type(p, 'cd /etc');
  assert.deepEqual(await badgeHolder(p), ['etc/ (dir)']);
  assert.match(await p.$eval('.term-screen label .term-prompt', (e) => e.textContent ?? ''), /asha@visilearn:\/etc\$/);
  await type(p, 'cat hosts');
  assert.match(await termText(p), /127\.0\.0\.1 localhost/);
  assert.match(await p.$eval('aside p[aria-live]', (e) => e.textContent ?? ''), /Challenge complete/);
  await p.close();
});

test('creating and removing files changes the tree', async () => {
  const p = await open('#/s/linux.navigate');
  await p.click('button[aria-label^="Step 6"]');
  await sleep(400);
  const count = () => p.$$eval('.node', (els) => els.length);
  const before = await count();
  await type(p, 'mkdir backups');
  await type(p, 'touch backups/today.txt');
  assert.equal(await count(), before + 2);
  await type(p, 'rm -r backups');
  assert.equal(await count(), before);
  await type(p, 'sl');
  assert.match(await termText(p), /command not found \(did you mean 'ls'\?\)/);
  await p.close();
});

test('history and tab completion', async () => {
  const p = await open('#/s/linux.navigate');
  await p.click('button[aria-label^="Step 6"]');
  await sleep(400);
  await type(p, 'pwd');
  const input = 'input[aria-label="Terminal command"]';
  await p.click(input);
  await p.keyboard.press('ArrowUp');
  assert.equal(await p.$eval(input, (e) => (e as HTMLInputElement).value), 'pwd');
  await p.$eval(input, (e) => { (e as HTMLInputElement).value = ''; e.dispatchEvent(new Event('input')); });
  await p.keyboard.type('cd pro');
  await p.keyboard.press('Tab');
  assert.equal(await p.$eval(input, (e) => (e as HTMLInputElement).value), 'cd projects/');
  await p.close();
});

test('permissions lesson shows modes under files and updates them live', async () => {
  const p = await open('#/s/linux.permissions');
  await p.click('button[aria-label^="Step 5"]');
  await sleep(400);
  const sub = (name: string) => p.$$eval('.node', (els, n) => els.find((e) => e.querySelector('.label')?.textContent === n)?.querySelector('.sub')?.textContent, name);
  assert.equal(await sub('diary.txt'), '-rw-------');
  await type(p, 'chmod 644 diary.txt');
  assert.equal(await sub('diary.txt'), '-rw-r--r--');
  await p.close();
});

test('no uncaught page errors', () => {
  assert.deepEqual(errors, []);
});
