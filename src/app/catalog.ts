import { h } from './dom.ts';
import * as progress from './progress.ts';
import { entries, TRACKS } from './scenes.ts';

export function renderCatalog(root: HTMLElement, rerender: () => void) {
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const track = e.scene?.packs[0] ?? 'broken';
    groups.set(track, [...(groups.get(track) ?? []), e]);
  }

  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true });
  const msg = h('span.tools-msg', { 'aria-live': 'polite' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    try {
      const n = progress.importText(await f.text());
      msg.textContent = `Imported progress for ${n} topic${n === 1 ? '' : 's'}.`;
      setTimeout(rerender, 900);
    } catch (err) {
      msg.textContent = `Import failed: ${(err as Error).message}`;
    }
  });

  const resetBtn = h('button.btn.small.ghost', {
    onclick: () => {
      if (resetBtn.dataset.armed) { progress.resetAll(); rerender(); return; }
      resetBtn.dataset.armed = '1';
      resetBtn.textContent = 'Click again to erase all progress';
      setTimeout(() => { delete resetBtn.dataset.armed; resetBtn.textContent = 'Reset'; }, 4000);
    },
  }, 'Reset');

  root.replaceChildren(
    h('div.catalog', null,
      h('header.hero', null,
        h('div.brand', null, h('span.logo', { 'aria-hidden': true }), 'visilearn'),
        h('h1', null, 'Learn computer science by seeing and doing'),
        h('p.lede', null, 'Short, interactive scenes. Watch the concept move, predict what happens, then try it yourself.'),
      ),
      [...groups].map(([track, list]) =>
        h('section.track', null,
          h('h2', null, TRACKS[track] ?? (track === 'broken' ? 'Scenes with errors' : track)),
          h('div.grid', null, list.map((e) => {
            if (!e.scene) {
              return h('article.card.scene-card.broken', null,
                h('h3', null, e.file),
                h('ul.diags', null, e.diags.filter((d) => d.severity === 'error').map((d) => h('li', null, `L${d.line}: ${d.msg}`))));
            }
            const s = e.scene;
            const pct = progress.percent(s.id, s.steps.length);
            return h('a.card.scene-card', { href: `#/s/${s.id}` },
              h('h3', null, s.title),
              s.about && h('p', null, s.about),
              h('div.meta', null,
                h('span', null, `${s.steps.length} steps`),
                h('span', null, pct === 100 ? 'Completed ✓' : pct ? `${pct}%` : 'Start →')),
              h('div.bar', { role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-label': `${s.title} progress` },
                h('span', { style: `width:${pct}%` })),
            );
          })),
        )),
      h('footer.tools', null,
        h('div', null,
          h('strong', null, 'Your progress stays on this device.'),
          ' Export it to back up or move to another browser.'),
        h('div.tool-btns', null,
          h('button.btn.small', { onclick: () => progress.exportFile() }, 'Export'),
          h('button.btn.small', { onclick: () => fileInput.click() }, 'Import'),
          resetBtn, fileInput),
        msg,
      ),
    ),
  );
}
