// App glue for "My modules": device storage (IndexedDB) + compiled lessons for the player.
import type { PackRegistry, Scene } from '../core/types.ts';
import { sceneKey, validateModule } from '../modules/format.ts';
import type { ModuleFile } from '../modules/format.ts';
import { createModuleStore, idbKV } from '../modules/store.ts';
import type { StoredModule } from '../modules/store.ts';
import { packs } from '../packs/index.ts';

export const moduleStore = createModuleStore(idbKV());

let modules: StoredModule[] = [];
const lessons = new Map<string, { scene: Scene; registry: PackRegistry }>();

/** (Re)load modules from the device and compile their lessons. */
export async function loadModules(): Promise<StoredModule[]> {
  modules = await moduleStore.list();
  lessons.clear();
  for (const m of modules) {
    const check = validateModule(m, packs);
    for (const l of check.lessons) lessons.set(sceneKey(m.id, l.sceneId), { scene: l.scene, registry: check.registry });
  }
  return modules;
}

export const myModules = () => modules;
export const moduleScene = (key: string): Scene | null => lessons.get(key)?.scene ?? null;
/** the registry a module lesson runs against: built-ins + its module's data packs */
export const moduleRegistry = (key: string): PackRegistry | null => lessons.get(key)?.registry ?? null;

/** What goes into an exported file: the module only, never device-only fields. */
export function toExport(m: StoredModule): ModuleFile {
  const { added: _a, saved: _s, ...rest } = m;
  return rest;
}

export function download(filename: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
