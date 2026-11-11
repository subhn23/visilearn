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

## Phase 3: Studio (AI agent that builds modules from your files)

- [~] Read files: PDF text extraction done (pdf.js, injectable; Node-tested). Still to do: browser worker wiring, DOCX (mammoth), Markdown, TXT
- [x] Split documents into sections (chapters/headings) with page references, drop headers/footers/TOC, join wrapped titles
- [x] Tested against the sample books in `pdfs/`: Git (195 pp → 66 chapters), PostgreSQL (74 pp → 34 chapters), < 1 s each
- [ ] Agent step 1, outline: model proposes lessons per section (structured JSON), user can edit/approve
- [ ] Agent step 2, draft: structured lesson plan (JSON) → deterministic converter → scene text
- [ ] Agent step 3, repair loop: compiler diagnostics fed back to the model (max N rounds)
- [ ] Agent step 4, verify: headless simulate; challenges must be unmet at start
- [ ] Live preview in the player while generating; edit source, regenerate one lesson
- [ ] Save as a module (author, sources with pages, licence note)
- [ ] Guardrails: paraphrase, never copy long passages; record source pages for reviewers
- [ ] Grammar → GBNF / JSON schema export for constrained decoding (llama.cpp / Ollama `format`)

## Phase 4: `concept` pack (any subject)

- [ ] Generic entities (box, actor, store, process…), arrows, states, groups
- [ ] Verbs: `move`, `set`, `show`, `hide`, `connect`, `flow` (animated token along an arrow)
- [ ] Goals for quizzes/ordering/matching
- [ ] GRAMMAR.md section + lessons built from the sample books (Git, PostgreSQL)

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
