import type { Alpine } from 'alpinejs';
import type { ModuleCheck } from '../modules/format.ts';
import type { StoredModule } from '../modules/store.ts';
import { createProgressStore } from './model/progress.ts';
import { loadModules, myModules } from './myModules.ts';
import { nextPref, readPref, resolveTheme, writePref } from './model/theme.ts';
import type { ThemePref } from './model/theme.ts';

function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Single progress store for the app (localStorage only, no backend). */
export const progress = createProgressStore(safeLocalStorage());

export function registerStores(alpine: Alpine) {
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  interface ThemeStore {
    pref: ThemePref; systemDark: boolean; readonly current: string; readonly label: string;
    cycle(): void; apply(): void; init(): void;
  }
  const theme: ThemeStore = {
    pref: readPref(safeLocalStorage()),
    systemDark: media.matches,
    get current() { return resolveTheme(this.pref, this.systemDark); },
    get label() { return { system: 'Auto', light: 'Light', dark: 'Dark' }[this.pref]; },
    cycle() {
      this.pref = nextPref(this.pref);
      writePref(safeLocalStorage(), this.pref);
      this.apply();
    },
    apply() { document.documentElement.dataset.theme = this.current; },
    init() {
      this.apply();
      media.addEventListener('change', (e) => { this.systemDark = e.matches; this.apply(); });
    },
  };
  alpine.store('theme', theme);

  const parse = () => {
    const h = location.hash;
    const s = /^#\/s\/(.+)$/.exec(h);
    if (s) return { view: 'player', id: decodeURIComponent(s[1]), payload: '' };
    if (h === '#/settings') return { view: 'settings', id: '', payload: '' };
    const imp = /^#\/import(?:\/(.*))?$/.exec(h);
    if (imp) return { view: 'import', id: '', payload: imp[1] ?? '' };
    return { view: 'catalog', id: '', payload: '' };
  };
  alpine.store('route', {
    ...parse(),
    init() {
      window.addEventListener('hashchange', () => {
        Object.assign(this, parse());
        window.scrollTo(0, 0);
      });
    },
  });

  /** My modules (device storage) and a module waiting on the import screen */
  const mods: {
    list: StoredModule[];
    pending: ModuleCheck | null;
    reload(): Promise<void>;
  } = {
    list: myModules(),
    pending: null,
    async reload() { this.list = await loadModules(); },
  };
  alpine.store('modules', mods);

  /** bumped whenever progress changes so views can recompute */
  const counter: { version: number; bump(): void } = { version: 0, bump() { this.version++; } };
  alpine.store('progress', counter);
}
