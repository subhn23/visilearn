import type { Runtime, Scene } from '../core/types.ts';
import { netPanel } from '../packs/net/ui.ts';

export interface PanelCtx {
  scene: Scene;
  /** the live (animated) runtime */
  rt: Runtime;
  /** call after the learner changes pack state: re-checks goals and saves */
  onChange(): void;
}

export type PanelFactory = (ctx: PanelCtx) => HTMLElement | null;

/** DOM side-panels per pack (kept apart from the DOM-free pack definitions). */
export const panels: Record<string, PanelFactory> = { net: netPanel };
