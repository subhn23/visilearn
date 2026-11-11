// 48x48 icons; currentColor follows the theme, --node-fill is the soft inner fill.
const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

export const linuxIcons: Record<string, string> = {
  dir: `<g ${S}><path d="M5 14a3 3 0 0 1 3-3h10l4 4h18a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z" fill="var(--node-fill)"/><path d="M5 20h38"/></g>`,
  file: `<g ${S}><path d="M13 5h15l9 9v27a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" fill="var(--node-fill)"/><path d="M28 5v9h9M17 23h14M17 29h14M17 35h9"/></g>`,
};
