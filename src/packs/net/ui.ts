// Alpine components for the net pack's side panel. Logic lives in tested DOM-free models.
import type { Alpine } from 'alpinejs';
import type { Runtime } from '../../core/types.ts';
import { buildPacket, labEndpoints } from './model/packetLab.ts';
import { RulesEditor } from './model/rulesEditor.ts';
import { sendPacket } from './sim.ts';
import type { NetState } from './sim.ts';
import html from './panel.html?raw';

/** Methods the player component exposes to nested pack panels. */
interface PlayerScope {
  rt(): Runtime;
  changed(): void;
}

export const netPanelHtml = html;

export function registerNetUI(alpine: Alpine) {
  alpine.data('netPanel', () => ({
    firewalls: [] as string[],
    init(this: PlayerScope & { firewalls: string[] }) {
      this.firewalls = Object.keys((this.rt().state.net as NetState).rules);
    },
  }));

  alpine.data('netRules', (fwId: string) => {
    let ed: RulesEditor;
    return {
      fwLabel: fwId,
      rows: [] as { id: number; text: string; error: string }[],
      policy: 'deny',
      editable: false,
      init(this: any) {
        const rt = (this as PlayerScope).rt();
        const ids = new Set(rt.scene.entities.map((e) => e.id));
        ed = new RulesEditor((rt.state.net as NetState).rules[fwId], (id) => ids.has(id), () => this.changed());
        this.fwLabel = rt.scene.entities.find((e) => e.id === fwId)?.label ?? fwId;
        this.sync();
      },
      sync(this: any) {
        this.rows = ed.rows.map((r) => ({ ...r }));
        this.policy = ed.policy;
        this.editable = ed.editable;
      },
      add(this: any) {
        ed.add('');
        this.sync();
        this.$nextTick(() => {
          const inputs = (this.$root as HTMLElement).querySelectorAll<HTMLInputElement>('input.field');
          inputs[inputs.length - 1]?.focus();
        });
      },
      update(this: any, id: number, text: string) {
        ed.update(id, text);
        // refresh errors without re-rendering inputs (keeps the caret where it is)
        ed.rows.forEach((r, i) => { if (this.rows[i]) this.rows[i].error = r.error; });
      },
      remove(this: any, id: number) { ed.remove(id); this.sync(); },
      moveUp(this: any, id: number) { ed.moveUp(id); this.sync(); },
      setPolicy(this: any, p: 'allow' | 'deny') { ed.setPolicy(p); this.sync(); },
      reset(this: any) { ed.reset(); this.sync(); },
    };
  });

  alpine.data('packetLab', () => ({
    ends: [] as { id: string; label: string }[],
    from: '',
    to: '',
    proto: 'tcp' as 'tcp' | 'udp' | 'icmp',
    port: '22',
    error: '',
    busy: false,
    init(this: any) {
      const rt = (this as PlayerScope).rt();
      this.ends = labEndpoints(rt.scene).map((e) => ({ id: e.id, label: e.label }));
      this.from = this.ends[0]?.id ?? '';
      this.to = this.ends[this.ends.length - 1]?.id ?? '';
    },
    async send(this: any) {
      const res = buildPacket({ from: this.from, to: this.to, proto: this.proto, port: String(this.port) });
      this.error = res.error ?? '';
      if (!res.packet) return;
      this.busy = true;
      try {
        await sendPacket((this as PlayerScope).rt(), res.packet);
      } finally {
        this.busy = false;
        (this as PlayerScope).changed();
      }
    },
  }));
}
