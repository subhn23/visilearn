import type { Alpine } from 'alpinejs';
import { buildCatalog, TRACKS } from '../model/catalog.ts';
import { catalogEntries } from '../scenes.ts';
import { progress } from '../stores.ts';

export function registerCatalog(alpine: Alpine) {
  alpine.data('catalog', () => ({
    message: '',
    resetArmed: false,

    get model() {
      void (this as any).$store.progress.version; // recompute when progress changes
      return buildCatalog(catalogEntries(), (id) => progress.get(id)?.done ?? []);
    },

    /** tracks on the roadmap that have no scenes yet */
    get upcoming() {
      const have = new Set(this.model.tracks.map((t) => t.key));
      return Object.entries(TRACKS).filter(([k]) => !have.has(k)).map(([key, name]) => ({ key, name }));
    },

    exportProgress() {
      const blob = new Blob([progress.exportText()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `visilearn-progress-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      this.message = 'Progress exported.';
    },

    async importProgress(ev: Event) {
      const input = ev.target as HTMLInputElement;
      const f = input.files?.[0];
      if (!f) return;
      try {
        const n = progress.importText(await f.text());
        this.message = `Imported progress for ${n} topic${n === 1 ? '' : 's'}.`;
        (this as any).$store.progress.bump();
      } catch (err) {
        this.message = `Import failed: ${(err as Error).message}`;
      }
      input.value = '';
    },

    resetProgress() {
      if (!this.resetArmed) {
        this.resetArmed = true;
        setTimeout(() => { this.resetArmed = false; }, 4000);
        return;
      }
      progress.reset();
      this.resetArmed = false;
      this.message = 'All progress cleared.';
      (this as any).$store.progress.bump();
    },
  }));
}
