// Browser tests for AI settings. Uses fake OpenAI-compatible servers so results never depend on
// what is installed locally: one with CORS (works), one without (must be diagnosed as CORS).
//   npm run build && npm run e2e
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

const PORT = 4185;
const BASE = `http://localhost:${PORT}/`;
const OK_PORT = 4186;
const NOCORS_PORT = 4187;
const DEAD_PORT = 4188;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fakeLLM(port: number, cors: boolean): Server {
  const s = createServer((req, res) => {
    if (cors) {
      res.setHeader('access-control-allow-origin', '*');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
    }
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake-small' }, { id: 'fake-large' }] })); return; }
    if (req.url === '/v1/chat/completions') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const j = JSON.parse(body);
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const reply = j.response_format ? '{"ok": true, "model": "' + j.model + '"}' : `Hello from ${j.model}!`;
        for (const piece of reply.match(/.{1,4}/g)!) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
        res.end('data: [DONE]\n\n');
      });
      return;
    }
    res.writeHead(404); res.end();
  });
  s.listen(port);
  return s;
}

let server: ReturnType<typeof spawn>;
let browser: Browser;
const fakes: Server[] = [];
const errors: string[] = [];

before(async () => {
  fakes.push(fakeLLM(OK_PORT, true), fakeLLM(NOCORS_PORT, false));
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
  for (const f of fakes) f.close();
});

async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(BASE + '#/settings', { waitUntil: 'networkidle0' });
  return { page, close: () => ctx.close() };
}

const click = async (p: Page, label: string) => {
  const [b] = await p.$$(`xpath/.//button[normalize-space(.)="${label}"]`);
  assert.ok(b, `button "${label}"`);
  await b.click();
};
const setField = async (p: Page, label: string, value: string) => {
  const sel = `[aria-label="${label}"]`;
  await p.$eval(sel, (e, v) => { (e as HTMLInputElement).value = v as string; e.dispatchEvent(new Event('input', { bubbles: true })); }, value);
};
const reportText = (p: Page) => p.$eval('[data-test="report"]', (e) => e.textContent ?? '');

async function addLocalServer(p: Page, port: number) {
  await click(p, '+ llama.cpp server');
  await sleep(200);
  await setField(p, 'Base URL', `http://localhost:${port}/v1`);
}

test('Ollama is the default provider; local presets come first', async () => {
  const { page, close } = await open();
  const names = await page.$$eval('[data-test="provider"] .provider-name', (els) => els.map((e) => e.textContent));
  assert.deepEqual(names, ['Ollama']);
  const presets = await page.$$eval('[data-test="presets"] button', (els) => els.map((e) => e.textContent?.trim()));
  assert.deepEqual(presets.slice(0, 3), ['+ Ollama', '+ LM Studio', '+ llama.cpp server']);
  await close();
});

test('test connection lists models; choosing one and trying a prompt streams the reply', async () => {
  const { page, close } = await open();
  await addLocalServer(page, OK_PORT);
  await click(page, 'Test connection');
  await page.waitForFunction(() => document.querySelector('[data-test="report"]')?.textContent?.includes('2 models'), { timeout: 5000 });
  await page.select('select[aria-label="Model"]', 'fake-large');
  await click(page, 'Use this provider');
  await click(page, 'Test connection');
  await page.waitForFunction(() => document.querySelector('[data-test="report"]')?.textContent?.includes('replied'), { timeout: 5000 });
  assert.match(await reportText(page), /fake-large replied/);

  await setField(page, 'Prompt', 'Say hello');
  await click(page, 'Send');
  await page.waitForFunction(() => document.querySelector('[data-test="output"]')?.textContent?.includes('Hello from fake-large!'), { timeout: 5000 });
  await click(page, 'Check JSON output');
  await page.waitForFunction(() => document.querySelector('[data-test="output"]')?.textContent?.includes('"ok": true'), { timeout: 5000 });

  // persisted across reloads
  await page.reload({ waitUntil: 'networkidle0' });
  const active = await page.$eval('[data-test="provider"][data-active="true"] .provider-name', (e) => e.textContent);
  assert.equal(active, 'llama.cpp server');
  await close();
});

test('a server that blocks this site is diagnosed as CORS, with the real origin in the fix', async () => {
  const { page, close } = await open();
  await addLocalServer(page, NOCORS_PORT);
  await click(page, 'Test connection');
  await page.waitForFunction(() => /blocks requests/.test(document.querySelector('[data-test="report"]')?.textContent ?? ''), { timeout: 5000 });
  assert.match(await reportText(page), /CORS/);
  await close();
});

test('nothing listening is reported as unreachable', async () => {
  const { page, close } = await open();
  await addLocalServer(page, DEAD_PORT);
  await click(page, 'Test connection');
  await page.waitForFunction(() => /Could not reach/.test(document.querySelector('[data-test="report"]')?.textContent ?? ''), { timeout: 5000 });
  await close();
});

test('API key field only for providers that need one, with a device-only notice', async () => {
  const { page, close } = await open();
  assert.equal(await page.$('input[aria-label="API key"]'), null, 'Ollama has no key field');
  await click(page, '+ OpenAI');
  await sleep(200);
  assert.ok(await page.$('input[aria-label="API key"][type="password"]'));
  assert.match(await page.$eval('main', (e) => e.textContent ?? ''), /stored only in this browser/);
  await close();
});

test('no uncaught page errors', () => {
  assert.deepEqual(errors, []);
});
