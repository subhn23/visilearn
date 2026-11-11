// Client-side only progress. No backend: export/import JSON is the backup & device-transfer path.

export interface SceneProgress {
  done: number[];
  total: number;
  /** per-pack learner edits (e.g. firewall rules) */
  user?: Record<string, unknown>;
  updated: number;
}

export interface Progress {
  app: 'visilearn';
  v: 1;
  scenes: Record<string, SceneProgress>;
}

const KEY = 'visilearn.progress.v1';
const empty = (): Progress => ({ app: 'visilearn', v: 1, scenes: {} });
let cache: Progress | null = null;

export function load(): Progress {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    cache = p && p.v === 1 && p.scenes ? p : empty();
  } catch {
    cache = empty();
  }
  return cache!;
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(load()));
  } catch {
    /* storage full or blocked: progress just won't persist */
  }
}

export function sceneProgress(id: string): SceneProgress | undefined {
  return load().scenes[id];
}

function entry(id: string, total: number): SceneProgress {
  const p = load();
  const e = (p.scenes[id] ??= { done: [], total, updated: Date.now() });
  e.total = total;
  return e;
}

export function markDone(id: string, step: number, total: number) {
  const e = entry(id, total);
  if (!e.done.includes(step)) e.done = [...e.done, step].sort((a, b) => a - b);
  e.updated = Date.now();
  save();
}

export function setUserData(id: string, total: number, pack: string, data: unknown) {
  const e = entry(id, total);
  e.user = { ...e.user, [pack]: data };
  e.updated = Date.now();
  save();
}

export function clearScene(id: string) {
  delete load().scenes[id];
  save();
}

export function percent(id: string, total: number): number {
  const e = sceneProgress(id);
  return e && total ? Math.round((e.done.filter((s) => s < total).length / total) * 100) : 0;
}

export function exportFile() {
  const blob = new Blob([JSON.stringify({ ...load(), exported: new Date().toISOString() }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `visilearn-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Merge an exported file into local progress (union of completed steps). */
export function importText(text: string): number {
  const data = JSON.parse(text);
  if (data?.app !== 'visilearn' || data.v !== 1 || typeof data.scenes !== 'object') throw new Error('Not a visilearn progress file');
  const p = load();
  let n = 0;
  for (const [id, s] of Object.entries(data.scenes as Record<string, SceneProgress>)) {
    if (!Array.isArray(s.done)) continue;
    const cur = p.scenes[id];
    p.scenes[id] = {
      done: [...new Set([...(cur?.done ?? []), ...s.done.filter((x) => Number.isInteger(x))])].sort((a, b) => a - b),
      total: s.total ?? cur?.total ?? 0,
      user: (s.updated ?? 0) > (cur?.updated ?? 0) ? s.user : cur?.user,
      updated: Math.max(s.updated ?? 0, cur?.updated ?? 0),
    };
    n++;
  }
  save();
  return n;
}

export function resetAll() {
  cache = empty();
  save();
}
