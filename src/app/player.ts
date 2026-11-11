import { createState, resetTransient } from '../core/runtime.ts';
import type { Ask, Entity, Runtime, Scene, Tone } from '../core/types.ts';
import { packs } from '../packs/index.ts';
import { Stage } from '../render/stage.ts';
import { h } from './dom.ts';
import { panels } from './panels.ts';
import * as progress from './progress.ts';

/** Mounts an interactive scene player. Returns a cleanup function. */
export function mountPlayer(root: HTMLElement, scene: Scene): () => void {
  const stage = new Stage(scene, packs);
  const state = createState(scene, packs);
  const saved = progress.sceneProgress(scene.id);
  for (const name of scene.packs) if (saved?.user?.[name]) packs[name].importUser?.(state[name], saved.user[name]);

  let pendingAsk: (() => void) | null = null;
  const live: Runtime = { scene, state, fx: stage, headless: false, ask: (a) => showAsk(a) };
  const replay: Runtime = { scene, state, fx: stage, headless: true, ask: async () => {} };

  let idx = 0;
  let actionsDone = false;
  const correct = new Set<Ask>();

  // ---- DOM ----------------------------------------------------------------
  const stepDots = h('ol.step-dots', { 'aria-label': 'Steps' });
  const stepNo = h('div.step-no');
  const stepText = h('h2.step-text', { tabindex: -1 });
  const sayBox = h('div.say');
  const askBox = h('div.ask', { 'aria-live': 'polite' });
  const goalBox = h('ul.goals', { 'aria-live': 'polite' });
  const hintBox = h('div.hints');
  const status = h('div.step-status', { 'aria-live': 'polite' });
  const logList = h('ol.log', { 'aria-live': 'polite' });
  const inspector = h('section.card.inspector', { hidden: true });
  const prevBtn = h('button.btn', { onclick: () => go(idx - 1), 'aria-label': 'Previous step' }, '← Prev');
  const replayBtn = h('button.btn.ghost', { onclick: () => go(idx), 'aria-label': 'Replay step' }, '↻ Replay');
  const nextBtn = h('button.btn.primary', { onclick: () => (idx < scene.steps.length - 1 ? go(idx + 1) : finish()) }, 'Next →');
  const speed = h('select.speed', { 'aria-label': 'Animation speed' },
    h('option', { value: '0.5' }, '0.5×'), h('option', { value: '1', selected: true }, '1×'), h('option', { value: '2' }, '2×'));
  speed.addEventListener('change', () => { stage.speed = parseFloat(speed.value); });

  const onChange = () => {
    for (const name of scene.packs) {
      const data = packs[name].exportUser?.(state[name]);
      if (data !== undefined) progress.setUserData(scene.id, scene.steps.length, name, data);
    }
    refresh();
  };

  const panelEls = scene.packs.map((name) => panels[name]?.({ scene, rt: live, onChange })).filter(Boolean) as HTMLElement[];

  root.replaceChildren(
    h('div.player', null,
      h('header.player-head', null,
        h('a.back', { href: '#/' }, '← All topics'),
        h('h1', null, scene.title),
        h('div.head-tools', null, h('label.speed-label', null, 'Speed', speed)),
      ),
      h('div.player-body', null,
        h('div.stage-col', null,
          h('div.stage-wrap', null, stage.svg),
          h('p.stage-tip', null, 'Tip: click any device to learn what it does.'),
          h('section.card.log-card', null, h('header.card-head', null, h('h3', null, 'Event log')), logList),
        ),
        h('aside.side', null,
          h('section.card.step-card', null,
            stepDots, stepNo, stepText, sayBox, askBox, goalBox, hintBox, status,
            h('div.controls', null, prevBtn, replayBtn, nextBtn),
          ),
          inspector,
          ...panelEls,
        ),
      ),
    ),
  );

  // ---- behaviour ------------------------------------------------------------
  stage.onLog = (msg: string, tone?: Tone) => {
    logList.prepend(h('li', { class: `tone-${tone ?? 'info'}` }, msg));
    while (logList.children.length > 40) logList.lastElementChild!.remove();
  };

  stage.onSelect = (e: Entity) => {
    stage.select(e.id);
    const kind = packs[e.pack].entities[e.kind];
    inspector.hidden = false;
    inspector.replaceChildren(...[
      h('header.card-head', null, h('h3', null, e.label), h('span.badge.muted', null, e.kind)),
      e.sub && h('p.mono', null, e.sub),
      e.props.port && h('p.card-sub', null, `Listening on port${e.props.port.includes(',') ? 's' : ''} ${e.props.port}`),
      h('p', null, e.props.info ?? kind.about),
      h('button.btn.small.ghost', { onclick: () => { inspector.hidden = true; stage.select(null); } }, 'Close'),
    ].filter((x): x is HTMLElement => x instanceof HTMLElement));
  };

  function showAsk(a: Ask): Promise<void> {
    return new Promise((resolve) => {
      const feedback = h('p.ask-feedback');
      const done = () => { pendingAsk = null; resolve(); };
      pendingAsk = done;
      const buttons = a.options.map((opt, i) =>
        h('button.option', {
          onclick: (ev: Event) => {
            const b = ev.currentTarget as HTMLButtonElement;
            if (i === a.answer) {
              b.classList.add('right');
              buttons.forEach((x) => (x.disabled = true));
              feedback.textContent = 'Correct!';
              feedback.className = 'ask-feedback ok';
              correct.add(a);
              refresh();
              setTimeout(done, 600);
            } else {
              b.classList.add('wrong');
              b.disabled = true;
              feedback.textContent = 'Not quite. Try another answer.';
              feedback.className = 'ask-feedback bad';
            }
          },
        }, opt));
      askBox.replaceChildren(h('div.ask-q', null, h('span.ask-tag', null, 'Predict'), a.question), h('div.options', null, buttons), feedback);
      buttons[0]?.focus({ preventScroll: true });
    });
  }

  function stepComplete(): boolean {
    const step = scene.steps[idx];
    return actionsDone && step.asks.every((a) => correct.has(a)) && step.goals.every((g) => g.check(live));
  }

  function refresh() {
    const step = scene.steps[idx];
    goalBox.replaceChildren(...step.goals.map((g) => {
      const met = g.check(live);
      return h('li', { class: met ? 'met' : '' }, h('span.check', { 'aria-hidden': true }, met ? '✓' : ''), h('span', null, g.label), h('span.sr-only', null, met ? ' (done)' : ' (not yet)'));
    }));
    const complete = stepComplete();
    if (complete) progress.markDone(scene.id, idx, scene.steps.length);
    const done = new Set(progress.sceneProgress(scene.id)?.done ?? []);
    [...stepDots.children].forEach((li, i) => {
      li.classList.toggle('done', done.has(i));
      li.classList.toggle('current', i === idx);
    });
    status.textContent = complete ? (step.goals.length ? 'Challenge complete!' : '') : step.goals.length && actionsDone ? 'Complete the checklist to finish this step.' : '';
    status.className = `step-status${complete && step.goals.length ? ' ok' : ''}`;
    nextBtn.textContent = idx === scene.steps.length - 1 ? 'Finish ✓' : 'Next →';
  }

  async function go(i: number) {
    if (i < 0 || i >= scene.steps.length) return;
    pendingAsk?.();
    idx = i;
    actionsDone = false;
    stage.reset();
    resetTransient(live, packs);
    // fast-forward state through earlier steps (e.g. a device that failed stays down)
    stage.instant = true;
    for (const s of scene.steps.slice(0, i)) for (const a of s.actions) await a.run(replay);
    stage.instant = false;
    const epoch = stage.epoch;

    const step = scene.steps[i];
    stepNo.textContent = `Step ${i + 1} of ${scene.steps.length}`;
    stepText.textContent = step.text;
    sayBox.replaceChildren(...step.say.map((p) => h('p', null, p)));
    askBox.replaceChildren();
    hintBox.replaceChildren(...step.hints.map((t) => {
      const d = h('details.hint', null, h('summary', null, 'Show a hint'), h('p', null, t));
      return d;
    }));
    prevBtn.disabled = i === 0;
    refresh();

    for (const a of step.actions) {
      if (epoch !== stage.epoch) return;
      await a.run(live);
    }
    if (epoch !== stage.epoch) return;
    actionsDone = true;
    refresh();
  }

  function finish() {
    progress.markDone(scene.id, idx, scene.steps.length);
    location.hash = '#/';
  }

  scene.steps.forEach((s, i) => stepDots.append(h('li', null, h('button', { 'aria-label': `Step ${i + 1}: ${s.text}`, title: s.text, onclick: () => go(i) }))));

  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('input, select, textarea')) return;
    if (e.key === 'ArrowRight') go(idx + 1);
    if (e.key === 'ArrowLeft') go(idx - 1);
  };
  window.addEventListener('keydown', onKey);

  // resume at the first unfinished step
  const done = new Set(saved?.done ?? []);
  const start = scene.steps.findIndex((_, i) => !done.has(i));
  go(start < 0 ? 0 : start);

  return () => {
    window.removeEventListener('keydown', onKey);
    stage.reset();
    pendingAsk?.();
  };
}
