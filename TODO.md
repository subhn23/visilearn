# visilearn: roadmap & TODO

Status legend: `[x]` done · `[ ]` to do · `[~]` in progress.
Every item is built **test-first** (see AGENTS.md). Keep this file current as work lands.

---

## Done so far

- [x] Engine core: parser, compiler with "did you mean" diagnostics, automatic layout, headless runtime
- [x] Pack `net`: firewalls, routing, packets, live rule editor, packet lab (3 lessons)
- [x] Pack `linux`: filesystem tree, simulated shell, terminal with history/Tab (3 lessons)
- [x] Alpine + Tailwind retro UI, light/dark/auto themes, mobile layout
- [x] Client-side progress with JSON export/import
- [x] Authoring MCP server (`get_vocab`, `validate`, `simulate`, `list_scenes`, `read_scene`, `save_scene`)
- [x] Normative grammar `docs/GRAMMAR.md` (test-enforced), AGENTS.md, CLAUDE.md

---

## Phase 1: Modules (share & import, no AI) ✅

A **module** is a portable bundle of lessons: `{ format, version, id, title, description, author, track, tags, sources, scenes[] }`.

- [x] Module format v1: create, serialize, parse, validate (shape, size limits, every scene compiles, unique scene ids)
- [x] Spec the module format in `docs/MODULES.md` (normative, versioned, test-enforced)
- [x] Share links: compress module into the URL fragment (`#/import/<payload>`); round-trip, tamper and oversize handling
- [x] Module store: save/list/get/remove on an async key-value backend (IndexedDB in browser, memory in tests)
- [x] Scene keys for module lessons (`m:<moduleId>/<sceneId>`) so ids never clash with built-in lessons; progress works per key
- [x] Catalog: **My modules** section (cards listing their lessons, progress, open / export / copy link / delete)
- [x] Import: file picker + drag-and-drop, and an import-from-link preview screen ("Add to My modules")
- [x] Player opens module lessons (`#/s/m:<moduleId>/<sceneId>`)
- [x] e2e: import a module file, open a lesson, export it, share link round-trip, invalid file, delete
- [x] Docs: README, AGENTS.md, MODULES.md · sample module `examples/modules/starter.visilearn.json`

## Phase 2: Model connections (local first) ✅ core done

- [x] Provider interface: `listModels`, `version`, `chat` (streaming), structured JSON output, cancel, classified errors
- [x] Ollama provider (default): `/api/tags`, `/api/chat` with `format` (JSON schema); reasoning reported separately via `onThinking` (never send `think:false`: Gemma 4 then leaks reasoning into the answer)
- [x] OpenAI-compatible provider: LM Studio, llama.cpp server, vLLM, OpenRouter, OpenAI (SSE; `json_schema` with `json_object` fallback)
- [ ] Anthropic provider (browser access header) · Gemini provider (load the claude-api skill before writing the Anthropic one)
- [x] Settings screen (`#/settings`): provider list, base URL, model picker, API key (device-only, clearly labelled), **Test connection**, try-a-prompt, JSON check
- [x] Diagnosis: CORS vs unreachable (no-cors probe), missing model (`ollama pull …`), slow first load; copyable `OLLAMA_ORIGINS` fix with the real origin
- [x] Tests with fake fetch for every provider; e2e against fake servers; live tests vs local Ollama (`npm run test:live`, gemma4:12b ✓)
- [ ] Optional later: in-browser models (WebGPU) for zero-install local use

## Phase 2.5: Open pack system (packs are not a fixed list) ✅

Packs must be addable on the go (by the Studio, by modules, later by the marketplace), so a pack can be **data**:

