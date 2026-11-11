export * from './types.ts';
export { compile } from './compile.ts';
export type { CompileResult } from './compile.ts';
export { parse, splitArgs, takeIdList } from './parser.ts';
export { didYouMean } from './suggest.ts';
export { createState, resetTransient, headlessFx, simulate } from './runtime.ts';
export type { LogEntry, StepReport } from './runtime.ts';
export { layoutScene } from './layout.ts';
export type { Layout, Pos } from './layout.ts';

export const CORE_VOCAB = `# visilearn scene language (core)
Line-based. Indent = child. "quotes" for text with spaces. key=value props. # comments.
No coordinates: layout is automatic (left→right by entity tier; override with col=N).

scene <pack.name> "Title"          # line 1
about "One-sentence summary"
use <pack>
<kind> <id>[, <id>...] [subvalue] [label="..."] [info="..."] [col=N]
link a b c                         # chain a–b–c (repeat lines for branches)
step "What the learner reads"
  say "extra paragraph"
  hint "shown on demand"
  highlight a, b
  note <id> "callout text"
  wait 500ms
  ask "Question?" opt1|opt2|opt3 answer=opt2     # or quoted options; answer=text or 1-based number
  goal <condition>[, <condition>...]           # live checklist; step completes when all met
  <pack actions>
Steps run their lines in order; an ask pauses until answered (predict → observe).`;
