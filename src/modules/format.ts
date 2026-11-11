// Module format v1: a portable bundle of lessons. DOM-free; spec in docs/MODULES.md.
import { compile } from '../core/compile.ts';
import type { PackRegistry, Scene } from '../core/types.ts';

export interface ModuleSource {
  title: string;
  pages?: string;
  url?: string;
  license?: string;
}

export interface ModuleFile {
  format: 'visilearn.module';
  version: 1;
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
}

export const MODULE_LIMITS = { maxScenes: 50, maxBytes: 256 * 1024, maxTitle: 120, maxTags: 12 };
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
}

export function createModule(input: ModuleInput, opts: { id?: string; now?: number } = {}): ModuleFile {
  const at = new Date(opts.now ?? Date.now()).toISOString();
  return {
    format: 'visilearn.module',
    version: 1,
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
  };
}

export const serializeModule = (m: ModuleFile) => JSON.stringify(m, null, 2) + '\n';

const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d);

export function validateModule(data: unknown, registry: PackRegistry): ModuleCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lessons: ModuleLesson[] = [];
  const fail = (): ModuleCheck => ({ module: null, errors, warnings, lessons });

  const d = data as Record<string, any>;
  if (!d || typeof d !== 'object' || d.format !== 'visilearn.module') {
    errors.push('This is not a visilearn module (missing "format": "visilearn.module").');
    return fail();
  }
  if (typeof d.version !== 'number' || d.version > 1) {
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
  if (errors.length) return fail();

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
    version: 1,
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
  };
  return { module, errors, warnings, lessons };
}

export function parseModule(text: string, registry: PackRegistry): ModuleCheck {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { module: null, errors: ['This is not a valid module file (it is not JSON).'], warnings: [], lessons: [] };
  }
  return validateModule(data, registry);
}

/** Module lessons get namespaced keys so they never clash with built-in lessons or each other. */
export const sceneKey = (moduleId: string, sceneId: string) => `m:${moduleId}/${sceneId}`;

export function splitSceneKey(key: string): { moduleId: string; sceneId: string } | null {
  const m = /^m:([a-z0-9][a-z0-9-]*)\/(.+)$/.exec(key);
  return m ? { moduleId: m[1], sceneId: m[2] } : null;
}
