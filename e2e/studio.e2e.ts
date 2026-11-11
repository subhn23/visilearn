// Studio end-to-end with a fake OpenAI-compatible model that answers each pipeline stage.
//   npm run build && npm run e2e
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import puppeteer from 'puppeteer-core';
import type { Browser, Page } from 'puppeteer-core';

const PORT = 4189;
const LLM = 4190;
const BASE = `http://localhost:${PORT}/`;
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const PACK = {
  name: 'sql', title: 'SQL basics', about: 'Tables, rows and queries.',
  kinds: [
    { name: 'table', icon: 'table', swatch: 'mustard', about: 'Stores rows.', props: [], show: '', label: false },
    { name: 'row', icon: 'list', swatch: 'sky', about: 'One record.', props: [], show: '', label: false },
  ],
  macros: [{ name: 'insert', params: ['ROW', 'TABLE'], body: ['add row ROW to TABLE', 'flash ROW ok'] }],
};
const OUTLINE = { lessons: [
  { title: 'Tables hold rows', about: 'What a table is.', sections: [0], key_concepts: ['table', 'row'] },
  { title: 'Inserting rows', about: 'Add data.', sections: [1], key_concepts: ['insert'] },
] };
const lesson = (id: string, title: string) => ({
  id, title, about: 'A table holds rows.',
  entities: [{ kind: 'table', id: 'users', label: 'users', props: [] }, { kind: 'row', id: 'r1', label: 'Asha', props: [] }],
  links: [{ from: 'users', to: 'r1' }],
  steps: [
    { text: 'A table', say: 'Each row is one record.', ask: { question: '', options: [], answer: 1 }, actions: ['highlight users'], buttons: [], goals: [] },
    { text: 'Your turn', say: 'Add a row.', ask: { question: 'Where does a new row go?', options: ['Into the table', 'Nowhere'], answer: 1 }, actions: [], buttons: [{ label: 'INSERT', action: 'insert r2 users' }], goals: ['exists r2'] },
  ],
});

function fakeLLM(): Server {
  let lessonN = 0;
  const s = createServer((req, res) => {
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    if (req.url === '/v1/models') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: 'fake' }] })); return; }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const sys = JSON.parse(body).messages[0].content as string;
      // match each prompt's opening sentence (the lesson prompt also mentions packs in its vocabulary)
      const reply = sys.startsWith('You design a small') ? PACK : sys.startsWith('You plan short') ? OUTLINE : lesson(`l${++lessonN}`, lessonN === 1 ? 'Tables hold rows' : 'Inserting rows');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const text = JSON.stringify(reply);
      for (let i = 0; i < text.length; i += 40) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text.slice(i, i + 40) } }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  s.listen(LLM);
  return s;
}

let server: ReturnType<typeof spawn>;
let browser: Browser;
let llm: Server;
const errors: string[] = [];
const notes = join(mkdtempSync(join(tmpdir(), 'visilearn-studio-')), 'sql-notes.md');

before(async () => {
  writeFileSync(notes, '# Tables\nA table stores rows of data, like a spreadsheet.\nEach row is one record.\n\n# Inserting\nINSERT adds a new row to a table.\nThe new row appears at the end.\n');
  llm = fakeLLM();
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
  llm?.close();
});

const click = async (p: Page, label: string) => {
  const [b] = await p.$$(`xpath/.//button[normalize-space(.)="${label}"]`);
  assert.ok(b, `button "${label}"`);
  await b.click();
};
const waitText = (p: Page, sel: string, re: RegExp, timeout = 8000) =>
  p.waitForFunction((s, src) => new RegExp(src).test(document.querySelector(s)?.textContent ?? ''), { timeout }, sel, re.source);

test('files → pack → plan → lessons → save → play, all in the browser', async () => {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  await p.setViewport({ width: 1300, height: 950 });
  await p.evaluateOnNewDocument((port) => {
    localStorage.setItem('visilearn.ai.v1', JSON.stringify({ providers: [{ id: 'fake', kind: 'openai', label: 'Fake', baseUrl: `http://localhost:${port}/v1`, model: 'fake' }], activeId: 'fake' }));
  }, LLM);
  await p.goto(BASE + '#/studio', { waitUntil: 'networkidle0' });
  assert.match(await p.$eval('main', (e) => e.textContent ?? ''), /Fake · fake/);

  const input = await p.$('input[aria-label="Source files"]');
  await (input as any).uploadFile(notes);
  await waitText(p, 'main', /2 chapters/);
  assert.equal(await p.$eval('input[aria-label="Topic"]', (e) => (e as HTMLInputElement).value), 'sql notes');
  await click(p, 'All');

  await click(p, 'Design pack');
  await waitText(p, 'main', /✓ valid pack/);
  assert.match(await p.$eval('textarea[aria-label="Pack source"]', (e) => (e as HTMLTextAreaElement).value), /^pack sql "SQL basics"/);

  await click(p, 'Plan lessons');
  await p.waitForSelector('input[aria-label="Lesson 2 title"]');
  await click(p, 'Write lessons');
  await waitText(p, 'main', /2 \/ 2 ready/, 15000);

  // editing a lesson re-validates it live
  await p.$$eval('details', (ds) => ds.forEach((d) => ((d as HTMLDetailsElement).open = true)));
  await p.$eval('textarea[aria-label="Lesson 1 source"]', (e) => {
    const t = e as HTMLTextAreaElement;
    t.value = t.value.replace('highlight users', 'highlight userz');
    t.dispatchEvent(new Event('input'));
  });
  await waitText(p, 'main', /unknown entity 'userz'/);
  await p.$eval('textarea[aria-label="Lesson 1 source"]', (e) => {
    const t = e as HTMLTextAreaElement;
    t.value = t.value.replace('highlight userz', 'highlight users');
    t.dispatchEvent(new Event('input'));
  });
  await waitText(p, 'main', /2 \/ 2 ready/);

  await p.$eval('input[aria-label="Author"]', (e) => { (e as HTMLInputElement).value = 'E2E'; e.dispatchEvent(new Event('input')); });
  const [preview] = await p.$$('xpath/.//button[normalize-space(.)="Save & preview"]');
  await preview.click();
  await p.waitForFunction(() => location.hash.startsWith('#/s/m:'), { timeout: 5000 });
  await sleep(800);
  assert.match(await p.$eval('h1', (e) => e.textContent ?? ''), /Tables hold rows/);
  await p.click('button[aria-label^="Step 2"]');
  await sleep(300);
  const opts = await p.$$('[x-text="ask.question"] ~ div button');
  await opts[0].click();
  await sleep(900);
  await click(p, 'INSERT');
  await waitText(p, 'aside p[aria-live]', /Challenge complete/);

  await p.goto(BASE, { waitUntil: 'networkidle0' });
  const mine = await p.$eval('#my-modules', (e) => e.textContent ?? '');
  assert.match(mine, /pack: sql/);
  assert.match(mine, /by E2E/);
  assert.match(mine, /sql-notes\.md, pp\. 1-1/);
  await ctx.close();
});

test('no uncaught page errors', () => {
  assert.deepEqual(errors, []);
});
