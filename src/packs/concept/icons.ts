// Icon library for data packs (48x48, currentColor). Data packs pick an icon by name, or give a
// validated path ("path:M…"): never raw SVG, so a pack from a stranger cannot inject markup.
const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';
const F = 'fill="var(--node-fill)"';

export const ICONS: Record<string, string> = {
  box: `<g ${S}><rect x="9" y="9" width="30" height="30" rx="4" ${F}/></g>`,
  circle: `<g ${S}><circle cx="24" cy="24" r="14" ${F}/></g>`,
  diamond: `<g ${S}><path d="M24 7l17 17-17 17L7 24z" ${F}/></g>`,
  database: `<g ${S}><ellipse cx="24" cy="12" rx="14" ry="5" ${F}/><path d="M10 12v24c0 2.8 6.3 5 14 5s14-2.2 14-5V12" ${F}/><path d="M10 24c0 2.8 6.3 5 14 5s14-2.2 14-5"/></g>`,
  table: `<g ${S}><rect x="7" y="10" width="34" height="28" rx="2" ${F}/><path d="M7 18h34M7 28h34M19 10v28M31 10v28"/></g>`,
  person: `<g ${S}><circle cx="24" cy="16" r="7" ${F}/><path d="M10 40c1-8 7-12 14-12s13 4 14 12z" ${F}/></g>`,
  people: `<g ${S}><circle cx="18" cy="17" r="6" ${F}/><circle cx="32" cy="19" r="5" ${F}/><path d="M6 39c1-7 6-10 12-10s11 3 12 10z" ${F}/><path d="M31 28c5 0 10 3 11 9h-8"/></g>`,
  server: `<g ${S}><rect x="11" y="7" width="26" height="14" rx="2" ${F}/><rect x="11" y="27" width="26" height="14" rx="2" ${F}/><path d="M16 14h1M16 34h1M22 14h10M22 34h10"/></g>`,
  file: `<g ${S}><path d="M13 5h15l9 9v27a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" ${F}/><path d="M28 5v9h9M17 23h14M17 29h14M17 35h9"/></g>`,
  folder: `<g ${S}><path d="M5 14a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" ${F}/></g>`,
  gear: `<g ${S}><circle cx="24" cy="24" r="6" ${F}/><path d="M24 6v6M24 36v6M6 24h6M36 24h6M11.3 11.3l4.2 4.2M32.5 32.5l4.2 4.2M11.3 36.7l4.2-4.2M32.5 15.5l4.2-4.2"/></g>`,
  cloud: `<g ${S}><path d="M14 36a9 9 0 0 1-1-18 12 12 0 0 1 23-2 8 8 0 0 1-1 20z" ${F}/></g>`,
  lock: `<g ${S}><rect x="11" y="21" width="26" height="19" rx="3" ${F}/><path d="M16 21v-5a8 8 0 0 1 16 0v5M24 29v4"/></g>`,
  key: `<g ${S}><circle cx="16" cy="24" r="8" ${F}/><path d="M24 24h17M35 24v6M41 24v5"/></g>`,
  tag: `<g ${S}><path d="M7 9h17l17 17-15 15L9 24z" ${F}/><circle cx="16" cy="17" r="2.5"/></g>`,
  flag: `<g ${S}><path d="M12 42V7M12 9h24l-5 8 5 8H12" ${F}/></g>`,
  star: `<g ${S}><path d="M24 6l5.5 11.5L42 19l-9 8.5 2.3 12.5L24 34l-11.3 6 2.3-12.5L6 19l12.5-1.5z" ${F}/></g>`,
  bolt: `<g ${S}><path d="M27 5L11 27h12l-3 16 17-23H25z" ${F}/></g>`,
  clock: `<g ${S}><circle cx="24" cy="24" r="16" ${F}/><path d="M24 14v10l7 5"/></g>`,
  chat: `<g ${S}><path d="M8 10h32v22H22l-9 7v-7H8z" ${F}/><path d="M15 19h18M15 25h11"/></g>`,
  globe: `<g ${S}><circle cx="24" cy="24" r="16" ${F}/><path d="M8 24h32M24 8c5 5 5 27 0 32M24 8c-5 5-5 27 0 32"/></g>`,
  book: `<g ${S}><path d="M24 12c-4-3-10-4-16-3v28c6-1 12 0 16 3 4-3 10-4 16-3V9c-6-1-12 0-16 3z" ${F}/><path d="M24 12v28"/></g>`,
  cpu: `<g ${S}><rect x="12" y="12" width="24" height="24" rx="3" ${F}/><rect x="19" y="19" width="10" height="10"/><path d="M18 6v6M24 6v6M30 6v6M18 36v6M24 36v6M30 36v6M6 18h6M6 24h6M6 30h6M36 18h6M36 24h6M36 30h6"/></g>`,
  list: `<g ${S}><rect x="8" y="8" width="32" height="32" rx="3" ${F}/><path d="M15 17h18M15 24h18M15 31h12"/></g>`,
  check: `<g ${S}><circle cx="24" cy="24" r="16" ${F}/><path d="M16 24l6 6 11-12"/></g>`,
  question: `<g ${S}><circle cx="24" cy="24" r="16" ${F}/><path d="M19 19a5 5 0 1 1 7 4.6c-1.4.6-2 1.6-2 3.4M24 33v.5"/></g>`,
  branch: `<g ${S}><circle cx="14" cy="12" r="4" ${F}/><circle cx="14" cy="36" r="4" ${F}/><circle cx="34" cy="16" r="4" ${F}/><path d="M14 16v16M34 20c0 8-8 8-16 12"/></g>`,
  layers: `<g ${S}><path d="M24 8l17 9-17 9-17-9z" ${F}/><path d="M7 25l17 9 17-9M7 32l17 9 17-9"/></g>`,
  arrow: `<g ${S}><path d="M8 24h30M28 14l10 10-10 10"/></g>`,
};

const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;

/** Returns SVG markup for an icon spec, or an error message. */
export function iconMarkup(spec: string): { svg?: string; error?: string } {
  if (spec.startsWith('path:')) {
    const d = spec.slice(5).trim();
    if (!d || d.length > 2000 || !PATH.test(d)) return { error: 'icon path may only contain SVG path commands and numbers (M L H V C S Q T A Z), max 2000 chars' };
    return { svg: `<g ${S}><path d="${d}" ${F}/></g>` };
  }
  const svg = ICONS[spec];
  return svg ? { svg } : { error: `unknown icon '${spec}'` };
}