- [x] Built-in `concept` pack: generic kinds + building blocks (`add remove connect disconnect point set flow mark unmark flash`) + graph goals (`ID.prop = v`, `exists`, `missing`, `linked`, `count`)
- [x] Pack definition language (`pack`, `kind` with icon/swatch/tier/show/role, `prop`, `macro` with UPPERCASE params) → compiled, validated, no code executed
- [x] Icon library + validated path icons (no raw SVG, so strangers' packs can't inject markup)
- [x] Registry per module (`withPacks`); modules carry `packs` (format v2); importer shows the packs a module adds
- [x] Core `button` step line: learner-triggered actions for any pack
- [x] Hidden entities (created later by `add`), shared state for the concept family, `link`/`unlink` effects
- [x] `role=label` layout: branches/HEAD stack on what they point at; history flows left → right
- [x] Example: `examples/modules/git-basics.visilearn.json` carries a `git` pack (commits, branches, merge); tests prove its challenges are solvable
- [x] Grammar 1.2 (concept pack + §6 pack definition language, test-enforced) · MODULES.md v2 · MCP `validate_pack`
- [ ] Direction-aware layout for histories (a merge commit should sit after both parents)
- [ ] Pack versioning + namespacing for the marketplace (`author/name@version`), conflict handling across modules
- [ ] Later: sandboxed code packs (iframe/worker, no network/storage) for reviewed marketplace simulators

## Phase 3: Studio (AI agent that builds modules, and new packs, from your files) ✅ first version

- [x] Read files in the browser: PDF (lazy pdf.js + worker), Markdown (headings → sections), TXT · [ ] DOCX (mammoth)
- [x] Split documents into sections (chapters/headings) with page references, drop headers/footers/TOC, join wrapped titles
- [x] Tested against the sample books in `pdfs/`: Git (195 pp → 66 chapters), PostgreSQL (74 pp → 34 chapters), < 1 s each
- [x] Agent step 0, pack: JSON → normalize → pack text → `compilePack` repair loop; or reuse a built-in pack (user's choice)
- [x] Agent step 1, outline: model proposes lessons with section refs; user edits titles/goals and picks which to keep
- [x] Agent step 2, draft: lesson JSON → normalize → deterministic converter → scene text (`use <pack>, concept`)
- [x] Agent step 3, repair loop: numbered text + compiler errors fed back (max 3 rounds); unreadable answers retried
- [x] Agent step 4, verify: headless simulate; challenges must start unsolved and be solvable by their buttons
- [x] Save & preview in the player; edit lesson source with live validation; rewrite one lesson; Stop
- [x] Save as a module (author, description, sources with page ranges)
- [x] Guardrails in prompts (own words, never copy) + source pages recorded · [ ] automatic overlap check against the source text
- [x] JSON schemas exist (opt-in `structured: true`). Live finding: gemma4:12b can loop forever under schema-constrained decoding, so the default is no schema + shape example in the prompt + `extractJson` + normalizers + per-stage token caps
- [ ] Grammar → GBNF export for llama.cpp
- [x] Live end-to-end with gemma4:12b on the Git book: pack → outline → lesson → module in ~160 s (1-2 repair rounds per stage)
- [ ] Lesson quality with small models: prefer the topic pack's kinds over generic concept kinds (rank/require them in the prompt, warn when a lesson uses none), deeper challenges than `set x prop=…`, few-shot from the user's own pack, per-step generation
- [ ] Flag extra arguments to building blocks (e.g. `connect a b c`)
- [ ] Persist Studio sessions (resume after reload)

## Phase 4: `concept` pack (any subject) ✅ core landed in phase 2.5

- [x] Generic entities (actor, box, process, idea, doc, store), links, states (props), flows
- [x] Building blocks + goals (see phase 2.5)
- [ ] Groups/containers, ordering and matching quiz goals
- [ ] Built-in concept lessons; Studio-made lessons from the sample books (Git, PostgreSQL)

## Phase 5: Marketplace (crowdsourced)

- [ ] Decide hosting: GitHub registry (static, PR-based) vs Firebase with sign-in
- [ ] Publish flow: export → submit (PR) → automated validation (compile + simulate + size) → review
- [ ] Static index of published modules (built by CI) and browse/search in the app
- [ ] Ratings & reviews (e.g. GitHub Discussions), author profiles, report abuse
- [ ] Moderation guidelines and licence rules (original or properly licensed content only)

## Housekeeping

- [ ] Choose a licence for the project
- [ ] CI: run `tsc`, unit tests, `check`, e2e on every push
- [ ] Offline support (service worker) · i18n (Hindi, Odia, …)
