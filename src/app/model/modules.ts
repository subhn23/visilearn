import type { PackRegistry } from '../../core/types.ts';
import { sceneKey, validateModule } from '../../modules/format.ts';
import type { StoredModule } from '../../modules/store.ts';
import { SWATCHES } from './catalog.ts';
import type { Swatch } from './catalog.ts';

export interface ModuleCard {
  id: string;
  title: string;
  author: string;
  description: string;
  sources: string[];
  packs: { name: string; about: string }[];
  lessons: { key: string; sceneId: string; title: string; steps: number; pct: number }[];
  pct: number;
  errors: string[];
  swatch: Swatch;
}

export function buildModuleCards(modules: StoredModule[], registry: PackRegistry, doneOf: (key: string) => number[]): ModuleCard[] {
  return modules.map((m, i) => {
    const check = validateModule(m, registry);
    let finished = 0;
    let total = 0;
    const lessons = check.lessons.map((l) => {
      const key = sceneKey(m.id, l.sceneId);
      const n = new Set(doneOf(key).filter((s) => s >= 0 && s < l.steps)).size;
      finished += n;
      total += l.steps;
      return { key, sceneId: l.sceneId, title: l.title, steps: l.steps, pct: l.steps ? Math.round((n / l.steps) * 100) : 0 };
    });
    return {
      id: m.id,
      title: m.title,
      author: m.author,
      description: m.description,
      sources: m.sources.map((s) => (s.pages ? `${s.title}, ${s.pages}` : s.title)),
      packs: check.packs.map((p) => ({ name: p.name, about: p.about })),
      lessons,
      pct: total ? Math.round((finished / total) * 100) : 0,
      errors: check.errors,
      swatch: SWATCHES[(i + 2) % SWATCHES.length],
    };
  });
}
