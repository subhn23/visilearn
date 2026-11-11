import type { Alpine } from 'alpinejs';
import { createProvider } from '../../ai/providers.ts';
import { AiError } from '../../ai/types.ts';
import { compile } from '../../core/compile.ts';
import type { PackDef } from '../../core/types.ts';
import { compilePack } from '../../packs/concept/packdef.ts';
import { builtinPacks, withPacks } from '../../packs/index.ts';
import { ACCEPT, loadFile } from '../../studio/extract/load.ts';
import type { Chapter, Section } from '../../studio/extract/sections.ts';
import { assembleModule, generateLesson, generateOutline, generatePack, verifyLesson } from '../../studio/pipeline.ts';
import type { StudioDeps, StudioEvent } from '../../studio/pipeline.ts';
import type { OutlineItem } from '../../studio/specs.ts';
import { moduleStore } from '../myModules.ts';
import { aiSettings } from './settings.ts';

interface FileView { id: number; name: string; pages: number; status: 'reading' | 'ready' | 'error'; progress: string; error: string; chapters: { key: string; title: string; page: number; endPage: number; n: number; selected: boolean }[] }
interface LessonView { title: string; about: string; status: 'queued' | 'working' | 'ok' | 'failed'; source: string; errors: string[]; attempts: number; sceneId: string }

/**
 * The Studio: files → pack → outline → lessons → module. Engine objects (chapters, compiled pack,
 * abort controller) live in this closure, outside Alpine's reactive proxies.
 */
