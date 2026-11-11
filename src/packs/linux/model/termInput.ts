/** DOM-free state for the terminal's input line: history navigation and Tab completion. */
export interface Completer {
  complete(line: string): string;
  candidates(line: string): string[];
}

export class TermInput {
  value = '';
  history: string[] = [];
  private pos = -1; // -1 = editing the draft; otherwise index into history
  private draft = '';
  private completer: Completer;

  constructor(completer: Completer) {
    this.completer = completer;
  }

  submit(): string | null {
    const line = this.value.trim();
    this.value = '';
    this.pos = -1;
    if (!line) return null;
    if (this.history[this.history.length - 1] !== line) this.history.push(line);
    return line;
  }

  up() {
    if (!this.history.length) return;
    if (this.pos === -1) { this.draft = this.value; this.pos = this.history.length - 1; }
    else if (this.pos > 0) this.pos--;
    this.value = this.history[this.pos];
  }

  down() {
    if (this.pos === -1) return;
    if (this.pos < this.history.length - 1) { this.pos++; this.value = this.history[this.pos]; }
    else { this.pos = -1; this.value = this.draft; }
  }

  /** completes in place; returns the options to show when the match is ambiguous */
  tab(): string[] {
    const options = this.completer.candidates(this.value);
    if (options.length === 1) { this.value = this.completer.complete(this.value); return []; }
    return options;
  }
}
