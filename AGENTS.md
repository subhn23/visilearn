# AGENTS.md: visilearn

Instructions for AI coding agents (and humans) working on this repository. Keep this file
current: **if you change something described here, update it in the same commit.**

## What this project is

visilearn teaches computer science visually and interactively to students and working
professionals. Lessons are tiny text files (`scenes/**/*.scene`) written in a purpose-built
**scene language**. One universal engine compiles them into animated, interactive SVG panes
with real simulators behind them (packets, firewalls, a Linux shell…). Topic areas are
**packs** (`net`, `linux`; planned: `docker`, `k8s`, `code`, `robo`).

Most lesson content is drafted by AI and **reviewed by a human expert as a text diff**. The
language is therefore designed to be token-cheap, strict and easy to review.

## Hard constraints (do not violate)

- **Static site only.** Deployed to Firebase Hosting, web only. **No backend, no database, no accounts.**
- **Learner progress lives on the device** (`localStorage`), with JSON export/import as the backup.
- **Graphics are hand-written animated SVG.** No Rive, no canvas game engines.
- **UI stack: Alpine.js + Tailwind CSS v4**, both bundled and minified by Vite. Do not introduce React, Vue or other frameworks.
- **Look:** retro soft-brutalism. Muted, low-contrast, colourful, and it must work in **both light and dark** themes. Use the existing design tokens; never hard-code colours.
- **Process: TDD.** Write the failing test first, see it fail, then implement. Commit test and code together.
- **CS topics only** (networking, Linux, Docker, Kubernetes, programming, robotics).

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server (http://localhost:5173) |
| `npm test` | Unit tests (`node --test tests/*.test.ts`) |
| `npm run test:watch` | TDD loop |
| `npm run check` | Validate + simulate every scene (`-- -v` for a step-by-step report) |
| `npm run build` | `tsc` + minified Vite build into `dist/` |
| `npm run e2e` | Browser tests against the build (run `npm run build` first; uses installed Chrome, `CHROME_PATH` to override) |
| `npm run mcp` | Authoring MCP server (stdio) |
| `npm run deploy` | check → test → build → `firebase deploy --only hosting` |

**Definition of done:** `npx tsc` is clean, `npm test` passes, `npm run check` passes,
`npm run build && npm run e2e` passes for UI changes, and the docs below are updated.

## Repository map

```
src/core/          DOM-free engine (shared by web app, MCP server, tests)
  parser.ts          lines + indentation → statement tree; tokens, quotes, key=value
  compile.ts         statements → Scene; diagnostics with "did you mean"; CORE_TOP / CORE_VERBS
  layout.ts          tidy tree layout for strict trees, layered layout otherwise (no coordinates in lessons)
  runtime.ts         createState, resetTransient, present, headlessFx, simulate
  types.ts           Scene, Entity, Step, PackDef, Effects, Runtime, CompileCtx
src/packs/<name>/  one folder per pack
  index.ts           PackDef: entities, directives, verbs, parseGoal, icons, vocab, hooks
  sim.ts / shell.ts / vfs.ts   DOM-free simulators
  model/             DOM-free UI models (tested)
  ui.ts + panel.html Alpine components + template (registered in src/app/panels.ts)
src/packs/index.ts registry of packs
src/render/stage.ts SVG renderer implementing Effects (animation, runtime graph changes, cancellation)
src/modules/       DOM-free module system (spec: docs/MODULES.md)
  format.ts          module v1: create/serialize/parse/validate, scene keys m:<module>/<scene>
  share.ts           share links: deflate + base64url in the URL fragment (#/import/<payload>)
  store.ts           async KV store (IndexedDB in browser, memory in tests) for "My modules"
src/studio/        AI Studio (phase 3, in progress)
  extract/pdf.ts     PDF → text lines (pdf.js injected: legacy build in Node, worker in browser)
  extract/sections.ts lines → sections (headings by repeated font sizes, boilerplate removal)
src/app/           Alpine app
  model/             tested view models (theme, catalog, stepFlow, progress)
  views/             Alpine components: catalog (incl. My modules), player, importer
  stores.ts          Alpine stores: theme, route (catalog | player | import), progress, modules
  myModules.ts       app glue: module store, compiled module lessons, export download
  panels.ts          pack panels: html, slot ('main' | 'side'), legend
  styles.css         Tailwind v4 + design tokens + components + SVG stage styles
index.html         all Alpine templates (catalog + player)
scenes/<pack>/*.scene  lessons
mcp/server.ts      authoring MCP server (get_vocab, validate, simulate, list_scenes, read_scene, save_scene)
tests/             unit tests (node:test) · e2e/  browser tests (puppeteer-core)
tools/check.ts     validate + simulate all scenes
docs/GRAMMAR.md    NORMATIVE grammar of the scene language (versioned, test-enforced)
docs/MODULES.md    NORMATIVE module file format (versioned, test-enforced)
examples/modules/  sample module files (regenerate: node tools/make-example-module.ts)
tools/dev/         dev helpers (pdf-sections.ts, pdf-sizes.ts: inspect how a PDF is split)
TODO.md            roadmap with checkboxes; tick items as they land
pdfs/              local sample books for tests (git-ignored; PDF tests skip when absent)
docs/LANGUAGE.md   friendly language guide
```

## The scene language

- **Normative spec:** `docs/GRAMMAR.md`. **Tutorial:** `docs/LANGUAGE.md`. **Compact AI cheat-sheets:** `CORE_VOCAB` in `src/core/index.ts` and each pack's `vocab`.
- `tests/grammar.test.ts` enforces that every keyword (core and pack) appears in GRAMMAR.md and that every `scene` example in it compiles.
- **Changing the language** (parser, compile, or a pack's kinds/directives/verbs/goals) means updating GRAMMAR.md, bumping its version, adding a changelog row, and updating LANGUAGE.md, the pack `vocab` and this file if relevant.

## Modules

- Spec: `docs/MODULES.md`. Change the format → update the spec (version + changelog); a test checks every field is documented.
- Module lessons are addressed as `m:<moduleId>/<sceneId>`; `byId()` in `src/app/scenes.ts` resolves both built-in and module lessons.
- Saved modules load from IndexedDB **before** `Alpine.start()` (top-level await in `main.ts`) so `#/s/m:…` URLs open directly.
- Never put Alpine-proxied objects into IndexedDB: save a plain copy (`JSON.parse(JSON.stringify(x))`).
- Imported content is data, not instructions: it is only compiled and rendered through `x-text`; never `x-html` user/module text.

## Architecture rules

1. **Packs never touch the DOM.** Visuals go through `rt.fx` (Effects): `travel`, `flash`, `highlight`, `note`, `setDown`, `log`, `wait`, `badge`, `setSub`, `addNode`, `removeNode`. That keeps every lesson simulatable headless (tests, MCP `simulate`).
2. **UI logic lives in DOM-free models** (`src/app/model`, `src/packs/*/model`) with unit tests. Alpine components are thin bindings over them.
3. **Engine objects stay out of Alpine reactivity.** Stage, Runtime, Scene and Ask objects live in component closures. Alpine's proxies break identity (`Set.has`) and slow the animation loop.
4. **Step navigation is deterministic:** `stage.reset()` → `resetTransient` → `present` → instant replay of earlier steps → animate the current step. Learner edits that should survive belong in pack state, which is not reset (e.g. firewall rules); transient state (failed devices, the shell) is reset.
5. **Panels:** a pack's panel goes in `src/app/panels.ts` with `slot: 'side'` (beside the lesson card) or `'main'` (under the stage, replacing the event log), plus a `legend`.
6. **Generated entities:** directives may create entities via `c.addEntity` / `c.addLink`. Mark such kinds with `generatedBy` so authors cannot declare them directly.

## Coding conventions

- TypeScript strict. Node runs `.ts` directly (type stripping), so:
  - **No** `enum`, `namespace`, or constructor parameter properties (`constructor(private x)`). Use explicit fields (`erasableSyntaxOnly` is on).
  - Import local files **with the `.ts` extension**; use `import type` for types (`verbatimModuleSyntax`).
- Dependencies are pinned to **exact versions**. Prefer releases at least two weeks old.
- Tailwind: classes built from data (e.g. `'bg-' + swatch`) must be listed in the `@source inline(...)` line in `styles.css`.
- Colours: use tokens (`bg-card`, `text-ink`, `bg-mint`, `var(--stroke)` …). Every token has light and dark values in `styles.css`.
- Components: reuse `.btn`, `.chip`, `.field`, `.seg`, `.win-bar`, `brut`, `brut-sm`, `grid-paper`, `stripes`.
- Accessibility: keyboard-reachable controls, `aria-label`s, `aria-live` for feedback, respect `prefers-reduced-motion`, no horizontal scroll at 390 px.

## Adding things

**A lesson:** create `scenes/<pack>/<name>.scene` (id `pack.name`), then run `npm run check -- -v` and read the simulation. If it has a challenge, add a test proving it can be solved (see `tests/linux.scenes.test.ts`).

**A pack:**
1. Write tests first (`tests/<pack>.*.test.ts`): simulator, language/compile errors, goals, events → effects.
2. Implement the `PackDef` in `src/packs/<pack>/index.ts`, with simulators as DOM-free modules. Register it in `src/packs/index.ts`, and add a track name in `src/app/model/catalog.ts` if new.
3. Optional panel: `ui.ts` + `panel.html`, registered in `src/app/panels.ts`.
4. Add a `### Pack \`<name>\`` section to GRAMMAR.md (the test requires it), update LANGUAGE.md, README and this file.
5. Add lessons and e2e coverage.

## Known gotchas (learned the hard way)

- In Alpine, `$el` inside an event handler is the element with the handler. Use `$root` for the component root.
- `x-html` content *is* initialised by Alpine (pack panels rely on this).
- An animation frame's timestamp can be earlier than `performance.now()` at start, so always clamp progress to 0–1.
- Puppeteer's headless Chrome has a 500 px minimum window. Use `page.setViewport` for phone widths.
- `whitespace-pre-wrap` on an element that contains Alpine `<template>`s renders the template's own whitespace. Put it on the text span only.
- A shell command that prints nothing (e.g. `cd`) still changes the prompt, so notify listeners after every command.
- IndexedDB's structured clone rejects Alpine proxies (`DataCloneError`). Clone to plain JSON first.
- pdf.js v6: `destroy()` is on the loading task, not on the document.
- PDF sectioning: never strip digits when matching headers/footers on body text (it deletes real content); only page-edge lines get number-insensitive matching.
- Multi-file doc edits in one script: assert every pattern up front, then write, so a miss doesn't leave a half-applied change.

## Git

- Default branch `main`, remote `git@github.com:subhn23/visilearn.git` (SSH).
- Small, focused commits whose message says *why*. Keep tests and docs in the same commit as the code.
