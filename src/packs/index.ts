import type { PackDef, PackRegistry } from '../core/types.ts';
import { concept } from './concept/index.ts';
import { linux } from './linux/index.ts';
import { net } from './net/index.ts';

/**
 * Packs built into the app (code). The registry is NOT fixed: data packs from modules or the
 * Studio are layered on top per module with withPacks(). See src/packs/concept/packdef.ts.
 */
export const builtinPacks: PackRegistry = { net, linux, concept };

/** @deprecated use builtinPacks (kept for existing imports) */
export const packs = builtinPacks;

/** A registry for one module: built-ins plus that module's data packs. */
export function withPacks(base: PackRegistry, extra: PackDef[]): PackRegistry {
  return { ...base, ...Object.fromEntries(extra.map((p) => [p.name, p])) };
}
