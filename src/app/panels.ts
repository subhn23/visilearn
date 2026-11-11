import type { Alpine } from 'alpinejs';
import { linuxPanelHtml, registerLinuxUI } from '../packs/linux/ui.ts';
import { netPanelHtml, registerNetUI } from '../packs/net/ui.ts';

/**
 * Per-pack panels: an HTML template (Alpine directives) + component registration.
 * Kept apart from the DOM-free pack definitions so the engine stays usable headless.
 *  - slot "side": next to the lesson card (e.g. firewall rule editor)
 *  - slot "main": under the stage, replacing the event log (e.g. the terminal)
 */
export interface PanelDef {
  html: string;
  slot: 'main' | 'side';
  register(alpine: Alpine): void;
  /** legend under the stage: label + Tailwind classes for the swatch dot */
  legend: { label: string; dot: string }[];
}

const dot = 'rounded-full border-2 border-stroke';
const box = 'rounded-[3px] border-2 border-stroke';

export const panels: Record<string, PanelDef> = {
  net: {
    html: netPanelHtml, slot: 'side', register: registerNetUI,
    legend: [
      { label: 'packet', dot: `${dot} bg-mustard` }, { label: 'delivered', dot: `${dot} bg-ok` },
      { label: 'dropped', dot: `${dot} bg-bad` }, { label: 'refused', dot: `${dot} bg-warn` },
      { label: 'reply', dot: `${dot} border-dashed bg-sky` },
    ],
  },
  linux: {
    html: linuxPanelHtml, slot: 'main', register: registerLinuxUI,
    legend: [
      { label: 'folder', dot: `${box} bg-mustard` }, { label: 'file', dot: `${box} bg-sky` },
      { label: 'changed', dot: `${box} bg-ok` }, { label: 'denied / removed', dot: `${box} bg-bad` },
    ],
  },
};
