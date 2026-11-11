// End-to-end: drives a real Chrome against `vite preview`.
//   npm run build && npm run e2e
// Uses an installed Chrome (set CHROME_PATH if it isn't in the default macOS location).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

const PORT = 4179;
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

async function open(path: string, theme: 'light' | 'dark' = 'light', width = 1280): Promise<Page> {
  const p = await browser.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport({ width, height: 900 });
  await p.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }]);
  await p.goto(BASE + path, { waitUntil: 'networkidle0' });
  return p;
}

const askButtons = (p: Page) => p.$$('[x-text="ask.question"] ~ div button');

test('catalog lists the networking scenes and follows the OS theme', async () => {
  const p = await open('', 'dark');
  const titles = await p.$$eval('#topics a h3', (els) => els.map((e) => e.textContent));
  assert.ok(titles.includes('Firewalls: who gets in?'));
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await p.close();
});

test('theme toggle cycles Auto → Light → Dark and persists', async () => {
  const p = await open('', 'dark');
  const btn = await p.$('button[aria-label^="Theme"]');
  await btn!.click(); // → light
  assert.equal(await p.evaluate(() => document.documentElement.dataset.theme), 'light');
  await btn!.click(); // → dark
  await p.reload({ waitUntil: 'networkidle0' });
  assert.equal(await p.evaluate(() => localStorage.getItem('visilearn.theme')), 'dark');
  await p.close();
});

test('predict: a wrong answer is marked, the right one continues the step', async () => {
  const p = await open('#/s/net.firewall');
  await p.click('button[aria-label^="Step 2"]');
  await sleep(300);
  const [a, b] = await askButtons(p);
  await a.click();
  assert.match(await p.$eval('[x-text="ask.feedback"]', (e) => e.textContent ?? ''), /Not quite/);
  await b.click();
  assert.match(await p.$eval('[x-text="ask.feedback"]', (e) => e.textContent ?? ''), /Correct/);
  await sleep(2500);
  const log = await p.$$eval('ol[aria-live] li', (els) => els.map((e) => e.textContent).join('\n'));
  assert.match(log, /dropped by edge/);
  await p.close();
});

test('challenge: editing firewall rules completes the checklist', async () => {
  const p = await open('#/s/net.firewall');
  await p.click('button[aria-label^="Step 3"]');
  await sleep(300);
  const [add] = await p.$$('xpath/.//button[contains(., "+ Add rule")]');
  await add.click();
  await sleep(100);
  await p.keyboard.type('allow tcp:22 from laptop to web');
  await sleep(200);
  const status = await p.$eval('aside p[aria-live]', (e) => e.textContent ?? '');
  assert.match(status, /Challenge complete/);
  const rows = await p.$$('input[aria-label="Firewall rule"]');
  assert.equal(rows.length, 2, 'exactly one rule was added');
  await p.close();
});

test('invalid rule shows an inline error', async () => {
  const p = await open('#/s/net.firewall');
  await p.click('button[aria-label^="Step 3"]');
  const [add] = await p.$$('xpath/.//button[contains(., "+ Add rule")]');
  await add.click();
  await sleep(100);
  await p.keyboard.type('allow tcp:22 from nobody');
  await sleep(150);
  const err = await p.$$eval('aside p.text-bad', (els) => els.map((e) => e.textContent).join(' '));
  assert.match(err, /unknown entity 'nobody'/);
  await p.close();
});

test('phone width has no horizontal scrolling', async () => {
  const p = await open('#/s/net.lan-basics', 'light', 390);
  await sleep(500);
  assert.equal(await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0);
  await p.close();
});

test('no uncaught page errors', () => {
  assert.deepEqual(errors, []);
});
