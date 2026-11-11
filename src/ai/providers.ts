// Provider implementations: Ollama (local, default) and OpenAI-compatible servers
// (LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI, …).
import { readLines, send, trimBase } from './http.ts';
import type { Fetch } from './http.ts';
import { extractJson } from './json.ts';
import { AiError } from './types.ts';
import type { ChatRequest, ChatResult, ModelInfo, Provider, ProviderConfig } from './types.ts';

const gb = (bytes?: number) => (bytes ? `${(bytes / 1e9).toFixed(1)} GB` : '');

function finish(text: string, req: ChatRequest, t0: number, usage?: ChatResult['usage']): ChatResult {
  const r: ChatResult = { text, usage, ms: Math.round(performance.now() - t0) };
  if (req.schema) {
    r.json = extractJson(text);
    if (r.json === undefined) throw new AiError('bad_response', 'The model did not return valid JSON.', 'Try again, lower the temperature, or use a larger model.');
  }
  return r;
}

function needModel(cfg: ProviderConfig) {
  if (!cfg.model) throw new AiError('no_model', 'No model selected.', 'Pick a model in AI settings.');
}

function ollama(cfg: ProviderConfig, f: Fetch): Provider {
  const base = trimBase(cfg.baseUrl);
  const what = cfg.label || 'Ollama';
  return {
    config: cfg,
    async listModels(signal) {
      const res = await send(f, `${base}/api/tags`, { signal }, what);
      const data = (await res.json()) as { models?: { name: string; size?: number; details?: { family?: string; parameter_size?: string } }[] };
      return (data.models ?? []).map((m) => ({
        id: m.name,
        detail: [m.details?.family, m.details?.parameter_size, gb(m.size)].filter(Boolean).join(' · '),
      }));
    },
    async version(signal) {
      const res = await send(f, `${base}/api/version`, { signal }, what);
      return `Ollama ${((await res.json()) as { version?: string }).version ?? ''}`.trim();
    },
    async chat(req) {
      needModel(cfg);
      const t0 = performance.now();
      // NB: never send think:false. Gemma 4 then writes its reasoning into the answer itself;
      // left alone, Ollama returns reasoning separately in message.thinking.
      const body: Record<string, unknown> = { model: cfg.model, messages: req.messages, stream: true, options: {} };
      if (req.schema) body.format = req.schema;
      if (req.temperature !== undefined) (body.options as Record<string, unknown>).temperature = req.temperature;
      if (req.maxTokens !== undefined) (body.options as Record<string, unknown>).num_predict = req.maxTokens;
      let res: Response;
      try {
        res = await send(f, `${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: req.signal }, what);
      } catch (e) {
        if (e instanceof AiError && e.code === 'model_not_found') e.hint = `Run: ollama pull ${cfg.model}`;
        throw e;
      }
      let text = '';
      let usage: ChatResult['usage'];
      await readLines(res, (line) => {
        if (!line.trim()) return;
        let j: { message?: { content?: string; thinking?: string }; done?: boolean; error?: string; prompt_eval_count?: number; eval_count?: number };
        try { j = JSON.parse(line); } catch { return; }
        if (j.error) throw new AiError('http', `Ollama: ${j.error}`);
        if (j.message?.thinking) req.onThinking?.(j.message.thinking);
        const piece = j.message?.content ?? '';
        if (piece) { text += piece; req.onToken?.(piece); }
        if (j.done) { usage = { input: j.prompt_eval_count, output: j.eval_count }; return false; }
      }, req.signal);
      return finish(text, req, t0, usage);
    },
  };
}

function openai(cfg: ProviderConfig, f: Fetch): Provider {
  const base = trimBase(cfg.baseUrl);
  const what = cfg.label || 'The server';
  const headers = (json = false): Record<string, string> => ({
    ...(json ? { 'content-type': 'application/json' } : {}),
    ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
  });
  const list = async (signal?: AbortSignal): Promise<ModelInfo[]> => {
    const res = await send(f, `${base}/models`, { headers: headers(), signal }, what);
    const data = (await res.json()) as { data?: { id: string; owned_by?: string }[] };
    return (data.data ?? []).map((m) => ({ id: m.id, detail: m.owned_by && m.owned_by !== 'organization_owner' ? m.owned_by : '' }));
  };
  return {
    config: cfg,
    listModels: list,
    async version(signal) {
      const n = (await list(signal)).length;
      return `${cfg.label || 'OpenAI-compatible'} (${n} model${n === 1 ? '' : 's'})`;
    },
    async chat(req) {
      needModel(cfg);
      const t0 = performance.now();
      const post = (responseFormat?: object) => {
        const body: Record<string, unknown> = { model: cfg.model, messages: req.messages, stream: true };
        if (req.temperature !== undefined) body.temperature = req.temperature;
        if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
        if (responseFormat) body.response_format = responseFormat;
        return send(f, `${base}/chat/completions`, { method: 'POST', headers: headers(true), body: JSON.stringify(body), signal: req.signal }, what);
      };
      let res: Response;
      if (req.schema) {
        try {
          res = await post({ type: 'json_schema', json_schema: { name: 'answer', schema: req.schema, strict: true } });
        } catch (e) {
          // some servers only support json_object; retry once
          if (e instanceof AiError && e.status === 400 && /response_format|json_schema/i.test(e.message)) res = await post({ type: 'json_object' });
          else throw e;
        }
      } else res = await post();

      let text = '';
      let usage: ChatResult['usage'];
      await readLines(res, (line) => {
        if (!line.startsWith('data:')) return;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return false;
        let j: { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } };
        try { j = JSON.parse(data); } catch { return; }
        if (j.error) throw new AiError('http', `${what}: ${j.error.message ?? 'error'}`);
        const piece = j.choices?.[0]?.delta?.content ?? '';
        if (piece) { text += piece; req.onToken?.(piece); }
        if (j.usage) usage = { input: j.usage.prompt_tokens, output: j.usage.completion_tokens };
      }, req.signal);
      return finish(text, req, t0, usage);
    },
  };
}

export function createProvider(cfg: ProviderConfig, f: Fetch = (...a) => globalThis.fetch(...a)): Provider {
  return cfg.kind === 'ollama' ? ollama(cfg, f) : openai(cfg, f);
}
