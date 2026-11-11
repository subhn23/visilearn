export type ThemePref = 'system' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

const KEY = 'visilearn.theme';
const PREFS: ThemePref[] = ['system', 'light', 'dark'];

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function nextPref(p: ThemePref): ThemePref {
  return PREFS[(PREFS.indexOf(p) + 1) % PREFS.length];
}

export function readPref(storage: Pick<Storage, 'getItem'> | null): ThemePref {
  try {
    const v = storage?.getItem(KEY);
    return PREFS.includes(v as ThemePref) ? (v as ThemePref) : 'system';
  } catch {
    return 'system';
  }
}

export function writePref(storage: Pick<Storage, 'setItem'> | null, p: ThemePref) {
  try {
    storage?.setItem(KEY, p);
  } catch {
    /* blocked storage: the choice lasts for this visit only */
  }
}