export function registerStudio(alpine: Alpine) {
  alpine.data('studio', () => {
    const chapters = new Map<string, Chapter>();
    let packDef: PackDef | null = null;
    let selected: Section[] = [];
    let ctl: AbortController | null = null;
    let seq = 0;
    let logSeq = 0;

    return {
      accept: ACCEPT,
      files: [] as FileView[],
      topic: '',
      packMode: 'new',
      builtins: Object.keys(builtinPacks),
      pack: { status: 'idle', source: '', errors: [] as string[], attempts: 0, name: '' },
      maxLessons: 3,
      outline: [] as (OutlineItem & { keep: boolean })[],
      lessons: [] as LessonView[],
      meta: { title: '', author: '', description: '' },
      moduleId: '',
      busy: '',
      log: [] as { id: number; text: string; tone: string }[],
      live: '',
      error: '',

      init() { document.title = 'Studio · visilearn'; },

      get model() {
        const p = aiSettings.active();
        return p ? { label: p.label, model: p.model, ok: !!p.model } : { label: 'none', model: '', ok: false };
      },
      get selectedCount() { return this.files.reduce((n, f) => n + f.chapters.filter((c) => c.selected).length, 0); },
      get okLessons() { return this.lessons.filter((l) => l.status === 'ok'); },

      say(this: any, text: string, tone = 'info') {
        this.log.unshift({ id: ++logSeq, text, tone });
        if (this.log.length > 60) this.log.pop();
      },

      deps(this: any): StudioDeps {
        const cfg = aiSettings.active();
        if (!cfg?.model) throw new AiError('no_model', 'No AI model selected.', 'Choose one in AI models.');
        ctl = new AbortController();
        return {
          chat: createProvider({ ...cfg }).chat,
          registry: builtinPacks,
          signal: ctl.signal,
          onEvent: (e: StudioEvent) => {
            if (e.type === 'thinking') this.live = `thinking… ${e.chars} characters`;
            else if (e.type === 'writing') this.live = `writing… ${e.chars} characters`;
            else if (e.type === 'problem') { this.say(`${e.message}: ${e.errors.slice(0, 3).join(' · ')}`, 'warn'); this.live = ''; }
            else { this.say(e.message); this.live = ''; }
          },
        };
      },

      async run(this: any, step: string, fn: () => Promise<void>) {
        this.busy = step;
        this.error = '';
        try { await fn(); } catch (e) {
          const err = e instanceof AiError ? e : new AiError('http', (e as Error).message);
          this.error = err.code === 'aborted' ? 'Stopped.' : `${err.message}${err.hint ? ` ${err.hint}` : ''}`;
          this.say(this.error, 'bad');
        } finally { this.busy = ''; this.live = ''; ctl = null; }
      },
      stop() { ctl?.abort(); },

      // ---- 1. sources ----
      async addFiles(this: any, list: FileList | null) {
        for (const file of Array.from(list ?? [])) {
          const id = ++seq;
          this.files.push({ id, name: file.name, pages: 0, status: 'reading', progress: '', error: '', chapters: [] });
          const view = () => this.files.find((f: FileView) => f.id === id)!;
          try {
            const doc = await loadFile(file, (d, t) => { view().progress = `${d}/${t} pages`; });
            doc.chapters.forEach((c, i) => chapters.set(`${id}:${i}`, c));
            Object.assign(view(), {
              status: 'ready', pages: doc.pages, progress: '',
              chapters: doc.chapters.map((c, i) => ({ key: `${id}:${i}`, title: c.title, page: c.page, endPage: c.endPage, n: c.sections.length, selected: false })),
            });
            if (!this.topic) this.topic = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').replace(/NotesForProfessionals/i, '').trim();
            this.say(`Read ${file.name}: ${doc.pages} pages, ${doc.chapters.length} chapters.`, 'ok');
          } catch (e) {
            Object.assign(view(), { status: 'error', error: (e as Error).message });
          }
        }
      },
      removeFile(this: any, id: number) { this.files = this.files.filter((f: FileView) => f.id !== id); },
      selectAll(this: any, f: FileView, on: boolean) { f.chapters.forEach((c) => (c.selected = on)); },
      snapshotSelection(this: any) {
        selected = this.files.flatMap((f: FileView) => f.chapters.filter((c) => c.selected).flatMap((c) => chapters.get(c.key)!.sections));
        return selected;
      },

      // ---- 2. pack ----
      async makePack(this: any) {
        if (!this.snapshotSelection().length) { this.error = 'Select at least one chapter.'; return; }
        if (this.packMode !== 'new') {
          packDef = builtinPacks[this.packMode];
          this.pack = { status: 'ok', source: '', errors: [], attempts: 0, name: this.packMode };
          this.say(`Using the built-in ${this.packMode} pack.`, 'ok');
          return;
        }
        await this.run('pack', async () => {
          this.pack = { status: 'working', source: '', errors: [], attempts: 0, name: '' };
          const r = await generatePack(this.deps(), { topic: this.topic || 'this topic', sections: selected });
          packDef = r.pack;
          this.pack = { status: r.pack ? 'ok' : 'failed', source: r.source, errors: r.errors, attempts: r.attempts, name: r.pack?.name ?? '' };
          this.say(r.pack ? `Pack “${r.pack.name}” is ready (${r.attempts} attempt${r.attempts === 1 ? '' : 's'}).` : 'The pack still has errors. Edit it below or try again.', r.pack ? 'ok' : 'bad');
        });
      },
      editPack(this: any, text: string) {
        const r = compilePack(text, builtinPacks);
        packDef = r.pack;
        this.pack = { ...this.pack, source: text, status: r.pack ? 'ok' : 'failed', errors: r.diags.filter((d) => d.severity === 'error').map((d) => `L${d.line} ${d.msg}`), name: r.pack?.name ?? '' };
      },

      // ---- 3. outline ----
      async makeOutline(this: any) {
        if (!packDef) return;
        this.snapshotSelection();
        await this.run('outline', async () => {
          const items = await generateOutline(this.deps(), { topic: this.topic || 'this topic', sections: selected, packVocab: packDef!.vocab, maxLessons: Number(this.maxLessons) });
          this.outline = items.map((i) => ({ ...i, keep: true }));
          if (!this.meta.title) this.meta.title = this.topic;
          this.say(`Planned ${items.length} lessons.`, 'ok');
        });
      },

      // ---- 4. lessons ----
      async writeLessons(this: any) {
        if (!packDef) return;
        const keep = this.outline.filter((o: { keep: boolean }) => o.keep);
        this.lessons = keep.map((o: OutlineItem) => ({ title: o.title, about: o.about, status: 'queued', source: '', errors: [], attempts: 0, sceneId: '' }));
        await this.run('lessons', async () => {
          for (let i = 0; i < keep.length; i++) await this.writeOne(i, keep[i]);
        });
      },
      async writeOne(this: any, i: number, item?: OutlineItem) {
        const it = item ?? this.outline.filter((o: { keep: boolean }) => o.keep)[i];
        const view = this.lessons[i];
        view.status = 'working';
        const r = await generateLesson(this.deps(), { item: JSON.parse(JSON.stringify(it)), sections: selected, packs: [packDef!] });
        Object.assign(view, { status: r.scene ? 'ok' : 'failed', source: r.source, errors: r.errors, attempts: r.attempts, sceneId: r.scene?.id ?? '' });
        this.say(r.scene ? `Lesson “${view.title}” is ready.` : `Lesson “${view.title}” still has problems.`, r.scene ? 'ok' : 'warn');
      },
      async retryLesson(this: any, i: number) { await this.run('lessons', () => this.writeOne(i)); },
      async editLesson(this: any, i: number, text: string) {
        const view = this.lessons[i];
        view.source = text;
        const registry = withPacks(builtinPacks, packDef?.origin === 'data' ? [packDef] : []);
        const c = compile(text, registry);
        const errors = c.diags.filter((d) => d.severity === 'error').map((d) => `L${d.line} ${d.msg}`);
        const problems = c.scene ? await verifyLesson(c.scene, registry) : [];
        Object.assign(view, { errors: [...errors, ...problems], status: c.scene && !problems.length ? 'ok' : 'failed', sceneId: c.scene?.id ?? view.sceneId });
      },

      // ---- 5. save ----
      sources(this: any) {
        return this.files.filter((f: FileView) => f.chapters.some((c) => c.selected)).map((f: FileView) => {
          const sel = f.chapters.filter((c) => c.selected);
          return { title: f.name, pages: `pp. ${Math.min(...sel.map((c) => c.page))}-${Math.max(...sel.map((c) => c.endPage))}` };
        });
      },
      async save(this: any, open = '') {
        const check = assembleModule({
          id: this.moduleId || undefined,
          title: this.meta.title || this.topic || 'Studio module',
          author: this.meta.author,
          description: this.meta.description,
          packSources: packDef?.origin === 'data' ? [this.pack.source] : [],
          lessonSources: this.okLessons.map((l: LessonView) => l.source),
          sources: this.sources(),
        }, builtinPacks);
        if (!check.module) { this.error = check.errors.slice(0, 3).join(' · '); return; }
        await moduleStore.save(JSON.parse(JSON.stringify(check.module)));
        await this.$store.modules.reload();
        this.moduleId = check.module.id;
        this.say(`Saved “${check.module.title}” to My modules.`, 'ok');
        if (open) location.hash = `#/s/m:${this.moduleId}/${open}`;
      },
    };
  });
}
