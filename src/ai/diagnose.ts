// "Test connection": find out what works and explain exactly how to fix what doesn't.
import { trimBase } from './http.ts';
import type { Fetch } from './http.ts';
import { createProvider } from './providers.ts';
import { AiError } from './types.ts';
import type { AiErrorCode, ModelInfo, ProviderConfig } from './types.ts';

export interface ConnectionReport {
  ok: boolean;
  code?: AiErrorCode;
  /** what happened, in one sentence */
  message: string;
  /** one-line status when it works */
  summary: string;
  /** what to do about it (may contain a copyable command) */
  fix?: string;
  models: ModelInfo[];
}

function corsFix(cfg: ProviderConfig, origin: string): string {
  if (cfg.kind === 'ollama') {
    return [
      `Allow this site in Ollama, then restart Ollama:`,
      `macOS:   launchctl setenv OLLAMA_ORIGINS "${origin}"`,
      `Linux/Windows or terminal:   OLLAMA_ORIGINS="${origin}" ollama serve`,
    ].join('\n');
  }
  return `Enable CORS on the server for ${origin} (LM Studio: Developer → Server settings → Enable CORS; llama.cpp: it is on by default).`;
}

export async function testConnection(cfg: ProviderConfig, opts: { fetch?: Fetch; origin: string; timeoutMs?: number }): Promise<ConnectionReport> {
  const f = opts.fetch ?? ((...a) => globalThis.fetch(...a));
  const p = createProvider(cfg, f);
  const base = trimBase(cfg.baseUrl);
  const fail = (code: AiErrorCode, message: string, fix?: string, models: ModelInfo[] = []): ConnectionReport =>
    ({ ok: false, code, message, summary: '', fix, models });

  let version = '';
  let models: ModelInfo[] = [];
  try {
    version = await p.version();
    models = cfg.kind === 'ollama' ? await p.listModels() : await p.listModels();
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('http', String(e));
    if (err.code !== 'unreachable') return fail(err.code, err.message, err.hint || undefined);
    // A failed CORS request looks exactly like a dead server. A no-cors probe tells them apart:
    // it succeeds (opaque) whenever the server answers at all.
    const probe = `${base}${cfg.kind === 'ollama' ? '/api/version' : '/models'}`;
    let alive = false;
    try { await f(probe, { mode: 'no-cors' }); alive = true; } catch { /* really unreachable */ }
    if (alive) return fail('cors', `${cfg.label} is running but blocks requests from this site.`, corsFix(cfg, opts.origin));
    const start = cfg.kind === 'ollama'
      ? 'Start the Ollama app (or run: ollama serve), then test again.'
      : `Start the server and check the address (${base}).`;
    return fail('unreachable', `Could not reach ${cfg.label} at ${base}.`, start);
  }

  const n = models.length;
  const head = `${version} · ${n} model${n === 1 ? '' : 's'}`;
  if (!cfg.model) return { ok: true, message: 'Connected. Pick a model.', summary: `${head} · pick a model`, models };
  if (n && !models.some((m) => m.id === cfg.model)) {
    const fix = cfg.kind === 'ollama' ? `Run: ollama pull ${cfg.model}   (or pick an installed model)` : 'Pick one of the listed models.';
    return fail('model_not_found', `Model '${cfg.model}' is not available on this server.`, fix, models);
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 120_000);
  try {
    const t0 = performance.now();
    await p.chat({ messages: [{ role: 'user', content: 'Reply with the single word OK.' }], temperature: 0, maxTokens: 8, signal: ctl.signal });
    const s = ((performance.now() - t0) / 1000).toFixed(1);
    return { ok: true, message: 'Connected and the model replied.', summary: `${head} · ${cfg.model} replied in ${s} s`, models };
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('http', String(e));
    if (err.code === 'aborted') return fail('aborted', 'The model took too long to reply (it may still be loading). Try again.', undefined, models);
    if (err.code === 'unreachable') return fail('cors', `${cfg.label} answered, but chat requests are blocked from this site.`, corsFix(cfg, opts.origin), models);
    return fail(err.code, err.message, err.hint || undefined, models);
  } finally {
    clearTimeout(timer);
  }
}
