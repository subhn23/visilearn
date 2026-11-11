# CLAUDE.md

@AGENTS.md

## Claude Code specifics

- **Read AGENTS.md first** (imported above). It holds the project facts, hard constraints, commands and conventions. Keep AGENTS.md (shared by all agents) as the single source of truth; put only Claude-specific notes here.
- **MCP:** `.mcp.json` registers the `visilearn` authoring server (`node mcp/server.ts`). When writing or editing lessons, prefer its tools: `get_vocab` (only the packs needed), then `validate`, `simulate`, and `save_scene`.
- **Language changes:** update `docs/GRAMMAR.md` (version + changelog) in the same change; `tests/grammar.test.ts` enforces it.
- **TDD is required:** show the red run before implementing, then the green run.
- **UI verification:** after UI changes, run `npm run build && npm run e2e`, and take screenshots in light and dark themes and at 390 px width before reporting done.
- **Keep docs current:** when a change affects anything described in AGENTS.md, CLAUDE.md, docs/GRAMMAR.md, docs/LANGUAGE.md or README.md, update them in the same commit.
- Commit and push only when asked.
