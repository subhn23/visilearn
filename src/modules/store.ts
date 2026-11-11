// "My modules": saved on the device. Async key-value backend (IndexedDB in the browser).
import type { ModuleFile } from './format.ts';

export interface KV {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export type StoredModule = ModuleFile & { added: string; saved: string };

const PREFIX = 'module:';

export function memoryKV(): KV {
  const m = new Map<string, unknown>();
  return {
    get: async (k) => structuredClone(m.get(k)),
    set: async (k, v) => { m.set(k, structuredClone(v)); },
    del: async (k) => { m.delete(k); },
    keys: async () => [...m.keys()],
  };
}

/** IndexedDB-backed KV; falls back to memory if IndexedDB is unavailable (private mode, etc.). */
export function idbKV(dbName = 'visilearn', storeName = 'kv'): KV {
  if (typeof indexedDB === 'undefined') return memoryKV();
  const db = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) =>
    db.then((d) => new Promise<T>((resolve, reject) => {
      const req = fn(d.transaction(storeName, mode).objectStore(storeName));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: async (k, v) => { await run('readwrite', (s) => s.put(v, k)); },
    del: async (k) => { await run('readwrite', (s) => s.delete(k)); },
    keys: async () => (await run('readonly', (s) => s.getAllKeys())).map(String),
  };
}

export function createModuleStore(kv: KV, now: () => number = Date.now) {
  const iso = () => new Date(now()).toISOString();
  return {
    async list(): Promise<StoredModule[]> {
      try {
        const keys = (await kv.keys()).filter((k) => k.startsWith(PREFIX));
        const all = (await Promise.all(keys.map((k) => kv.get(k)))) as StoredModule[];
        return all.filter(Boolean).sort((a, b) => b.saved.localeCompare(a.saved));
      } catch {
        return [];
      }
    },
    async get(id: string): Promise<StoredModule | null> {
      try {
        return ((await kv.get(PREFIX + id)) as StoredModule | undefined) ?? null;
      } catch {
        return null;
      }
    },
    async has(id: string): Promise<boolean> {
      return (await this.get(id)) !== null;
    },
    async save(m: ModuleFile): Promise<StoredModule> {
      const prev = await this.get(m.id);
      const rec: StoredModule = { ...m, added: prev?.added ?? iso(), saved: iso() };
      try {
        await kv.set(PREFIX + m.id, rec);
      } catch (e) {
        throw new Error(`This module could not be saved: ${(e as Error).message}`);
      }
      return rec;
    },
    async remove(id: string): Promise<void> {
      await kv.del(PREFIX + id);
    },
  };
}

export type ModuleStore = ReturnType<typeof createModuleStore>;
