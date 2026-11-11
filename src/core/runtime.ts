import type { Effects, PackRegistry, Runtime, Scene, Tone } from './types.ts';

export function createState(scene: Scene, registry: PackRegistry): Record<string, any> {
  const state: Record<string, any> = {};
  for (const name of scene.packs) {
    const p = registry[name];
    if (p.stateKey) state[name] = state[p.stateKey] ??= p.initState?.(scene) ?? {}; // shared by the family
    else state[name] = p.initState?.(scene) ?? {};
  }
  return state;
}

/** each distinct state object once (packs in a family share one) */
function eachState(rt: Runtime, registry: PackRegistry, fn: (p: PackRegistry[string], st: any) => void) {
  const seen = new Set<unknown>();
  for (const name of rt.scene.packs) {
    const st = rt.state[name];
    if (seen.has(st)) continue;
    seen.add(st);
    fn(registry[name], st);
  }
}

export function resetTransient(rt: Runtime, registry: PackRegistry) {
  eachState(rt, registry, (p, st) => p.resetTransient?.(st));
}

/** let packs draw their starting state (after reset, before steps replay) */
export function present(rt: Runtime, registry: PackRegistry) {
  eachState(rt, registry, (p, st) => p.present?.(st, rt.fx));
}

export interface LogEntry { msg: string; tone?: Tone }

/** Effects that draw nothing; optionally records log lines. */
export function headlessFx(log?: LogEntry[]): Effects {
  return {
    travel: async () => {},
    flash: async () => {},
    highlight: () => {},
    note: () => {},
    setDown: () => {},
    log: (msg, tone) => log?.push({ msg, tone }),
    wait: async () => {},
    badge: () => {},
    setSub: () => {},
    addNode: () => {},
    removeNode: () => {},
    link: () => {},
    unlink: () => {},
  };
}

export interface StepReport {
  index: number;
  text: string;
  log: LogEntry[];
  asks: { question: string; answer: string }[];
  goals: { label: string; metAtEnd: boolean }[];
}

/** Run every step without animation and report what happens. Used by the MCP server and tests. */
export async function simulate(scene: Scene, registry: PackRegistry): Promise<StepReport[]> {
  const rt: Runtime = { scene, state: createState(scene, registry), fx: headlessFx(), headless: true, ask: async () => {} };
  present(rt, registry);
  const out: StepReport[] = [];
  for (const [index, step] of scene.steps.entries()) {
    const log: LogEntry[] = [];
    rt.fx = headlessFx(log);
    for (const a of step.actions) await a.run(rt);
    out.push({
      index,
      text: step.text,
      log,
      asks: step.asks.map((a) => ({ question: a.question, answer: a.options[a.answer] })),
      goals: step.goals.map((g) => ({ label: g.label, metAtEnd: g.check(rt) })),
    });
  }
  return out;
}
