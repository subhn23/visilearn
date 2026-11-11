// Keeps docs/GRAMMAR.md honest: every keyword the engine accepts must be specified there,
// and every ```scene example in it must compile. Change the language → this fails until the
// grammar is updated.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { compile, CORE_TOP, CORE_VERBS } from '../src/core/index.ts';
import { compilePack, PACKDEF_KEYWORDS } from '../src/packs/concept/packdef.ts';
import { packs } from '../src/packs/index.ts';

const grammar = readFileSync(new URL('../docs/GRAMMAR.md', import.meta.url), 'utf8');
const mentioned = (kw: string) => grammar.includes(`'${kw}'`) || grammar.includes(`\`${kw}\``);

test('grammar declares its version', () => {
  assert.match(grammar, /Grammar version: \d+\.\d+/);
});

test('every core statement and step verb is specified', () => {
  const missing = [...CORE_TOP, ...CORE_VERBS].filter((k) => !mentioned(k));
  assert.deepEqual(missing, []);
});

test('every pack, entity kind, directive and verb is specified', () => {
  const missing: string[] = [];
  for (const [name, p] of Object.entries(packs)) {
    if (!grammar.includes(`### Pack \`${name}\``)) missing.push(`pack section: ${name}`);
    for (const k of [...Object.keys(p.entities), ...Object.keys(p.directives ?? {}), ...Object.keys(p.verbs ?? {})]) {
      if (!mentioned(k)) missing.push(`${name}.${k}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('every ```scene example in the grammar compiles without errors', () => {
  const examples = [...grammar.matchAll(/```scene\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(examples.length >= 3, 'grammar should contain complete examples');
  for (const [i, src] of examples.entries()) {
    const { scene, diags } = compile(src, packs);
    assert.ok(scene, `example ${i + 1}: ${diags.map((d) => `L${d.line} ${d.msg}`).join('; ')}`);
  }
});

test('the pack definition language is specified and its examples compile', () => {
  const missing = PACKDEF_KEYWORDS.filter((k) => !mentioned(k));
  assert.deepEqual(missing, []);
  const examples = [...grammar.matchAll(/```pack\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(examples.length >= 1, 'grammar should contain a ```pack example');
  for (const [i, src] of examples.entries()) {
    const { pack, diags } = compilePack(src, packs);
    assert.ok(pack, `pack example ${i + 1}: ${diags.map((d) => `L${d.line} ${d.msg}`).join('; ')}`);
  }
});
