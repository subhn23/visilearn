import type { PackRegistry } from '../core/types.ts';
import { net } from './net/index.ts';

/** All language packs. Add new domains (linux, docker, k8s, code, robo) here. */
export const packs: PackRegistry = { net };
