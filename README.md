# visilearn

Learn computer science by **seeing and doing**. Lessons are tiny text files in a purpose-built
scene language. One shared engine turns them into animated, interactive SVG scenes with built-in
simulators, so you never build a separate tool for each concept.

- **Static site.** Deploys to Firebase Hosting with no backend and no database.
- **Progress stays on the device** (localStorage), with Export/Import JSON for backup.
- **Authored with AI through MCP, reviewed by humans as text diffs.** A lesson is about 20–40 lines.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # validate + simulate every scene  (-v for step-by-step output)
npm test           # engine tests
npm run build      # → dist/
npm run deploy     # check + build + firebase deploy --only hosting
```

Before your first deploy: `npm i -g firebase-tools && firebase login && firebase use --add`.

## Writing a scene

```
scene net.firewall "Firewalls: who gets in?"
use net

host laptop 198.51.100.7 label="Admin laptop"
internet ext label="Internet"
fw edge
server web 203.0.113.10 port=80,22

link laptop edge web
link ext edge

rules edge editable policy=deny
  allow tcp:80 to web

step "SSH is blocked by the default policy"
  ask "What happens to SSH?" "Gets through" "Dropped by the firewall" answer=2
  laptop send web:22

step "Challenge: let only the admin SSH in"
  goal laptop->web:22 ok, ext->web:22 blocked
```

The full spec is in [docs/LANGUAGE.md](docs/LANGUAGE.md).

## AI authoring via MCP

`.mcp.json` registers a local stdio MCP server (`node mcp/server.ts`) that Claude Code picks up
automatically. For other clients, point them at `node /path/to/visilearn/mcp/server.ts`.

| Tool | Purpose |
|---|---|
| `get_vocab(packs?)` | Compact language cheat-sheet (only the packs you need) |
| `validate(source)` | Line-numbered errors with "did you mean" suggestions |
| `simulate(source)` | Runs every step headless: packet outcomes, ask answers, goal status |
| `list_scenes` / `read_scene(id)` | Browse existing lessons |
| `save_scene(source)` | Writes `scenes/<pack>/<name>.scene`; refuses invalid scenes |

Suggested workflow: AI drafts with `get_vocab` → `validate` → `simulate` → `save_scene`. A
professional reviews the `.scene` diff and runs `npm run dev` to try it.

## Layout

```
src/core/        DOM-free engine: parser, compiler, layout, headless runtime (shared with MCP + tests)
src/packs/net/   networking pack: entities, rules, send/ping/kill, firewall simulator, icons, side panel
src/render/      SVG stage: draws scenes and animates effects
src/app/         catalog, player, client-side progress
scenes/          lesson files (*.scene)
mcp/server.ts    authoring MCP server
```

## Roadmap

- Packs: `linux` (terminal + virtual filesystem), `docker` (layers, containers, ports), `k8s` (reconciler loop), `code` (stack/heap traces), `robo` (sense→think→act)
- MCP `preview` tool that returns a PNG snapshot of a step
- `solution` blocks so `simulate` can prove every challenge is solvable
- Service worker for offline use; i18n string files (Hindi, Odia, …)
