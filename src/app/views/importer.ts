import type { Alpine } from 'alpinejs';
import type { ModuleCheck } from '../../modules/format.ts';
import { decodeShare } from '../../modules/share.ts';
import { packs } from '../../packs/index.ts';
import { moduleStore } from '../myModules.ts';

/** Import screen: review a module (from a file or a share link) before saving it. */
export function registerImporter(alpine: Alpine) {
  alpine.data('importer', (payload: string) => ({
    loading: true,
    check: null as ModuleCheck | null,
    exists: false,
    saving: false,
    error: '',

    async init(this: any) {
      document.title = 'Import module · visilearn';
      const store = this.$store.modules;
      this.check = payload ? await decodeShare(payload, packs) : store.pending;
      store.pending = null;
      if (this.check?.module) this.exists = await moduleStore.has(this.check.module.id);
      this.loading = false;
    },

    get packList() {
      return (this.check?.packs ?? []).map((p) => ({ name: p.name, about: p.about, kinds: Object.keys(p.entities) }));
    },

    get lessons() {
      return (this.check?.lessons ?? []).map((l) => ({ id: l.sceneId, title: l.title, steps: l.steps }));
    },

    async add(this: any) {
      if (!this.check?.module) return;
      this.saving = true;
      try {
        // Alpine wraps data in proxies, which IndexedDB cannot store: save a plain copy
        await moduleStore.save(JSON.parse(JSON.stringify(this.check.module)));
        await this.$store.modules.reload();
        location.hash = '#/';
      } catch (e) {
        this.error = (e as Error).message;
      } finally {
        this.saving = false;
      }
    },
  }));
}
