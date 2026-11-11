// Client-side only progress. No backend: export/import JSON is the backup & device-transfer path.

export interface SceneProgress {
  done: number[];
  total: number;
  /** per-pack learner edits (e.g. firewall rules) */
  user?: Record<string, unknown>;
  updated: number;
}

interface ProgressFile {
  app: 'visilearn';
  v: 1;
  scenes: Record<string, SceneProgress>;
}

type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const KEY = 'visilearn.progress.v1';
const empty = (): ProgressFile => ({ app: 'visilearn', v: 1, scenes: {} });

export function createProgressStore(storage: KV | null, now: () => number = Date.now) {
  let data: ProgressFile;
  try {
    const raw = storage?.getItem(KEY);
    const p = raw ? JSON.parse(raw) : null;
    data = p?.v === 1 && p.scenes && typeof p.scenes === 'object' ? p : empty();
  } catch {
    data = empty();
  }

  const save = () => {
    try { storage?.setItem(KEY, JSON.stringify(data)); } catch { /* keep in memory only */ }
  };
  const entry = (id: string, total: number) => {
    const e = (data.scenes[id] ??= { done: [], total, updated: now() });
    e.total = total;
    e.updated = now();
    return e;
  };

  return {
    get: (id: string): SceneProgress | undefined => data.scenes[id],

    markDone(id: string, step: number, total: number) {
      const e = entry(id, total);
      if (!e.done.includes(step)) e.done = [...e.done, step].sort((a, b) => a - b);
      save();
    },

    setUser(id: string, total: number, pack: string, value: unknown) {
      const e = entry(id, total);
      e.user = { ...e.user, [pack]: value };
      save();
    },

    percent(id: string, total: number): number {
      const e = data.scenes[id];
      return e && total ? Math.round((new Set(e.done.filter((s) => s >= 0 && s < total)).size / total) * 100) : 0;
    },

    exportText: () => JSON.stringify({ ...data, exported: new Date(now()).toISOString() }, null, 2),

    /** Merge an exported file (union of completed steps; newer learner edits win). Returns scenes merged. */
    importText(text: string): number {
      const f = JSON.parse(text);
      if (f?.app !== 'visilearn' || f.v !== 1 || !f.scenes || typeof f.scenes !== 'object') {
        throw new Error('Not a visilearn progress file');
      }
      let n = 0;
      for (const [id, s] of Object.entries(f.scenes as Record<string, SceneProgress>)) {
        if (!Array.isArray(s?.done)) continue;
        const cur = data.scenes[id];
        const theirs = s.updated ?? 0;
        const mine = cur?.updated ?? -1;
        data.scenes[id] = {
          done: [...new Set([...(cur?.done ?? []), ...s.done.filter(Number.isInteger)])].sort((a, b) => a - b),
          total: s.total ?? cur?.total ?? 0,
          user: theirs > mine ? s.user ?? cur?.user : cur?.user ?? s.user,
          updated: Math.max(theirs, mine),
        };
        n++;
      }
      save();
      return n;
    },

    reset() {
      data = empty();
      save();
    },
  };
}

export type ProgressStore = ReturnType<typeof createProgressStore>;
