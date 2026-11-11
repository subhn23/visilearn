// Module format v1: a portable bundle of lessons. DOM-free; spec in docs/MODULES.md.
import { compile } from '../core/compile.ts';
import type { PackDef, PackRegistry, Scene } from '../core/types.ts';
import { compilePack } from '../packs/concept/packdef.ts';
import { withPacks } from '../packs/index.ts';

export interface ModuleSource {
  title: string;
  pages?: string;
  url?: string;
  license?: string;
}

export interface ModuleFile {
  format: 'visilearn.module';
  /** 1 = lessons only; 2 = also carries data packs */
  version: 1 | 2;
  id: string;
  title: string;
  description: string;
  author: string;
  track: string;
  tags: string[];
  sources: ModuleSource[];
  created: string;
  updated: string;
  scenes: { source: string }[];
  /** data packs (pack definition language) used by this module's lessons — version 2 */
  packs?: { source: string }[];
}

export interface ModuleLesson {
  sceneId: string;
  title: string;
  steps: number;
  scene: Scene;
}

export interface ModuleCheck {
  module: ModuleFile | null;
  errors: string[];
  warnings: string[];
  lessons: ModuleLesson[];
  /** compiled data packs carried by the module */
  packs: PackDef[];
  /** built-ins + the module's packs: what its lessons compile and run against */
  registry: PackRegistry;
}

export const MODULE_LIMITS = { maxScenes: 50, maxPacks: 10, maxBytes: 256 * 1024, maxTitle: 120, maxTags: 12 };
export const MODULE_VERSION = 2;
const ID = /^[a-z0-9][a-z0-9-]{2,63}$/;

function slug(title: string): string {
  return title.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'module';
}

function randomSuffix(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
}

export interface ModuleInput {
  title: string;
  description?: string;
  author?: string;
  track?: string;
  tags?: string[];
  sources?: ModuleSource[];
  scenes: string[];
  /** data pack definitions (makes this a version 2 module) */
  packs?: string[];
}

export function createModule(input: ModuleInput, opts: { id?: string; now?: number } = {}): ModuleFile {
  const at = new Date(opts.now ?? Date.now()).toISOString();
  return {
    format: 'visilearn.module',
    version: input.packs?.length ? 2 : 1,
    id: opts.id ?? `${slug(input.title)}-${randomSuffix()}`,
    title: input.title.trim(),
    description: input.description ?? '',
    author: input.author ?? '',
    track: input.track ?? '',
    tags: input.tags ?? [],
    sources: input.sources ?? [],
    created: at,
    updated: at,
    scenes: input.scenes.map((source) => ({ source })),
    ...(input.packs?.length ? { packs: input.packs.map((source) => ({ source })) } : {}),
  };
}

