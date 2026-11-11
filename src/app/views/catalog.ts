import type { Alpine } from 'alpinejs';
import { parseModule, serializeModule } from '../../modules/format.ts';
import { encodeShare, shareUrl } from '../../modules/share.ts';
import { packs } from '../../packs/index.ts';
import { buildCatalog, TRACKS } from '../model/catalog.ts';
import { buildModuleCards } from '../model/modules.ts';
import { download, moduleStore, toExport } from '../myModules.ts';
import { catalogEntries } from '../scenes.ts';
import { progress } from '../stores.ts';

export function registerCatalog(alpine: Alpine) {
  alpine.data('catalog', () => ({
    message: '',
    resetArmed: false,
    dragging: false,
    deleteArmed: '',
    share: { id: '', url: '', note: '' },

    get moduleCards() {
      void (this as any).$store.progress.version;
      return buildModuleCards((this as any).$store.modules.list, packs, (k) => progress.get(k)?.done ?? []);
    },

    /** read a module file and send it to the import screen for review */
    async importModuleFile(file: File | undefined) {
      if (!file) return;
      const store = (this as any).$store.modules;
      store.pending = parseModule(await file.text(), packs);
      location.hash = '#/import';
    },

    pickModule(ev: Event) {
      const input = ev.target as HTMLInputElement;
      this.importModuleFile(input.files?.[0]);
      input.value = '';
    },

    dropModule(ev: DragEvent) {
      this.dragging = false;
      this.importModuleFile(ev.dataTransfer?.files?.[0]);
    },

    exportModule(id: string) {
      const m = (this as any).$store.modules.list.find((x: { id: string }) => x.id === id);
      if (m) download(`${m.id}.visilearn.json`, serializeModule(toExport(m)));
    },

    async shareModule(id: string) {
      const m = (this as any).$store.modules.list.find((x: { id: string }) => x.id === id);
      if (!m) return;
      const { payload, tooLarge } = await encodeShare(toExport(m));
      if (tooLarge) { this.share = { id, url: '', note: 'This module is too large for a link. Use Export and send the file instead.' }; return; }
      const url = shareUrl(location.href, payload);
      let note = 'Link ready. Anyone who opens it can view and save this module.';
      try { await navigator.clipboard.writeText(url); note = 'Link copied. Anyone who opens it can view and save this module.'; } catch { /* clipboard blocked: user copies from the field */ }
      this.share = { id, url, note };
    },

    async deleteModule(id: string) {
      if (this.deleteArmed !== id) {
        this.deleteArmed = id;
        setTimeout(() => { if (this.deleteArmed === id) this.deleteArmed = ''; }, 4000);
        return;
      }
      await moduleStore.remove(id);
      this.deleteArmed = '';
      await (this as any).$store.modules.reload();
    },

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
