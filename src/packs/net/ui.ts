// Interactive side-panel for the net pack: live firewall rule editor + packet lab.
import { h } from '../../app/dom.ts';
import type { PanelFactory } from '../../app/panels.ts';
import { parseRule, sendPacket } from './sim.ts';
import type { NetState, Rule } from './sim.ts';

export const netPanel: PanelFactory = ({ scene, rt, onChange }) => {
  const st = rt.state.net as NetState;
  const ids = new Set(scene.entities.map((e) => e.id));
  const wrap = h('div.panels');

  for (const [fwId, fw] of Object.entries(st.rules)) {
    const label = scene.entities.find((e) => e.id === fwId)?.label ?? fwId;
    const card = h('section.card.rules-card');
    const list = h('ol.rules');

    const commit = () => {
      const rows = [...list.querySelectorAll<HTMLInputElement>('input.rule-input')];
      const rules: Rule[] = [];
      for (const inp of rows) {
        const res = inp.value.trim() ? parseRule(inp.value, (id) => ids.has(id)) : {};
        const err = inp.parentElement!.querySelector('.rule-err')!;
        inp.classList.toggle('invalid', !!res.error);
        inp.setAttribute('aria-invalid', String(!!res.error));
        err.textContent = res.error ?? '';
        if (res.rule) rules.push(res.rule);
      }
      fw.rules = rules;
      onChange();
    };

    const row = (text: string) => {
      const inp = h('input.rule-input', {
        value: text, spellcheck: false, autocomplete: 'off', readOnly: !fw.editable,
        'aria-label': 'Firewall rule', placeholder: 'allow tcp:22 from laptop to web',
      });
      inp.addEventListener('input', commit);
      const li = h('li.rule', null,
        h('div.rule-line', null,
          inp,
          fw.editable && h('button.icon-btn', { title: 'Move up', 'aria-label': 'Move rule up', onclick: () => { li.previousElementSibling?.before(li); commit(); } }, '↑'),
          fw.editable && h('button.icon-btn', { title: 'Delete rule', 'aria-label': 'Delete rule', onclick: () => { li.remove(); commit(); } }, '✕'),
        ),
        h('div.rule-err', { 'aria-live': 'polite' }),
      );
      return li;
    };

    const render = () => {
      list.replaceChildren(...fw.rules.map((r) => row(r.text)));
      policy.value = fw.policy;
    };

    const policy = h('select.policy', { disabled: !fw.editable, 'aria-label': 'Default policy' },
      h('option', { value: 'deny' }, 'deny'),
      h('option', { value: 'allow' }, 'allow'));
    policy.addEventListener('change', () => { fw.policy = policy.value as 'allow' | 'deny'; onChange(); });

    card.append(h('div', null,
      h('header.card-head', null, h('h3', null, `Firewall rules · ${label}`), fw.editable ? h('span.badge', null, 'editable') : h('span.badge.muted', null, 'read-only')),
      h('p.card-sub', null, 'Checked top to bottom. First match wins.'),
      list,
      h('div.policy-row', null, h('span', null, 'No match → default policy'), policy),
      fw.editable && h('div.row-actions', null,
        h('button.btn.small', { onclick: () => { const li = row(''); list.append(li); li.querySelector('input')!.focus(); } }, '+ Add rule'),
        h('button.btn.small.ghost', {
          onclick: () => {
            fw.rules = fw.initial.map((t) => parseRule(t, (id) => ids.has(id)).rule!).filter(Boolean);
            fw.policy = fw.initialPolicy;
            render();
            onChange();
          },
        }, 'Reset'),
      ),
    ));
    render();
    wrap.append(card);
  }

  // ---- packet lab: learner sends any packet they like ----
  const ends = scene.entities.filter((e) => !['fw', 'switch', 'router'].includes(e.kind));
  if (ends.length >= 2) {
    const opts = (sel: number) => ends.map((e, i) => h('option', { value: e.id, selected: i === sel }, e.label));
    const from = h('select', { 'aria-label': 'From' }, opts(0));
    const to = h('select', { 'aria-label': 'To' }, opts(ends.length - 1));
    const proto = h('select', { 'aria-label': 'Protocol' }, h('option', { value: 'tcp' }, 'TCP'), h('option', { value: 'udp' }, 'UDP'), h('option', { value: 'icmp' }, 'ping'));
    const port = h('input', { type: 'number', min: 1, max: 65535, value: 22, 'aria-label': 'Port', list: 'well-known-ports' });
    const dl = h('datalist', { id: 'well-known-ports' }, ...[22, 53, 80, 443, 3306].map((p) => h('option', { value: p })));
    proto.addEventListener('change', () => { port.disabled = proto.value === 'icmp'; });
    const go = h('button.btn.primary', {
      onclick: async () => {
        const p = parseInt(port.value, 10);
        if (proto.value !== 'icmp' && !(p >= 1 && p <= 65535)) { port.focus(); return; }
        if (from.value === to.value) return;
        await sendPacket(rt, { src: from.value, dst: to.value, proto: proto.value as 'tcp' | 'udp' | 'icmp', port: proto.value === 'icmp' ? null : p });
        onChange();
      },
    }, 'Send packet');
    wrap.append(h('section.card.lab', null,
      h('header.card-head', null, h('h3', null, 'Packet lab')),
      h('p.card-sub', null, 'Try any packet and watch what happens.'),
      h('div.lab-grid', null,
        h('label', null, 'From', from), h('label', null, 'To', to),
        h('label', null, 'Protocol', proto), h('label', null, 'Port', port, dl)),
      go,
    ));
  }
  return wrap;
};