export const serializeModule = (m: ModuleFile) => JSON.stringify(m, null, 2) + '\n';

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export function validateModule(data: unknown, registry0: PackRegistry): ModuleCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lessons: ModuleLesson[] = [];
  const compiledPacks: PackDef[] = [];
  let registry: PackRegistry = registry0;
  const fail = (): ModuleCheck => ({ module: null, errors, warnings, lessons, packs: compiledPacks, registry });

  const d = data as Record<string, any>;
  if (!d || typeof d !== 'object' || d.format !== 'visilearn.module') {
    errors.push('This is not a visilearn module (missing "format": "visilearn.module").');
    return fail();
  }
  if (typeof d.version !== 'number' || d.version > MODULE_VERSION) {
    errors.push(`This module needs a newer version of visilearn (module format v${d.version}).`);
    return fail();
  }
  const bytes = new TextEncoder().encode(JSON.stringify(d)).length;
  if (bytes > MODULE_LIMITS.maxBytes) errors.push(`Module is too large (${Math.round(bytes / 1024)} KB; limit ${MODULE_LIMITS.maxBytes / 1024} KB).`);
  if (typeof d.id !== 'string' || !ID.test(d.id)) errors.push(`Module id must be 3-64 lowercase letters, digits or dashes (got '${String(d.id)}').`);
  const title = str(d.title).trim();
  if (!title) errors.push('Module needs a title.');
  else if (title.length > MODULE_LIMITS.maxTitle) errors.push(`Module title is longer than ${MODULE_LIMITS.maxTitle} characters.`);
  const scenes = Array.isArray(d.scenes) ? d.scenes : [];
  if (!scenes.length) errors.push('Module needs at least one lesson.');
  if (scenes.length > MODULE_LIMITS.maxScenes) errors.push(`Module may contain at most ${MODULE_LIMITS.maxScenes} lessons.`);
  const packSrcs = Array.isArray(d.packs) ? d.packs : [];
  if (packSrcs.length > MODULE_LIMITS.maxPacks) errors.push(`Module may contain at most ${MODULE_LIMITS.maxPacks} packs.`);
  if (errors.length) return fail();

  // packs first: lessons compile against built-ins + these packs
  packSrcs.forEach((p: unknown, i: number) => {
    const source = str((p as { source?: unknown })?.source);
    const declared = /^\s*pack\s+(\S+)/m.exec(source)?.[1] ?? '?';
    const label = `Pack ${i + 1} (${declared})`;
    if (!source) { errors.push(`Pack ${i + 1}: missing source text.`); return; }
    const r = compilePack(source, registry0);
    for (const dg of r.diags) (dg.severity === 'error' ? errors : warnings).push(`${label}: L${dg.line} ${dg.msg}`);
    if (!r.pack) return;
    if (compiledPacks.some((x) => x.name === r.pack!.name)) { errors.push(`${label}: duplicate pack '${r.pack.name}' in this module.`); return; }
    compiledPacks.push(r.pack);
  });
  if (errors.length) return fail();
  registry = withPacks(registry0, compiledPacks);

  const seen = new Set<string>();
  scenes.forEach((s: unknown, i: number) => {
    const source = str((s as { source?: unknown })?.source);
    const declared = /^\s*scene\s+(\S+)/m.exec(source)?.[1] ?? '?';
    const label = `Lesson ${i + 1} (${declared})`;
    if (!source) { errors.push(`Lesson ${i + 1}: missing source text.`); return; }
    const { scene, diags } = compile(source, registry);
    for (const dg of diags) {
      const msg = `${label}: L${dg.line} ${dg.msg}`;
      if (dg.severity === 'error') errors.push(msg); else warnings.push(msg);
    }
    if (!scene) return;
    if (seen.has(scene.id)) { errors.push(`${label}: duplicate lesson id '${scene.id}' in this module.`); return; }
    seen.add(scene.id);
    lessons.push({ sceneId: scene.id, title: scene.title, steps: scene.steps.length, scene });
  });
  if (errors.length) return fail();

  const module: ModuleFile = {
    format: 'visilearn.module',
    version: 1 as 1 | 2,
    id: d.id,
    title,
    description: str(d.description),
    author: str(d.author),
    track: str(d.track),
    tags: (Array.isArray(d.tags) ? d.tags : []).filter((t: unknown) => typeof t === 'string').slice(0, MODULE_LIMITS.maxTags),
    sources: (Array.isArray(d.sources) ? d.sources : [])
      .filter((s: unknown) => s && typeof (s as ModuleSource).title === 'string')
      .map((s: ModuleSource) => ({
        title: s.title,
        ...(typeof s.pages === 'string' ? { pages: s.pages } : {}),
        ...(typeof s.url === 'string' ? { url: s.url } : {}),
        ...(typeof s.license === 'string' ? { license: s.license } : {}),
      })),
    created: str(d.created),
    updated: str(d.updated),
    scenes: scenes.map((s: { source: string }) => ({ source: s.source })),
    ...(packSrcs.length ? { packs: packSrcs.map((p: { source: string }) => ({ source: p.source })) } : {}),
  };
  if (packSrcs.length) module.version = 2;
  return { module, errors, warnings, lessons, packs: compiledPacks, registry };
}

export function parseModule(text: string, registry: PackRegistry): ModuleCheck {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { module: null, errors: ['This is not a valid module file (it is not JSON).'], warnings: [], lessons: [], packs: [], registry };
  }
  return validateModule(data, registry);
}

/** Module lessons get namespaced keys so they never clash with built-in lessons or each other. */
export const sceneKey = (moduleId: string, sceneId: string) => `m:${moduleId}/${sceneId}`;

export function splitSceneKey(key: string): { moduleId: string; sceneId: string } | null {
  const m = /^m:([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(key);
  return m ? { moduleId: m[1], sceneId: m[2] } : null;
}
