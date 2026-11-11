// fetch wrapper that turns network/HTTP failures into AiErrors, plus a streaming line reader.
import { AiError } from './types.ts';

export type Fetch = typeof fetch;

export async function send(f: Fetch, url: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, init);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError' || init.signal?.aborted) throw new AiError('aborted', 'Cancelled.');
    throw new AiError('unreachable', `Could not reach ${what} (${new URL(url).origin}).`);
  }
  if (res.ok) return res;
  let detail = '';
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      detail = typeof j.error === 'string' ? j.error : j.error?.message ?? j.message ?? body;
    } catch { detail = body; }
  } catch { /* no body */ }
  detail = String(detail).slice(0, 300);
  if (res.status === 401 || res.status === 403) {
    throw new AiError('auth', `${what} rejected the API key (${res.status}). Check the key in settings.`, detail, res.status);
  }
  if (/model.*not (found|exist)|no such model|does not exist/i.test(detail)) {
    throw new AiError('model_not_found', `Model not found: ${detail}`, '', res.status);
  }
  throw new AiError('http', `${what} returned ${res.status}${detail ? `: ${detail}` : ''}`, '', res.status);
}

/** Read a streamed body line by line (NDJSON or SSE). Handles lines split across chunks. */
export async function readLines(res: Response, onLine: (line: string) => boolean | void, signal?: AbortSignal): Promise<void> {
  if (!res.body) {
    for (const l of (await res.text()).split('\n')) if (onLine(l) === false) return;
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new AiError('aborted', 'Cancelled.');
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '');
        buf = buf.slice(nl + 1);
        if (onLine(line) === false) return;
      }
    }
    if (buf.trim()) onLine(buf);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new AiError('aborted', 'Cancelled.');
    throw e;
  } finally {
    reader.releaseLock?.();
  }
}

export const trimBase = (u: string) => u.trim().replace(/\/+$/, '');
