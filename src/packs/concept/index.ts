// Built-in `concept` pack: generic kinds + the building blocks, for any subject.
import type { EntityKind } from '../../core/types.ts';
import { CONCEPT_GOALS, makeConceptPack, PRIMITIVES } from './core.ts';
import { ICONS } from './icons.ts';

const kinds: Record<string, EntityKind & { icon: string }> = {
  actor: { tier: 0, swatch: 'rose', icon: 'person', about: 'Someone (or something) that acts: a user, a client, a service.' },
  box: { tier: 1, swatch: 'sky', icon: 'box', about: 'A component or thing in the system.' },
  process: { tier: 1, swatch: 'mint', icon: 'gear', about: 'A step or process that does work.' },
  idea: { tier: 1, swatch: 'lilac', icon: 'circle', about: 'A concept or state.' },
  doc: { tier: 2, swatch: 'sky', icon: 'file', about: 'A document, message or piece of data.' },
  store: { tier: 3, swatch: 'mustard', icon: 'database', about: 'Where data is kept: a database, a file, a queue.' },
};

export const CONCEPT_VOCAB = `# pack: concept (also the base of every data pack)
kinds: actor box process idea doc store   (props: any key=value; label="…")
building blocks (actions):
  add KIND ID [to PARENT] [prop=v…]   # appears later (hidden until then)
  remove ID · connect A B · disconnect A B · point A B (A now points only at B)
  set ID prop=value · flow A B [C…] [label="…"] [tone=ok|bad|warn]
  mark ID "text" · unmark ID · flash ID [ok|bad|warn|info]
goals: ${CONCEPT_GOALS}
learner controls: button "Label" <action>`;

export const concept = makeConceptPack({
  name: 'concept',
  about: 'Generic building blocks for explaining any idea: things, links, states and flows.',
  origin: 'builtin',
  kinds: Object.fromEntries(Object.entries(kinds).map(([k, { icon: _i, ...def }]) => [k, def])),
  icons: Object.fromEntries(Object.entries(kinds).map(([k, v]) => [k, ICONS[v.icon]])),
  vocab: CONCEPT_VOCAB,
});

export { PRIMITIVES };
