import type { Alpine } from 'alpinejs';
import { createProgressStore } from './model/progress.ts';
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
    const m = /^#\/s\/(.+)$/.exec(location.hash);
    return m ? { view: 'player', id: decodeURIComponent(m[1]) } : { view: 'catalog', id: '' };
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

  /** bumped whenever progress changes so views can recompute */
  const counter: { version: number; bump(): void } = { version: 0, bump() { this.version++; } };
  alpine.store('progress', counter);
}
