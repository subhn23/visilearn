import type { Alpine } from 'alpinejs';
import { netPanelHtml, registerNetUI } from '../packs/net/ui.ts';

/**
 * Per-pack side panels: an HTML template (Alpine directives) + component registration.
 * Kept apart from the DOM-free pack definitions so the engine stays usable headless.
 */
export interface PanelDef {
  html: string;
  register(alpine: Alpine): void;
}

export const panels: Record<string, PanelDef> = {
  net: { html: netPanelHtml, register: registerNetUI },
};
