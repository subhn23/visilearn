import type { PackRegistry } from '../core/types.ts';
import { linux } from './linux/index.ts';
import { net } from './net/index.ts';

/** All language packs. Add new domains (linux, docker, k8s, code, robo) here. */
export const packs: PackRegistry = { net, linux };
