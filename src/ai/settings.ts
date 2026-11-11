// AI provider settings, stored on this device only (localStorage). Local providers first.
import type { ProviderConfig, ProviderKind } from './types.ts';

export interface Preset {
  key: string;
  kind: ProviderKind;
  label: string;
  baseUrl: string;
  local: boolean;
  needsKey: boolean;
  note: string;
}

export const PRESETS: Preset[] = [
  { key: 'ollama', kind: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434', local: true, needsKey: false, note: 'Runs models on your computer. Recommended.' },
  { key: 'lmstudio', kind: 'openai', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', local: true, needsKey: false, note: 'Start the local server in LM Studio (Developer tab).' },
  { key: 'llamacpp', kind: 'openai', label: 'llama.cpp server', baseUrl: 'http://localhost:8080/v1', local: true, needsKey: false, note: 'llama-server with --host 127.0.0.1.' },
  { key: 'openai-compatible', kind: 'openai', label: 'OpenAI-compatible', baseUrl: 'https://', local: false, needsKey: true, note: 'Any server with /v1/chat/completions (vLLM, OpenRouter, Together, …).' },
  { key: 'openai', kind: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', local: false, needsKey: true, note: 'Cloud. Your content is sent to OpenAI.' },
];

interface Data { providers: ProviderConfig[]; activeId: string }
type KV = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const KEY = 'visilearn.ai.v1';

function fromPreset(p: Preset, id: string): ProviderConfig {
  return { id, kind: p.kind, label: p.label, baseUrl: p.baseUrl, model: '', ...(p.needsKey ? { apiKey: '' } : {}) };
}

function defaults(): Data {
  return { providers: [fromPreset(PRESETS[0], 'ollama-local')], activeId: 'ollama-local' };
}

function valid(d: any): d is Data {
  return d && Array.isArray(d.providers) && d.providers.every((p: any) => p && typeof p.id === 'string' && (p.kind === 'ollama' || p.kind === 'openai') && typeof p.baseUrl === 'string');
}

export function createAiSettings(storage: KV | null) {
  let data: Data;
  try {
    const raw = storage?.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    data = valid(parsed) && parsed.providers.length ? parsed : defaults();
  } catch {
    data = defaults();
  }
  const save = () => { try { storage?.setItem(KEY, JSON.stringify(data)); } catch { /* memory only */ } };
  const rand = () => Math.random().toString(36).slice(2, 6);

  return {
    list: () => data.providers,
    get: (id: string) => data.providers.find((p) => p.id === id) ?? null,
    active(): ProviderConfig | null {
      return data.providers.find((p) => p.id === data.activeId) ?? data.providers[0] ?? null;
    },
    activeId: () => data.activeId,
    add(presetKey: string): ProviderConfig {
      const preset = PRESETS.find((p) => p.key === presetKey) ?? PRESETS[0];
      const cfg = fromPreset(preset, `${preset.key}-${rand()}`);
      data.providers.push(cfg);
      save();
      return cfg;
    },
    update(id: string, patch: Partial<Omit<ProviderConfig, 'id'>>) {
      const p = data.providers.find((x) => x.id === id);
      if (!p) return;
      Object.assign(p, patch);
      save();
    },
    setActive(id: string) {
      if (data.providers.some((p) => p.id === id)) { data.activeId = id; save(); }
    },
    remove(id: string) {
      data.providers = data.providers.filter((p) => p.id !== id);
      if (!data.providers.length) data = defaults();
      if (!data.providers.some((p) => p.id === data.activeId)) data.activeId = data.providers[0].id;
      save();
    },
    /** settings without secrets (for display, bug reports, export) */
    exportSafe() {
      return { ...data, providers: data.providers.map(({ apiKey, ...p }) => ({ ...p, hasKey: !!apiKey })) };
    },
  };
}

export type AiSettings = ReturnType<typeof createAiSettings>;
