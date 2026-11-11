import type { Alpine } from 'alpinejs';
import { createState, present, resetTransient } from '../../core/runtime.ts';
import type { Ask, Entity, Runtime, Scene, Tone } from '../../core/types.ts';
import { packs } from '../../packs/index.ts';
import { Stage } from '../../render/stage.ts';
import { isStepComplete, resumeIndex, stepStatus } from '../model/stepFlow.ts';
import { panels } from '../panels.ts';
import { byId } from '../scenes.ts';
import { progress } from '../stores.ts';

interface AskView {
  question: string;
  options: { text: string; state: 'idle' | 'right' | 'wrong' }[];
  feedback: string;
  tone: '' | 'ok' | 'bad';
}

/**
 * The scene player. Engine objects (Stage, Runtime, Scene) live in this closure,
 * NOT in Alpine's reactive data: proxies would slow the animation loop and break identity.
 */
export function registerPlayer(alpine: Alpine) {
  alpine.data('player', (sceneId: string) => {
    const scene = byId(sceneId) as Scene;
    let stage: Stage;
    let live: Runtime;
    let replay: Runtime;
    let pendingAsk: (() => void) | null = null;
    let currentAsk: Ask | null = null; // raw object, never proxied
    let correct = new Set<Ask>();
    let actionsDone = false;
    let logSeq = 0;
    let onKey: (e: KeyboardEvent) => void;

    return {
      found: !!scene,
      title: scene?.title ?? 'Topic not found',
      steps: scene?.steps.map((s) => s.text) ?? [],
      sidePanels: scene ? scene.packs.filter((p) => panels[p]?.slot === 'side').map((p) => panels[p].html).join('') : '',
      legend: scene ? scene.packs.flatMap((p) => panels[p]?.legend ?? []) : [],
      mainPanels: scene ? scene.packs.filter((p) => panels[p]?.slot === 'main').map((p) => panels[p].html).join('') : '',
      idx: 0,
      text: '',
      say: [] as string[],
      hints: [] as string[],
      ask: null as AskView | null,
      goals: [] as { label: string; met: boolean }[],
      status: { tone: 'idle', text: '' } as ReturnType<typeof stepStatus>,
      done: [] as number[],
      log: [] as { id: number; msg: string; tone: Tone }[],
      inspector: null as null | { label: string; kind: string; sub: string; ports: string; about: string; swatch: string; details: string[] },
      speed: 1,

      /** for nested pack panels */
      rt: () => live,

      init(this: any) {
        if (!scene) return;
        document.title = `${scene.title} · visilearn`;
        stage = new Stage(scene, packs);
        const state = createState(scene, packs);
        const saved = progress.get(scene.id);
        for (const name of scene.packs) if (saved?.user?.[name]) packs[name].importUser?.(state[name], saved.user[name]);
        live = { scene, state, fx: stage, headless: false, ask: (a) => this.showAsk(a) };
        replay = { scene, state, fx: stage, headless: true, ask: async () => {} };
        this.done = saved?.done ?? [];

        stage.onLog = (msg, tone) => {
          this.log.unshift({ id: ++logSeq, msg, tone: tone ?? 'info' });
          if (this.log.length > 40) this.log.pop();
        };
        stage.onSelect = (e: Entity) => this.inspect(e);
        this.$refs.stage.appendChild(stage.svg);

        onKey = (e: KeyboardEvent) => {
          if ((e.target as HTMLElement).closest('input, select, textarea')) return;
          if (e.key === 'ArrowRight') this.go(this.idx + 1);
          if (e.key === 'ArrowLeft') this.go(this.idx - 1);
        };
        window.addEventListener('keydown', onKey);
        this.go(resumeIndex(this.done, scene.steps.length));
      },

      destroy() {
        window.removeEventListener('keydown', onKey);
        stage?.reset();
        pendingAsk?.();
      },

      setSpeed(this: any, s: number) {
        this.speed = s;
        stage.speed = s;
      },

      inspect(this: any, e: Entity) {
        stage.select(e.id);
        const kind = packs[e.pack].entities[e.kind];
        this.inspector = {
          label: e.label, kind: e.kind, sub: e.sub ?? '', ports: e.props.port ?? '',
          about: e.props.info ?? kind.about, swatch: kind.swatch ?? 'sky',
          details: packs[e.pack].describe?.(live.state[e.pack], e.id) ?? [],
        };
      },

      closeInspector(this: any) {
        this.inspector = null;
        stage.select(null);
      },

      showAsk(this: any, a: Ask): Promise<void> {
        return new Promise((resolve) => {
          pendingAsk = () => { pendingAsk = null; resolve(); };
          currentAsk = a;
          this.ask = { question: a.question, options: a.options.map((text) => ({ text, state: 'idle' })), feedback: '', tone: '' };
        });
      },

      answer(this: any, i: number) {
        const view = this.ask as AskView;
        const a = currentAsk;
        if (!view || !a || view.options[i].state !== 'idle') return;
        if (i === a.answer) {
          view.options[i].state = 'right';
          view.feedback = 'Correct!';
          view.tone = 'ok';
          correct.add(a);
          this.refresh();
          setTimeout(() => pendingAsk?.(), 650);
        } else {
          view.options[i].state = 'wrong';
          view.feedback = 'Not quite. Try another answer.';
          view.tone = 'bad';
        }
      },

      /** learner changed pack state (e.g. edited rules): save and re-check goals */
      changed(this: any) {
        for (const name of scene.packs) {
          const data = packs[name].exportUser?.(live.state[name]);
          if (data !== undefined) progress.setUser(scene.id, scene.steps.length, name, data);
        }
        this.refresh();
      },

      refresh(this: any) {
        const step = scene.steps[this.idx];
        const goals = step.goals.map((g) => g.check(live));
        this.goals = step.goals.map((g, i) => ({ label: g.label, met: goals[i] }));
        const st = { actionsDone, asks: step.asks.length, correct: step.asks.filter((a) => correct.has(a)).length, goals };
        this.status = stepStatus(st);
        if (isStepComplete(st) && !this.done.includes(this.idx)) {
          progress.markDone(scene.id, this.idx, scene.steps.length);
          this.done = [...this.done, this.idx];
          this.$store.progress.bump();
        }
      },

      async go(this: any, i: number) {
        if (!scene || i < 0 || i >= scene.steps.length) return;
        pendingAsk?.();
        this.idx = i;
        actionsDone = false;
        correct = new Set();
        stage.reset();
        resetTransient(live, packs);
        present(live, packs);
        // fast-forward through earlier steps without animation (a failed device stays down)
        stage.instant = true;
        for (const s of scene.steps.slice(0, i)) for (const a of s.actions) await a.run(replay);
        stage.instant = false;
        const epoch = stage.epoch;

        const step = scene.steps[i];
        this.text = step.text;
        this.say = step.say;
        this.hints = step.hints;
        this.ask = null;
        this.refresh();

        for (const a of step.actions) {
          if (epoch !== stage.epoch) return;
          await a.run(live);
        }
        if (epoch !== stage.epoch) return;
        actionsDone = true;
        this.refresh();
      },

      next(this: any) {
        if (this.idx < scene.steps.length - 1) this.go(this.idx + 1);
        else location.hash = '#/';
      },
    };
  });
}
