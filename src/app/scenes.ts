import { compile } from '../core/compile.ts';
import type { Diag, Scene } from '../core/types.ts';
import { packs } from '../packs/index.ts';

// Scenes are plain text files bundled at build time — static hosting, no backend.
const files = import.meta.glob('/scenes/**/*.scene', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export interface SceneEntry {
  file: string;
  source: string;
  scene: Scene | null;
  diags: Diag[];
  id: string;
}

export const TRACKS: Record<string, string> = {
  net: 'Networking',
  linux: 'Linux',
  docker: 'Docker',
  k8s: 'Kubernetes',
  code: 'Programming',
  robo: 'Robotics',
};

export const entries: SceneEntry[] = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, source]) => {
    const { scene, diags } = compile(source, packs);
    return { file, source, scene, diags, id: scene?.id ?? file };
  });

export const byId = (id: string) => entries.find((e) => e.scene?.id === id);
