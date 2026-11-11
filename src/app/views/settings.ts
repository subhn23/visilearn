import type { Alpine } from 'alpinejs';
import { testConnection } from '../../ai/diagnose.ts';
import type { ConnectionReport } from '../../ai/diagnose.ts';
import { createProvider } from '../../ai/providers.ts';
import { createAiSettings, PRESETS } from '../../ai/settings.ts';
import { AiError } from '../../ai/types.ts';
import type { ModelInfo, ProviderConfig } from '../../ai/types.ts';

function storage(): Storage | null {
  try { return window.localStorage; } catch { return null; }
}

/** App-wide AI settings (device-only). Shared with the Studio in phase 3. */
export const aiSettings = createAiSettings(storage());

const isLocal = (url: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(url.trim());
const JSON_SCHEMA = { type: 'object', properties: { ok: { type: 'boolean' }, model: { type: 'string' } }, required: ['ok'] };

export function registerSettings(alpine: Alpine) {
  alpine.data('aiSettings', () => {
    let ctl: AbortController | null = null;
    return {
      presets: PRESETS,
      providers: [] as ProviderConfig[],
      activeId: '',
      selId: '',
      models: {} as Record<string, ModelInfo[]>,
      reports: {} as Record<string, ConnectionReport | null>,
      testing: '',
      prompt: 'Explain what a firewall does, in two short sentences.',
      output: '',
      thinking: 0,
      stats: '',
      error: '',
      busy: false,
      removeArmed: '',
      copied: false,

      init(this: any) {
        document.title = 'AI models · visilearn';
        this.sync();
        this.selId = this.activeId;
      },
      sync(this: any) {
        this.providers = aiSettings.list().map((p) => ({ ...p }));
        this.activeId = aiSettings.active()?.id ?? '';
      },
      get sel(): ProviderConfig | null {
        return (this as any).providers.find((p: ProviderConfig) => p.id === (this as any).selId) ?? null;
      },
      get local() { return this.sel ? isLocal(this.sel.baseUrl) : true; },
      get needsKey() { return !!this.sel && this.sel.kind === 'openai' && !isLocal(this.sel.baseUrl); },
      get report(): ConnectionReport | null { return (this as any).reports[(this as any).selId] ?? null; },
      get modelOptions(): ModelInfo[] {
        const list: ModelInfo[] = (this as any).models[(this as any).selId] ?? [];
        const cur = this.sel?.model;
        return cur && !list.some((m) => m.id === cur) ? [{ id: cur, detail: 'not checked yet' }, ...list] : list;
      },

      add(this: any, key: string) {
        const c = aiSettings.add(key);
        this.sync();
        this.selId = c.id;
        this.output = '';
        this.error = '';
      },
      select(this: any, id: string) { this.selId = id; this.output = ''; this.error = ''; this.stats = ''; },
      field(this: any, name: 'label' | 'baseUrl' | 'model' | 'apiKey', value: string) {
        aiSettings.update(this.selId, { [name]: value });
        this.sync();
        this.reports = { ...this.reports, [this.selId]: null };
      },
      use(this: any) { aiSettings.setActive(this.selId); this.sync(); },
      remove(this: any, id: string) {
        if (this.removeArmed !== id) {
          this.removeArmed = id;
          setTimeout(() => { if (this.removeArmed === id) this.removeArmed = ''; }, 4000);
          return;
        }
        aiSettings.remove(id);
        this.removeArmed = '';
        this.sync();
        this.selId = this.activeId;
      },

      async test(this: any) {
        const id = this.selId;
        const cfg = aiSettings.get(id);
        if (!cfg) return;
        this.testing = id;
        this.reports = { ...this.reports, [id]: null };
        try {
          const r = await testConnection({ ...cfg }, { origin: location.origin });
          if (r.models.length) {
            this.models = { ...this.models, [id]: r.models };
            if (!cfg.model) { aiSettings.update(id, { model: r.models[0].id }); this.sync(); }
          }
          this.reports = { ...this.reports, [id]: r };
        } finally {
          this.testing = '';
        }
      },

      async send(this: any, json = false) {
        const cfg = aiSettings.get(this.selId);
        if (!cfg) return;
        ctl = new AbortController();
        this.busy = true;
        this.output = '';
        this.error = '';
        this.stats = '';
        this.thinking = 0;
        try {
          const r = await createProvider({ ...cfg }).chat({
            messages: [{ role: 'user', content: json ? 'Reply with a JSON object: {"ok": true, "model": "<your name>"}.' : this.prompt }],
            schema: json ? JSON_SCHEMA : undefined,
            temperature: json ? 0 : 0.7,
            signal: ctl.signal,
            onToken: (t) => { if (!json) this.output += t; },
            onThinking: (t) => { this.thinking += t.length; },
          });
          if (json) this.output = JSON.stringify(r.json, null, 2);
          this.stats = `${(r.ms / 1000).toFixed(1)} s${r.usage?.output ? ` · ${r.usage.output} tokens` : ''}`;
        } catch (e) {
          const err = e instanceof AiError ? e : new AiError('http', String(e));
          this.error = err.code === 'aborted' ? 'Stopped.' : `${err.message}${err.hint ? ` ${err.hint}` : ''}`;
        } finally {
          this.busy = false;
          ctl = null;
        }
      },
      stop() { ctl?.abort(); },
      async copy(this: any, text: string) {
        try { await navigator.clipboard.writeText(text); this.copied = true; setTimeout(() => (this.copied = false), 1500); } catch { /* select manually */ }
      },
    };
  });
}
