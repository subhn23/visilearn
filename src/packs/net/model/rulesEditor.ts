import { parseRule } from '../sim.ts';
import type { FwRules, Rule } from '../sim.ts';

export interface RuleRow {
  id: number;
  text: string;
  error: string;
}

/**
 * DOM-free editor state for one firewall's rule list. Every edit is applied to the
 * live firewall immediately so goals and the packet lab react as the learner types.
 */
export class RulesEditor {
  rows: RuleRow[] = [];
  readonly fw: FwRules;
  private seq = 0;
  private isEntity: (id: string) => boolean;
  private onChange: () => void;

  constructor(fw: FwRules, isEntity: (id: string) => boolean, onChange: () => void = () => {}) {
    this.fw = fw;
    this.isEntity = isEntity;
    this.onChange = onChange;
    this.rows = fw.rules.map((r) => this.row(r.text));
  }

  get policy() { return this.fw.policy; }
  get editable() { return this.fw.editable; }
  get errorCount() { return this.rows.filter((r) => r.error).length; }

  private row(text: string): RuleRow {
    return { id: ++this.seq, text, error: this.check(text) };
  }

  private check(text: string): string {
    return text.trim() ? parseRule(text, this.isEntity).error ?? '' : '';
  }

  private apply() {
    const rules: Rule[] = [];
    for (const r of this.rows) {
      r.error = this.check(r.text);
      const res = r.text.trim() && !r.error ? parseRule(r.text, this.isEntity) : null;
      if (res?.rule) rules.push(res.rule);
    }
    this.fw.rules = rules;
    this.onChange();
  }

  private edit(fn: () => void) {
    if (!this.fw.editable) return;
    fn();
    this.apply();
  }

  add(text = '') { this.edit(() => this.rows.push(this.row(text))); }

  update(id: number, text: string) {
    this.edit(() => { const r = this.rows.find((x) => x.id === id); if (r) r.text = text; });
  }

  remove(id: number) { this.edit(() => { this.rows = this.rows.filter((r) => r.id !== id); }); }

  moveUp(id: number) {
    this.edit(() => {
      const i = this.rows.findIndex((r) => r.id === id);
      if (i > 0) [this.rows[i - 1], this.rows[i]] = [this.rows[i], this.rows[i - 1]];
    });
  }

  setPolicy(p: 'allow' | 'deny') { this.edit(() => { this.fw.policy = p; }); }

  reset() {
    this.edit(() => {
      this.fw.policy = this.fw.initialPolicy;
      this.rows = this.fw.initial.map((t) => this.row(t));
    });
  }
}
