// Browser tests for modules: import (file + link), My modules, open lesson, export, share, delete.
//   npm run build && npm run e2e
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { Browser, BrowserContext, Page } from 'puppeteer-core';

const PORT = 4183;
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const MODULE = {
  format: 'visilearn.module', version: 1, id: 'e2e-starter-0001', title: 'E2E starter', description: 'Two tiny lessons',
  author: 'Test Author', track: 'net', tags: [], sources: [{ title: 'Handmade', pages: 'p. 1' }], created: '', updated: '',
  scenes: [
    { source: 'scene net.hi "Say hi"\nuse net\nhost a\nserver b port=80\nlink a b\nstep "Hello"\n  a send b:80' },
    { source: 'scene linux.hi "Where am I"\nuse linux\nfs as=asha\n  home/\n    asha/\nstep "pwd"\n  run pwd' },
  ],
};

let server: ReturnType<typeof spawn>;
let browser: Browser;
const dir = mkdtempSync(join(tmpdir(), 'visilearn-e2e-'));
const moduleFile = join(dir, 'starter.visilearn.json');
const badFile = join(dir, 'bad.visilearn.json');
const errors: string[] = [];

before(async () => {
  writeFileSync(moduleFile, JSON.stringify(MODULE));
  writeFileSync(badFile, JSON.stringify({ ...MODULE, scenes: [{ source: 'scene net.x "X"\nuse net\nstep "s"\n  explode' }] }));
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

async function open(ctx: BrowserContext, path = ''): Promise<Page> {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport({ width: 1280, height: 900 });
  await p.goto(BASE + path, { waitUntil: 'networkidle0' });
  return p;
}

async function importFile(p: Page, file: string) {
  const input = await p.$('input[aria-label="Import module file"]');
  await (input as any).uploadFile(file);
  await sleep(400);
}

const text = (p: Page, sel: string) => p.$eval(sel, (e) => e.textContent ?? '');
const clickText = async (p: Page, label: string) => {
  const [b] = await p.$$(`xpath/.//button[normalize-space(.)="${label}"] | .//a[normalize-space(.)="${label}"]`);
  assert.ok(b, `button "${label}"`);
  await b.click();
  await sleep(300);
};

test('import a module file, see it in My modules, open a lesson', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await open(ctx);
  await importFile(p, moduleFile);
  assert.match(await text(p, 'main'), /E2E starter/);
  assert.match(await text(p, 'main'), /Say hi/);
  await clickText(p, 'Add to My modules');
  assert.equal(await p.evaluate(() => location.hash), '#/');
  const card = await text(p, '#my-modules');
  assert.match(card, /E2E starter/);
  assert.match(card, /Test Author/);
  const [lesson] = await p.$$('#my-modules a[href="#/s/m:e2e-starter-0001/linux.hi"]');
  await lesson.click();
  await sleep(1200);
  assert.match(await text(p, 'h1'), /Where am I/);
  assert.match(await text(p, '.term-screen'), /\/home\/asha/);
  // still there after a reload (IndexedDB)
  await p.goto(BASE, { waitUntil: 'networkidle0' });
  assert.match(await text(p, '#my-modules'), /E2E starter/);
  await ctx.close();
});

test('an invalid module file shows the errors and cannot be added', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await open(ctx);
  await importFile(p, badFile);
  assert.match(await text(p, 'main'), /Lesson 1 \(net\.x\): L4 unknown action 'explode'/);
  const [add] = await p.$$('xpath/.//button[normalize-space(.)="Add to My modules"]');
  assert.ok(!add || (await add.evaluate((b) => (b as HTMLButtonElement).disabled)));
  await ctx.close();
});

test('share link round trip into a fresh browser profile', async () => {
  const a = await browser.createBrowserContext();
  const p = await open(a);
  await importFile(p, moduleFile);
  await clickText(p, 'Add to My modules');
  await clickText(p, 'Share link');
  const link = await p.$eval('input[aria-label="Share link"]', (e) => (e as HTMLInputElement).value);
  assert.match(link, /#\/import\/[A-Za-z0-9_-]+$/);

  const b = await browser.createBrowserContext();
  const q = await open(b, link.replace(BASE, ''));
  assert.match(await text(q, 'main'), /E2E starter/);
  await clickText(q, 'Add to My modules');
  assert.match(await text(q, '#my-modules'), /E2E starter/);

  const bad = await open(b, link.replace(BASE, '').slice(0, -12) + 'AAAAAAAAAAAA');
  assert.match(await text(bad, 'main'), /damaged or incomplete/);
  await a.close();
  await b.close();
});

test('export downloads a valid module file; delete removes the module', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await open(ctx);
  const cdp = await p.createCDPSession();
  const dl = mkdtempSync(join(tmpdir(), 'visilearn-dl-'));
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl, browserContextId: (ctx as any).id });
  await importFile(p, moduleFile);
  await clickText(p, 'Add to My modules');
  await clickText(p, 'Export');
  await sleep(800);
  const files = readdirSync(dl);
  assert.equal(files.length, 1, files.join(','));
  const saved = JSON.parse(readFileSync(join(dl, files[0]), 'utf8'));
  assert.equal(saved.id, 'e2e-starter-0001');
  assert.equal(saved.added, undefined, 'device-only fields are not exported');

  await clickText(p, 'Delete');
  await clickText(p, 'Click again to delete');
  assert.doesNotMatch(await text(p, 'main'), /E2E starter/);
  await ctx.close();
});

test('a module that carries its own pack: import, see the pack, open a lesson, press a button', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await open(ctx);
  await importFile(p, new URL('../examples/modules/git-basics.visilearn.json', import.meta.url).pathname);
  const review = await text(p, 'main');
  assert.match(review, /Adds new topic vocabulary/);
  assert.match(review, /git: Commits, branches and merges/);
  assert.match(review, /never code/);
  await clickText(p, 'Add to My modules');
  assert.match(await text(p, '#my-modules'), /pack: git/);

  await p.goto(BASE + '#/s/m:visilearn-git-basics/git.branches', { waitUntil: 'networkidle0' });
  await p.click('button[aria-label^="Step 4"]');
  await sleep(600);
  const before = await p.$$eval('.node', (els) => els.length);
  await clickText(p, 'git merge feature');
  await sleep(1200);
  assert.equal(await p.$$eval('.node', (els) => els.length), before + 1, 'merge commit appeared');
  assert.match(await text(p, 'aside p[aria-live]'), /Challenge complete/);
  await ctx.close();
});

test('no uncaught page errors', () => {
  assert.deepEqual(errors, []);
});
