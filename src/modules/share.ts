// Share links: the whole module, compressed, lives in the URL fragment (#/import/<payload>).
// Fragments are never sent to a server, so sharing needs no backend.
import type { PackRegistry } from '../core/types.ts';
import { parseModule } from './format.ts';
import type { ModuleCheck, ModuleFile } from './format.ts';

/** Above this many characters, links get unreliable in chat apps; share a file instead. */
export const SHARE_LIMIT = 12000;
const DAMAGED = 'This link is damaged or incomplete. Ask the sender for the module file instead.';

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw new Error('bad characters');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeShare(m: ModuleFile): Promise<{ payload: string; tooLarge: boolean }> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(m)), new CompressionStream('deflate-raw'));
  const payload = toBase64Url(packed);
  return { payload, tooLarge: payload.length > SHARE_LIMIT };
}

export async function decodeShare(payload: string, registry: PackRegistry): Promise<ModuleCheck> {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(await pipe(fromBase64Url(payload), new DecompressionStream('deflate-raw')));
    JSON.parse(text);
  } catch {
    return { module: null, errors: [DAMAGED], warnings: [], lessons: [], packs: [], registry };
  }
  return parseModule(text, registry);
}

export function shareUrl(base: string, payload: string): string {
  return `${base.split('#')[0]}#/import/${payload}`;
}
