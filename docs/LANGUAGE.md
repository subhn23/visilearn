# visilearn scene language

A scene is a small text file (`scenes/<pack>/<name>.scene`) that the engine turns into an
animated, interactive SVG lesson. The language is designed to be **cheap for an AI to write and
easy for a human to review**:

| Principle | Why |
|---|---|
| No coordinates; layout is automatic | Coordinates are most of the tokens in hand-made diagrams |
| Line-based, no JSON/YAML | Fewer tokens, fewer syntax mistakes |
| Domain words carry meaning (`fw`, `server`, `send`) | The author says *what*, the engine decides *how it looks/moves* |
| Defaults everywhere | Only state what is different |
| Strict grammar + terse errors with suggestions | An AI fixes `L7: unknown action 'sendd' (did you mean 'send'?)` in one shot |
| Built-in simulators | `goal`s and packet outcomes are computed, never hand-asserted |

## Core syntax

```
scene net.firewall "Firewalls: who gets in?"   # line 1: id (pack.name) + title
about "One-sentence summary for the catalog"
use net                                         # language pack(s)

<kind> <id>[, <id>...] [subvalue] [key=value ...]
link a b c                                      # chain a–b–c; repeat lines for branches

step "Text the learner reads"
  say "An extra paragraph"
  hint "Revealed on demand"
  highlight a, b
  note <id> "Callout above the entity"
  wait 500ms
  ask "Question?" opt1|opt2|opt3 answer=opt2    # or: ask "Q?" "Long A" "Long B" answer=2
  goal <condition>[, <condition>...]
  <pack actions>
```

- Indentation makes a line a child of the line above it. `#` starts a comment.
- Use `"double quotes"` for text with spaces. `key="value with spaces"` works too.
- Common entity props: `label="..."` (display name), `info="..."` (shown when clicked), `col=N` (force a layout column).

### How steps run

1. Entering a step fast-forwards the state through all earlier steps without animation, so a device killed in step 2 is still down in step 3.
2. The step's lines then run in order, with animation.
3. An `ask` pauses until the learner answers correctly. Put the `ask` *before* the action to get predict → observe.
4. A `goal` adds a live checklist item. It is rechecked whenever the learner changes something.
5. A step is complete when its actions have finished, every `ask` is answered and every `goal` is met. Progress is saved on the device.

## Pack: `net`

| Kind | Tier (left → right) | Subvalue | Props |
|---|---|---|---|
| `internet`, `user`, `host` | 0 | ip | `port` (host) |
| `router` | 1 | ip | |
| `fw` | 2 | ip | |
| `switch` | 3 | | |
| `server` | 4 | ip | `port=80,443` (listening ports) |

```
rules <fw> [editable] [policy=deny|allow]      # first match wins; no match → policy
  allow tcp:22 from laptop to web
  allow icmp
  deny udp:53
  deny any
```

Actions:

```
A send B:PORT [xN] [proto=udp]   # ok · blocked (at a firewall) · refused (port closed) · unreachable
A ping B [xN]
kill A[, B]                      # device fails; links go dead
revive A[, B]
```

Goals: `A->B:PORT ok|blocked|refused|unreachable`, `A->B ping ok`.

When a firewall has `editable` rules, the learner gets a **live rule editor** and a **packet lab**.

## Pack: `linux`

The whole filesystem is declared as **one indented tree**: folders end with `/`, and each node
becomes an entity whose id is its absolute path (`/home/asha/notes.txt`).

```
fs as=asha [cwd=/path] [show=perms]      # one per scene
  home/
    asha/
      notes.txt "one line of content"
      deploy.sh mode=644                 # mode=755, owner=root
        | echo Deploying                 # multi-line content
        | echo Done
  etc/
    hosts "127.0.0.1 localhost"
  tmp/
```

- Owners: anything under `/home/<as>` belongs to that user; everything else belongs to root.
- Default modes: folders 755, files 644, `/tmp` 777. `show=perms` prints the mode under each node.
- The tree is drawn with a tidy, crossing-free layout. The current directory carries a **you are here** badge.

Actions and goals:

```
run "ls -l"                 # typed into the terminal, then executed (scripted)
highlight /etc/hosts        # paths are entity ids
goal cwd /etc
goal exists /tmp/b.txt      goal missing /home/asha/notes.txt
goal mode /home/asha/deploy.sh 755
goal ran cat                # the learner ran it (scripted runs don't count)
goal output "localhost"     # the learner's latest output contains the text
goal contains /tmp/b.txt "milk"
```

Supported commands: `pwd ls [-l -a] cd cat echo touch mkdir [-p] rm [-r] mv cp [-r] chmod
grep [-v -c -i] wc -l head -n whoami sudo help clear`, plus `./script.sh`, pipes `|` and
`>` / `>>` redirects. Permissions are enforced: no `x` bit means `Permission denied`, and only the
owner or root may change a file. The learner's terminal has history (↑ ↓) and Tab completion.

## Adding a pack

A pack is a DOM-free `PackDef` (`src/packs/<name>/index.ts`) plus an optional DOM side panel
(`src/packs/<name>/ui.ts`, registered in `src/app/panels.ts`). It declares:

- `entities`: kinds, layout tier, about-text, allowed props
- `directives`: top-level blocks like `rules`
- `verbs`: step actions; each compiles to `{ run(rt) }` and uses `rt.fx` for visuals (`travel`, `flash`, `note`, `setDown`, `log`, and for graphs that change at runtime `addNode`, `removeNode`, `badge`, `setSub`)
- `parseGoal`: goal syntax and a `check(rt)` against the simulator
- `icons`: 48×48 SVG per kind
- `present` / `describe` (optional): draw the starting state (e.g. the cwd badge) and supply inspector details
- packs can generate entities from a directive with `c.addEntity` / `c.addLink` (the `fs` tree does this)
- `vocab`: the compact cheat-sheet the MCP server sends to AI authors (keep it under ~400 tokens)

Because visuals go through the `Effects` interface, every pack automatically works headless,
so `simulate`, tests and the MCP server all come for free.
