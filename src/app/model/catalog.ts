export const SWATCHES = ['mustard', 'mint', 'lilac', 'peach', 'sky', 'rose'] as const;
export type Swatch = (typeof SWATCHES)[number];

export const TRACKS: Record<string, string> = {
  net: 'Networking',
  linux: 'Linux',
  docker: 'Docker',
  k8s: 'Kubernetes',
  code: 'Programming',
  robo: 'Robotics',
  concept: 'Concepts',
};
const TRACK_ORDER = Object.keys(TRACKS);

export interface CatalogScene {
  id: string;
  title: string;
  about: string;
  packs: string[];
  steps: number;
}

export interface CatalogEntry {
  file: string;
  scene: CatalogScene | null;
  errors: string[];
}

export interface Card {
  id: string;
  title: string;
  about: string;
  steps: number;
  pct: number;
  status: 'new' | 'started' | 'done';
  cta: 'Start' | 'Continue' | 'Review';
  swatch: Swatch;
}

export interface Catalog {
  tracks: { key: string; name: string; cards: Card[] }[];
  broken: { file: string; errors: string[] }[];
  stats: { total: number; done: number; started: number };
}

export function buildCatalog(entries: CatalogEntry[], doneOf: (id: string) => number[]): Catalog {
  const groups = new Map<string, Card[]>();
  const broken: Catalog['broken'] = [];
  const stats = { total: 0, done: 0, started: 0 };
  let n = 0;

  for (const e of entries) {
    if (!e.scene) { broken.push({ file: e.file, errors: e.errors }); continue; }
    const s = e.scene;
    const finished = new Set(doneOf(s.id).filter((i) => i >= 0 && i < s.steps)).size;
    const pct = s.steps ? Math.round((finished / s.steps) * 100) : 0;
    const status = pct === 100 ? 'done' : pct > 0 ? 'started' : 'new';
    const card: Card = {
      id: s.id,
      title: s.title,
      about: s.about,
      steps: s.steps,
      pct,
      status,
      cta: status === 'done' ? 'Review' : status === 'started' ? 'Continue' : 'Start',
      swatch: SWATCHES[n++ % SWATCHES.length],
    };
    stats.total++;
    if (status === 'done') stats.done++;
    if (status === 'started') stats.started++;
    const key = s.packs[0] ?? 'misc';
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }

  const rank = (k: string) => (TRACK_ORDER.includes(k) ? TRACK_ORDER.indexOf(k) : TRACK_ORDER.length);
  const tracks = [...groups.keys()]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((key) => ({ key, name: TRACKS[key] ?? key, cards: groups.get(key)! }));

  // swatches follow display order so neighbouring cards differ
  let i = 0;
  for (const t of tracks) for (const c of t.cards) c.swatch = SWATCHES[i++ % SWATCHES.length];

  return { tracks, broken, stats };
}
