import { compile } from '../core/compile.ts';
import type { Diag, PackRegistry, Scene } from '../core/types.ts';
import { packs } from '../packs/index.ts';
import type { CatalogEntry } from './model/catalog.ts';
import { moduleRegistry, moduleScene } from './myModules.ts';

// Scenes are plain text files bundled at build time: static hosting, no backend.
const files = import.meta.glob('/scenes/**/*.scene', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface SceneEntry {
  file: string;
  scene: Scene | null;
  diags: Diag[];
}

export const entries: SceneEntry[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, source]) => ({ file, ...compile(source, packs) }));

/** Built-in lesson by id, or a module lesson by its key (m:<module>/<scene>). */
export const byId = (id: string) => (id.startsWith('m:') ? moduleScene(id) : entries.find((e) => e.scene?.id === id)?.scene ?? null);

/** Pack registry for a lesson: built-ins, or built-ins + the lesson's module packs. */
export const registryFor = (id: string): PackRegistry => (id.startsWith('m:') ? moduleRegistry(id) ?? packs : packs);

export const catalogEntries = (): CatalogEntry[] =>
  entries.map((e) => ({
    file: e.file.replace(/^\/scenes\//, ''),
    scene: e.scene && { id: e.scene.id, title: e.scene.title, about: e.scene.about, packs: e.scene.packs, steps: e.scene.steps.length },
    errors: e.diags.filter((d) => d.severity === 'error').map((d) => `L${d.line}: ${d.msg}`),
  }));
