#!/usr/bin/env node
// visilearn authoring MCP server (stdio). Runs on the author's machine; the website stays static.
// Tools are designed to be token-cheap: compact vocab, terse validator output, deterministic simulation.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { compile, CORE_VOCAB, simulate } from '../src/core/index.ts';
import type { Diag } from '../src/core/index.ts';
import { packs } from '../src/packs/index.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCENES = join(ROOT, 'scenes');

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fmtDiags = (ds: Diag[]) => ds.map((d) => `L${d.line} ${d.severity}: ${d.msg}`).join('\n');

function walk(dir: string): string[] {
  try {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.scene') ? [p] : [];
    });
  } catch {
    return [];
  }
}

const server = new McpServer({ name: 'visilearn', version: '0.1.0' });

server.registerTool('get_vocab', {
  title: 'Get scene language vocabulary',
  description: 'Compact cheat-sheet of the visilearn scene language. Call first, with only the packs you need. Packs: ' + Object.keys(packs).join(', '),
  inputSchema: { packs: z.array(z.string()).optional().describe('pack names; omit for all') },
}, async ({ packs: want }) => {
  const names = want?.length ? want : Object.keys(packs);
  const unknown = names.filter((n) => !packs[n]);
  const body = [CORE_VOCAB, ...names.filter((n) => packs[n]).map((n) => packs[n].vocab)];
  if (unknown.length) body.push(`(unknown packs: ${unknown.join(', ')}; available: ${Object.keys(packs).join(', ')})`);
  return text(body.join('\n\n'));
});

server.registerTool('validate', {
  title: 'Validate a scene',
  description: 'Compile scene source and return errors/warnings with line numbers, or a one-line summary when valid.',
  inputSchema: { source: z.string().describe('full .scene text') },
}, async ({ source }) => {
  const { scene, diags } = compile(source, packs);
  if (!scene) return text(`INVALID\n${fmtDiags(diags)}`);
  const summary = `OK ${scene.id}: ${scene.entities.length} entities, ${scene.links.length} links, ${scene.steps.length} steps`;
  return text(diags.length ? `${summary}\n${fmtDiags(diags)}` : summary);
});

server.registerTool('simulate', {
  title: 'Simulate a scene',
  description: 'Run every step headlessly and report what the learner will see (packet outcomes, ask answers, goal status). Use it to verify the lesson teaches what it claims. Challenge goals are normally unmet (·) until the learner acts.',
  inputSchema: { source: z.string() },
}, async ({ source }) => {
  const { scene, diags } = compile(source, packs);
  if (!scene) return text(`INVALID\n${fmtDiags(diags)}`);
  const report = await simulate(scene, packs);
  const lines: string[] = [];
  for (const r of report) {
    lines.push(`step ${r.index + 1}: ${r.text}`);
    for (const a of r.asks) lines.push(`  ask "${a.question}" → ${a.answer}`);
    for (const l of r.log) lines.push(`  ${l.msg}`);
    for (const g of r.goals) lines.push(`  goal ${g.metAtEnd ? '✓' : '·'} ${g.label}`);
  }
  return text(lines.join('\n'));
});

server.registerTool('list_scenes', {
  title: 'List scenes',
  description: 'List existing scenes (id, title, file, status).',
  inputSchema: {},
}, async () => {
  const rows = walk(SCENES).map((f) => {
    const { scene, diags } = compile(readFileSync(f, 'utf8'), packs);
    const errs = diags.filter((d) => d.severity === 'error').length;
    return `${scene?.id ?? '?'}\t${scene?.title ?? ''}\t${relative(ROOT, f)}\t${errs ? `${errs} errors` : 'ok'}`;
  });
  return text(rows.length ? rows.join('\n') : 'no scenes yet');
});

server.registerTool('read_scene', {
  title: 'Read a scene',
  description: 'Return the source of an existing scene by id (e.g. net.firewall).',
  inputSchema: { id: z.string() },
}, async ({ id }) => {
  for (const f of walk(SCENES)) {
    const src = readFileSync(f, 'utf8');
    if (compile(src, packs).scene?.id === id || relative(SCENES, f) === id) return text(src);
  }
  return text(`no scene with id '${id}'`);
});

server.registerTool('save_scene', {
  title: 'Save a scene',
  description: 'Validate and write a scene to scenes/<pack>/<name>.scene (from its id). Refuses invalid scenes. Set overwrite=true to replace an existing file.',
  inputSchema: { source: z.string(), overwrite: z.boolean().optional() },
}, async ({ source, overwrite }) => {
  const { scene, diags } = compile(source, packs);
  if (!scene) return text(`NOT SAVED (invalid)\n${fmtDiags(diags)}`);
  const [pack, ...rest] = scene.id.split('.');
  const file = join(SCENES, pack, `${rest.join('.') || pack}.scene`);
  if (!file.startsWith(SCENES)) return text('NOT SAVED: bad id');
  let exists = false;
  try { statSync(file); exists = true; } catch { /* new file */ }
  if (exists && !overwrite) return text(`NOT SAVED: ${relative(ROOT, file)} exists; pass overwrite=true to replace`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source.endsWith('\n') ? source : `${source}\n`);
  return text(`saved ${relative(ROOT, file)}${diags.length ? `\n${fmtDiags(diags)}` : ''}`);
});

await server.connect(new StdioServerTransport());
