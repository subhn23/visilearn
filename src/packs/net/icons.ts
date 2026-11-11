// Icons are drawn in a 48x48 box (0..48). Use currentColor / CSS vars so they follow the theme.
const S = 'fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"';

export const netIcons: Record<string, string> = {
  host: `<g ${S}><rect x="9" y="10" width="30" height="20" rx="2" fill="var(--node-fill)"/><path d="M4 36h40l-3-5H7z" fill="var(--node-fill)"/></g>`,
  user: `<g ${S}><circle cx="24" cy="16" r="7" fill="var(--node-fill)"/><path d="M10 40c1-8 7-12 14-12s13 4 14 12z" fill="var(--node-fill)"/></g>`,
  server: `<g ${S}><rect x="11" y="5" width="26" height="11" rx="2" fill="var(--node-fill)"/><rect x="11" y="18.5" width="26" height="11" rx="2" fill="var(--node-fill)"/><rect x="11" y="32" width="26" height="11" rx="2" fill="var(--node-fill)"/><path d="M16 10.5h1M16 24h1M16 37.5h1M23 10.5h9M23 24h9M23 37.5h9"/></g>`,
  internet: `<g ${S}><path d="M14 36a9 9 0 0 1-1-18 12 12 0 0 1 23-2 8 8 0 0 1-1 20z" fill="var(--node-fill)"/></g>`,
  fw: `<g ${S}><rect x="6" y="9" width="36" height="30" rx="2" fill="var(--node-fill)"/><path d="M6 19h36M6 29h36M18 9v10M30 9v10M12 19v10M24 19v10M36 19v10M18 29v10M30 29v10"/></g>`,
  router: `<g ${S}><ellipse cx="24" cy="24" rx="18" ry="12" fill="var(--node-fill)"/><path d="M15 21l5 3-5 3M33 21l-5 3 5 3M24 15v6M24 33v-6"/></g>`,
  switch: `<g ${S}><rect x="4" y="16" width="40" height="16" rx="3" fill="var(--node-fill)"/><path d="M10 27h2M16 27h2M22 27h2M28 27h2M34 27h2M10 21h20"/></g>`,
};
