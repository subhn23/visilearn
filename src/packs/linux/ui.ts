// Alpine terminal for the linux pack. Logic: Shell (simulator) + TermInput (history/tab), both tested.
import type { Alpine } from 'alpinejs';
import type { Runtime } from '../../core/types.ts';
import { runCommand } from './index.ts';
import type { LinuxState, TermLine } from './index.ts';
import { TermInput } from './model/termInput.ts';
import html from './panel.html?raw';

interface PlayerScope { rt(): Runtime; changed(): void }

export const linuxPanelHtml = html;

export function registerLinuxUI(alpine: Alpine) {
  alpine.data('linuxTerm', () => {
    let st: LinuxState;
    let input: TermInput;
    let off: () => void = () => {};
    return {
      lines: [] as TermLine[],
      prompt: '',
      user: '',
      value: '',
      options: [] as string[],
      busy: false,
      init(this: any) {
        const rt = (this as PlayerScope).rt();
        st = rt.state.linux as LinuxState;
        // st.shell is replaced on step reset, so always look it up at call time
        input = new TermInput({ complete: (l) => st.shell.complete(l), candidates: (l) => st.shell.candidates(l) });
        off = st.term.subscribe(() => this.sync());
        this.sync();
      },
      destroy() { off(); },
      sync(this: any) {
        this.lines = st.term.lines.map((l) => ({ ...l }));
        this.prompt = st.shell.prompt();
        this.user = st.shell.user;
        this.$nextTick(() => { const s = this.$refs.screen as HTMLElement; s.scrollTop = s.scrollHeight; });
      },
      setValue(this: any, v: string) { input.value = v; this.value = v; this.options = []; },
      async key(this: any, e: KeyboardEvent) {
        if (e.key === 'Enter') {
          e.preventDefault();
          const line = input.submit();
          this.value = '';
          this.options = [];
          if (!line) return;
          this.busy = true;
          try {
            await runCommand((this as PlayerScope).rt(), line, { learner: true });
          } finally {
            this.busy = false;
            (this as PlayerScope).changed();
            this.$nextTick(() => (this.$refs.input as HTMLInputElement).focus({ preventScroll: true }));
          }
        } else if (e.key === 'ArrowUp') { e.preventDefault(); input.up(); this.value = input.value; }
        else if (e.key === 'ArrowDown') { e.preventDefault(); input.down(); this.value = input.value; }
        else if (e.key === 'Tab') { e.preventDefault(); this.options = input.tab(); this.value = input.value; }
        else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); st.term.clear(); }
      },
    };
  });
}
