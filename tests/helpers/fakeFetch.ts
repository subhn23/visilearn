// A scriptable fetch for provider tests: route by method + path, record every call.
export interface Call { url: string; method: string; headers: Record<string, string>; body: any }
type Handler = (call: Call) => Response | Promise<Response>;

export function fakeFetch(routes: Record<string, Handler>) {
  const calls: Call[] = [];
  const fn = async (input: string | URL, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { url, method, headers, body };
    calls.push(call);
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    const path = new URL(url).pathname;
    const h = routes[`${method} ${path}`];
    if (!h) return new Response('not found', { status: 404 });
    return h(call);
  };
  return Object.assign(fn as typeof fetch, { calls });
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });

/** a streamed body delivered in the given chunks (to exercise line splitting across chunks) */
export function stream(chunks: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const ch of chunks) c.enqueue(enc.encode(ch)); c.close(); },
  });
  return new Response(body, { status });
}
