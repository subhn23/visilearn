export interface StepState {
  actionsDone: boolean;
  /** number of asks in the step */
  asks: number;
  /** number answered correctly */
  correct: number;
  /** goal results, in order */
  goals: boolean[];
}

export function resumeIndex(done: number[], total: number): number {
  const set = new Set(done);
  for (let i = 0; i < total; i++) if (!set.has(i)) return i;
  return 0;
}

export function isStepComplete(s: StepState): boolean {
  return s.actionsDone && s.correct >= s.asks && s.goals.every(Boolean);
}

export function stepStatus(s: StepState): { tone: 'idle' | 'todo' | 'done'; text: string } {
  if (isStepComplete(s)) return { tone: 'done', text: s.goals.length ? 'Challenge complete!' : 'Step complete.' };
  if (s.correct < s.asks) return { tone: 'todo', text: 'Answer the question to continue.' };
  if (!s.actionsDone) return { tone: 'idle', text: 'Watch…' };
  const met = s.goals.filter(Boolean).length;
  return { tone: 'todo', text: `${met} of ${s.goals.length} goals met.` };
}
