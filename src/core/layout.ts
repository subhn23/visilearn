import type { PackRegistry, Scene } from './types.ts';

export interface Pos { x: number; y: number }
export interface Layout { pos: Map<string, Pos>; width: number; height: number }

export const COL_W = 190;
export const ROW_H = 140;
const PAD_X = 90;
const PAD_Y = 80;

/**
 * Automatic layered layout — authors never write coordinates (the biggest token saver).
 * Columns come from a multi-source BFS starting at the lowest-tier entities
 * (clients on the left, servers on the right). `col=N` overrides a column.
 */
export function layoutScene(scene: Scene, registry: PackRegistry): Layout {
  const ents = scene.entities;
  const order = new Map(ents.map((e, i) => [e.id, i]));
  const tier = (id: string) => {
    const e = ents[order.get(id)!];
    return registry[e.pack].entities[e.kind]?.tier ?? 0;
  };
  const adj = new Map<string, string[]>(ents.map((e) => [e.id, []]));
  for (const [a, b] of scene.links) { adj.get(a)!.push(b); adj.get(b)!.push(a); }

  // connected components
  const comp = new Map<string, number>();
  let nComp = 0;
  for (const e of ents) {
    if (comp.has(e.id)) continue;
    const q = [e.id];
    comp.set(e.id, nComp);
    while (q.length) for (const n of adj.get(q.shift()!)!) if (!comp.has(n)) { comp.set(n, nComp); q.push(n); }
    nComp++;
  }

  const rank = new Map<string, number>();
  for (let ci = 0; ci < nComp; ci++) {
    const members = ents.filter((e) => comp.get(e.id) === ci).map((e) => e.id);
    if (members.length === 1 && !adj.get(members[0])!.length) {
      rank.set(members[0], tier(members[0]));
      continue;
    }
    // BFS from the first-declared lowest-tier entity…
    const minTier = Math.min(...members.map(tier));
    const root = members.find((id) => tier(id) === minTier)!;
    const q = [root];
    rank.set(root, 0);
    while (q.length) {
      const id = q.shift()!;
      for (const n of adj.get(id)!) if (!rank.has(n)) { rank.set(n, rank.get(id)! + 1); q.push(n); }
    }
    // …then pull low-tier leaves (clients, Internet) to the left of what they connect to.
    for (const id of members) {
      const ns = adj.get(id)!;
      if (ns.length === 1 && tier(id) < tier(ns[0]) && rank.get(ns[0])! > 0) rank.set(id, rank.get(ns[0])! - 1);
    }
  }
  for (const e of ents) if (e.props.col && /^\d+$/.test(e.props.col)) rank.set(e.id, parseInt(e.props.col, 10) - 1);

  // compress empty columns
  const used = [...new Set(rank.values())].sort((a, b) => a - b);
  const cols: string[][] = used.map((r) => ents.filter((e) => rank.get(e.id) === r).map((e) => e.id));

  // barycenter ordering, two sweeps
  const rowOf = new Map<string, number>();
  const assign = () => cols.forEach((col) => col.forEach((id, i) => rowOf.set(id, i - (col.length - 1) / 2)));
  assign();
  for (let sweep = 0; sweep < 2; sweep++) {
    for (let c = 1; c < cols.length; c++) {
      const bc = (id: string) => {
        const ns = adj.get(id)!.filter((n) => cols[c - 1].includes(n));
        return ns.length ? ns.reduce((s, n) => s + rowOf.get(n)!, 0) / ns.length : rowOf.get(id)!;
      };
      cols[c].sort((a, b) => bc(a) - bc(b) || order.get(a)! - order.get(b)!);
      assign();
    }
  }

  const maxRows = Math.max(1, ...cols.map((c) => c.length));
  const height = PAD_Y * 2 + (maxRows - 1) * ROW_H;
  const width = PAD_X * 2 + (cols.length - 1) * COL_W;
  const pos = new Map<string, Pos>();
  cols.forEach((col, ci) => col.forEach((id) => pos.set(id, { x: PAD_X + ci * COL_W, y: height / 2 + rowOf.get(id)! * ROW_H })));
  return { pos, width, height };
}
