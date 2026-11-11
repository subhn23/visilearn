// Prompts for the Studio. Kept short: local models have small context windows.
import { CORE_VOCAB } from '../core/index.ts';
import { CONCEPT_VOCAB } from '../packs/concept/index.ts';
import { ICONS } from '../packs/concept/icons.ts';

export const PACK_SYSTEM = `You design a small "data pack" for an interactive visual learning app.
A pack names the kinds of things a topic is about, so lessons can draw and animate them.
It contains no code: only kinds (with an icon, colour and properties) and macros.
A macro is a named list of building-block actions with UPPERCASE parameters.

${CONCEPT_VOCAB}

Rules:
- name: one short lowercase word for the topic (e.g. "git", "sql", "dns"). Not: net, linux, concept.
- 3 to 6 kinds: the main things learners must see (e.g. table, row, query). Lowercase names.
- icon: pick from the list given in the schema. swatch: a colour from the schema.
- props: properties worth showing; set "show" to one prop name to display it under the node, or "".
- label=true only for pointer-like kinds (a label/tag/name that points at another thing).
- 1 to 4 macros for the topic's key actions. Body lines use only building blocks and UPPERCASE params,
  e.g. {"name":"insert","params":["ROW","TABLE"],"body":["add row ROW to TABLE","flash ROW ok"]}.
- Explain in your own words. Never copy sentences from the source.

Answer with ONLY a JSON object of exactly this shape (no other text):
{"name":"sql","title":"SQL basics","about":"Tables, rows and queries.","kinds":[{"name":"table","icon":"table","swatch":"mustard","about":"Stores rows.","props":["rows"],"show":"rows","label":false}],"macros":[{"name":"insert","params":["ROW","TABLE"],"body":["add row ROW to TABLE","flash ROW ok"]}]}
icon is one of: ${Object.keys(ICONS).join(', ')}
swatch is one of: mustard, mint, lilac, peach, sky, rose`;

export const OUTLINE_SYSTEM = `You plan short interactive lessons for a visual learning app.
Each lesson teaches ONE idea with a small animated diagram, a prediction question and a hands-on challenge.
Order lessons from basic to advanced. "sections" lists the numbers of the source sections each lesson draws on.
Write titles and descriptions in your own words.

Answer with ONLY a JSON object of this shape:
{"lessons":[{"title":"Tables hold rows","about":"What a table is and why rows matter.","sections":[0,1],"key_concepts":["table","row"]}]}`;

export function lessonSystem(vocab: string): string {
  return `You write one interactive lesson as JSON for a visual learning app.
The app turns your JSON into a scene: entities (drawn as icons), links, then steps that animate.

${CORE_VOCAB}

${vocab}

Rules:
- entities: things on screen at the start. id: short, lowercase, letters/digits only (users, c1, r1).
  kind: one of the kinds above. props: key/value pairs (may be empty).
- Anything created later by an action (add …, or a macro that adds) must NOT be listed in entities.
- actions, button actions and goals are single lines in the language above, using only listed actions and ids.
- 3 to 6 steps, short text (under 120 characters each):
  1. introduce the picture (say + highlight/note),
  2. a step with an "ask" (a prediction with 2-4 options, answer = number of the correct option, 1-based)
     followed by the action that reveals the answer,
  3. a final "Your turn" step with 1-3 buttons whose actions make that step's goals true.
     The goals must be false before the buttons are pressed. Only this step has goals.
     Buttons must CHANGE something the goals check: add, set, connect, point or a pack macro
     (flash and highlight change nothing).
- Steps without a question use {"question":"","options":[],"answer":1}.
- Explain in your own words. Never copy sentences from the source.

Answer with ONLY a JSON object of this shape:
{"id":"first-table","title":"Your first table","about":"A table holds rows.",
 "entities":[{"kind":"table","id":"users","label":"users","props":[]}],
 "links":[],
 "steps":[
  {"text":"Meet the table","say":"A table stores rows.","ask":{"question":"","options":[],"answer":1},"actions":["highlight users"],"buttons":[],"goals":[]},
  {"text":"Add a row","say":"","ask":{"question":"Where does a new row go?","options":["Into the table","Nowhere"],"answer":1},"actions":["insert r1 users"],"buttons":[],"goals":["exists r1"]},
  {"text":"Your turn","say":"Add another row.","ask":{"question":"","options":[],"answer":1},"actions":[],"buttons":[{"label":"INSERT","action":"insert r2 users"}],"goals":["exists r2"]}]}
(That example assumes a pack with a "table" kind and an "insert" macro; use the kinds and actions listed above.)`;
}

export const REPAIR = (text: string, errors: string[]) => `Your JSON was converted into this text (line numbers on the left):

${text}

It has these errors:
${errors.map((e) => `- ${e}`).join('\n')}

Return the corrected JSON. Fix only what the errors point at; keep everything else.`;

export const ICON_NAMES = Object.keys(ICONS).join(', ');
