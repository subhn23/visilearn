# visilearn Scene Language: Formal Grammar

Grammar version: 1.2
Status: normative. When this document and the implementation disagree, one of them is a bug.

This is the authoritative specification of the language the engine compiles into an interactive
pane. [LANGUAGE.md](LANGUAGE.md) is the friendly tutorial; this file is the contract that
authors, AI generators, validators and future tooling (syntax highlighters, constrained-decoding
grammars, JSON schemas) build on.

> **Maintenance rule.** Any change to `src/core/parser.ts`, `src/core/compile.ts` or a pack's
> `entities` / `directives` / `verbs` / `parseGoal` **must** update this file in the same commit,
> bump the version (minor for additions, major for breaking changes) and add a changelog entry.
> `tests/grammar.test.ts` fails if a keyword is missing here or if any `scene` example below
> stops compiling.

---

## 1. Notation

EBNF in the ISO 14977 style, with these conventions:

| Notation | Meaning |
|---|---|
| `'x'` | literal keyword or symbol |
| `A B` | A followed by B (tokens are separated by one or more spaces) |
| `A \| B` | A or B |
| `[ A ]` | optional |
| `{ A }` | zero or more |
| `A+` | one or more |
| `NEWLINE`, `INDENT>`, `DEDENT` | layout tokens, see §2.2 |
| `/regex/` | a token that must match the regular expression in full |
| *italic text* | a semantic constraint, checked by the compiler rather than the parser |

## 2. Lexical structure

### 2.1 Characters and lines

```text
source      = { line } ;
line        = { ' ' } [ statement-text ] [ comment ] NEWLINE ;
NEWLINE     = '\n' | '\r\n' ;
comment     = '#' { any-char } ;          (* only where a token could start, outside quotes *)
```

- Source is UTF-8 text. A tab character counts as **two spaces**.
- Blank lines and comment-only lines are ignored.
- `#` starts a comment **only at the beginning of a token**. `a#b` is the single token `a#b`.

### 2.2 Indentation (layout)

Indentation is the number of leading spaces. It builds a tree of statements:

- A line becomes a **child** of the nearest preceding line that has a *smaller* indentation.
- Siblings need not use the same indentation width, but using 2 spaces per level is the convention.
- Lines that are deeper than their parent but have no meaning as children produce a warning.

In this grammar `INDENT>` means "the following statements are children of the previous one"
and `DEDENT` means "back to the parent's level".

### 2.3 Tokens

```text
token        = bare-token | quoted-token | kv-token ;
bare-token   = bare-char+ ;                                   (* no spaces, does not start with '"' *)
quoted-token = '"' { string-char } '"' ;                      (* q = true *)
kv-token     = key '=' value ;                                (* only when NOT starting with '"' *)
key          = /[A-Za-z_][\w.-]*/ ;
value        = { bare-char | '"' { string-char } '"' } ;      (* label="My laptop" → My laptop *)
string-char  = any-char - '"' | '\' any-char ;                (* backslash escapes the next char *)
```

- Tokens are separated by spaces outside quotes.
- Quotes may appear inside a token: `label="Admin laptop"` is one token whose value is `label=Admin laptop`.
- A token that **starts** with `"` is *quoted*. Quoted tokens are never key/value pairs, so `"a=b"` is positional text.
- An unclosed `"` is an error: `unclosed quote`.
- Escape: inside quotes, `\x` yields `x` literally (so `\"` is a quote character). There are no escape sequences such as `\n`. For multi-line content use the constructs a pack provides (e.g. `|` lines in `fs`).

### 2.4 Statements

```text
statement     = head { argument } ;
head          = token ;                       (* the first token's value *)
argument      = positional | kv-token ;
positional    = bare-token | quoted-token ;
text          = positional+ ;                 (* joined with single spaces *)
```

### 2.5 Shared terminals

```text
scene-id   = /[a-z][\w-]*(\.[\w-]+)*/ ;       (* e.g. net.firewall; first segment = pack by convention *)
id         = /[A-Za-z][\w-]*/ ;               (* declared entity ids *)
path-id    = '/' | /(\/[^\/\s]+)+/ ;          (* generated entity ids (linux pack) *)
ref        = id | path-id ;                   (* any entity reference *)
id-list    = ref { ',' ref } ;                (* commas may be attached: "a, b" or "a,b" *)
integer    = /\d+/ ;
port       = integer ;                        (* 1..65535 *)
octal-mode = /[0-7]{3}/ ;                     (* e.g. 644 *)
duration   = /\d+(\.\d+)?(ms|s)?/ ;           (* no unit = milliseconds *)
```

## 3. Document structure

```text
scene-file   = scene-header { top-statement } ;

scene-header = 'scene' scene-id quoted-token NEWLINE ;      (* must be the first statement *)

top-statement = use-stmt
              | about-stmt
              | entity-decl
              | link-stmt
              | directive
              | step-block ;

use-stmt     = 'use' pack-name { [','] pack-name } ;
pack-name    = 'net' | 'linux' ;
about-stmt   = 'about' text ;
link-stmt    = 'link' ref ref { ref } ;                     (* chain: a–b, b–c, … *)
step-block   = 'step' text NEWLINE INDENT> { step-line NEWLINE } DEDENT ;
```

Semantic constraints:

1. Exactly one `scene` statement, and it is the first statement of the file.
2. At least one `use`. Every pack name must exist. Several `use` lines are allowed.
3. At least one `step`. A step needs non-empty text.
4. Statements other than `scene` may appear in **any order**. The compiler resolves them in passes: (1) entity declarations, (2) `link`s and pack directives, (3) steps. Steps run in file order.
5. In `link`, ids may also be separated by `,` or `--` (e.g. `link a--b`). A hyphen inside an id is part of the id.
6. When a scene has links, any entity left unlinked produces a warning.
7. Any other head at top level is an error, reported with a "did you mean" suggestion. Step actions written at top level are reported as `'x' is an action; put it inside a step`.

### 3.1 Entity declarations

```text
entity-decl  = kind id-list [ sub-value ] { kv-token } ;
kind         = (* an entity kind of a used pack; see §5 *) ;
sub-value    = positional ;                   (* only for kinds that define one, e.g. an IP *)
common-kv    = 'label=' value | 'info=' value | 'col=' integer ;
```

- `label`: display name (default: the id). Ignored when several ids are declared on one line.
- `info`: text shown in the inspector instead of the kind's default description.
- `col`: forces a layout column (1-based) in the general layout.
- Ids must be unique across the scene and match `id`.
- Unknown props produce a warning listing the allowed ones. Extra positional values produce a warning.
- Kinds marked *generated* (see §5.2) cannot be declared directly.

## 4. Steps

```text
step-line    = say | hint | highlight | note | wait | ask | goal | button | pack-action ;

say          = 'say' text ;                               (* extra paragraph under the step text *)
hint         = 'hint' text ;                              (* revealed on demand *)
highlight    = 'highlight' id-list ;
note         = 'note' ref text ;                          (* callout above the entity *)
wait         = 'wait' duration ;
ask          = 'ask' quoted-token options 'answer=' answer ;
options      = bare-token-with-pipes | positional positional { positional } ;
bare-token-with-pipes = /[^\s|]+(\|[^\s|]+)+/ ;          (* 21|22|80 *)
answer       = (* the exact text of one option, or its 1-based number *) ;
goal         = 'goal' condition { ',' condition } ;
button       = 'button' quoted-token action-line ;              (* learner-triggered action *)
action-line  = highlight | note | wait | pack-action ;
condition    = (* pack-defined; see §5. Conditions cannot contain ',' *) ;

pack-action  = verb { argument }
             | ref verb { argument } ;                    (* subject form: "laptop send web:80" *)
```

Semantics:

- The lines of a step run **in order**. `say`, `hint` and `goal` are not actions: they configure the step panel.
- `highlight`, `note` and every other decoration last only for the step.
- `ask` **pauses** the step until the learner picks the correct option. An ask placed before an action gives the predict → observe pattern. An ask needs at least 2 options, and `answer` must resolve to one of them.
- `goal` adds items to a live checklist that is re-evaluated whenever state changes. A step is **complete** when its actions have finished, every ask has been answered and every goal is met.
- `button` adds a button to the step panel. Pressing it runs its action (any action line) on the live scene, after which goals are re-checked. Buttons don't run during scripted playback, so they are the "learn by doing" control for any pack.
- Verbs declared with a subject (e.g. `send`) accept both `A send …` and `send A …`.
- Entering step *n* replays steps 1…n-1 instantly (no animation, asks skipped), so state such as failed devices or created files carries forward.

## 5. Packs

A pack contributes entity kinds, directives (top-level blocks), verbs (step actions) and goal
conditions. Their grammar is part of this specification.

### Pack `net`

Computer networking: packets, firewalls, routing.

#### Entity kinds

| Kind | Layout tier | Sub-value | Extra props |
|---|---|---|---|
| `internet` | 0 | ip | none |
| `user` | 0 | none | none |
| `host` | 0 | ip | `port=` |
| `router` | 1 | ip | none |
| `fw` | 2 | ip | none |
| `switch` | 3 | none | none |
| `server` | 4 | ip | `port=` |

```text
port-list    = port { ',' port } ;                (* port=80,443: ports the device listens on *)
```

#### Directive `rules`

```text
rules-block  = 'rules' ref [ 'editable' ] [ 'policy=' policy ] NEWLINE INDENT> { rule NEWLINE } DEDENT ;
policy       = 'allow' | 'deny' ;                 (* default: deny *)
rule         = action [ match ] { endpoint } ;
action       = 'allow' | 'deny' ;
match        = proto [ ':' ( port | 'any' ) ] ;   (* default: any *)
proto        = 'tcp' | 'udp' | 'icmp' | 'any' ;
endpoint     = ( 'from' | 'to' ) ( ref | 'any' ) ;
```

- `icmp` takes no port. Ports are in the range 1–65535. `from` and `to` may appear in either order.
- Evaluation is done by every firewall on a packet's path: rules are checked **top to bottom** and the **first match wins**. If nothing matches, the `policy` applies. A firewall without a `rules` block allows everything.
- Replies to allowed traffic always pass (the firewall is stateful).
- `editable` gives the learner a live rule editor and a packet lab.
- A rules block on a non-`fw` entity produces a warning.

#### Verbs

```text
send-action   = ref 'send' target [ repeat ] [ 'proto=' ( 'tcp' | 'udp' ) ] ;
ping-action   = ref 'ping' ref [ repeat ] ;
kill-action   = 'kill' id-list ;                   (* device fails; links go dead *)
revive-action = 'revive' id-list ;
target        = ref ':' port ;                      (* send requires a port *)
repeat        = /x\d+/ ;                            (* x3; capped at 10 *)
```

Outcome of a packet: `ok` (delivered, reply returns), `blocked` (dropped at a firewall),
`refused` (nothing listens on the port) or `unreachable` (no path, or an endpoint is down).
Paths are the shortest route that avoids failed devices.

#### Goal conditions

```text
net-condition = ref ( '->' | '→' ) ref ( ':' port [ '/' ( 'tcp' | 'udp' ) ] | 'ping' ) outcome ;
outcome       = 'ok' | 'blocked' | 'refused' | 'unreachable' ;
```

Example (`goal laptop->web:22 ok, ext->web:22 blocked`) and a complete scene:

```scene
scene net.grammar-demo "Firewall basics"
about "First match wins."
use net

host laptop 198.51.100.7 label="Admin laptop"
internet ext label="Internet"
fw edge
server web 203.0.113.10 port=80,22

link laptop edge web
link ext edge

rules edge editable policy=deny
  allow tcp:80 to web

step "Port 80 is open"
  laptop send web:80
  ext send web:80 x2

step "SSH is not"
  ask "What happens to SSH?" "Delivered" "Dropped by edge" answer=2
  laptop send web:22
  note edge "no rule matched"

step "Your turn"
  hint "allow tcp:22 from laptop to web"
  goal laptop->web:22 ok, ext->web:22 blocked
```

### Pack `linux`

The Linux command line: a filesystem tree, a terminal, permissions.

#### Entity kinds (generated)

| Kind | Layout tier | Generated by |
|---|---|---|
| `dir` | 0 | `fs` |
| `file` | 1 | `fs` |

Ids are **absolute paths** (`/`, `/home/asha`, `/home/asha/notes.txt`). Labels are the base
name, with a trailing `/` for directories. With `show=perms`, the sub-label is the mode string
(`-rw-r--r--`). Declaring `dir` or `file` directly is an error.

#### Directive `fs`

```text
fs-block     = 'fs' { fs-option } NEWLINE INDENT> { fs-node NEWLINE } DEDENT ;
fs-option    = 'as=' user | 'cwd=' path-id | 'show=perms' ;
user         = /[a-z_][a-z0-9_-]*/ ;                       (* default: learner *)
fs-node      = dir-node | file-node ;
dir-node     = name '/' { node-kv } NEWLINE [ INDENT> { fs-node NEWLINE } DEDENT ] ;
file-node    = name [ text ] { node-kv } NEWLINE [ INDENT> { content-line NEWLINE } DEDENT ] ;
content-line = '|' [ text ] ;                               (* one line of file content *)
node-kv      = 'mode=' octal-mode | 'owner=' user ;
name         = /[^\/\s]+/ - ( '.' | '..' ) ;
```

- At most one `fs` block per scene. It takes options only.
- A file's content is its inline `text` (one line) followed by its `|` lines. Note that quotes inside content lines are consumed by the tokenizer.
- Only directories may have child nodes. Content lines are only allowed under files.
- **Owners:** paths under `/home/<as>` belong to that user; everything else belongs to root (unless `owner=` is given).
- **Default modes:** directories 755, files 644, `/tmp` 777.
- **Starting directory:** `cwd=` if given (it must name a directory), otherwise `/home/<as>` if it exists, otherwise `/`.

#### Verbs

```text
run-action   = 'run' text ;                                 (* quotes optional: run "ls -l" | run pwd *)
```

The command is typed into the terminal and executed by the simulated shell. In every pipe
segment, the command word (after an optional `sudo`) must be a known command or a path
(`./x`, `/x`, `~/x`).

Shell language accepted by `run` and by the learner's terminal:

```text
command-line = pipeline [ redirect ] ;
pipeline     = command { '|' command } ;
redirect     = ( '>' | '>>' ) word ;                        (* applies to the last command *)
command      = [ 'sudo' ] ( builtin | script ) { word } ;
script       = /(\.\/|\/|~\/)\S+/ ;                         (* needs r and x permission *)
builtin      = 'pwd' | 'ls' | 'cd' | 'cat' | 'echo' | 'touch' | 'mkdir' | 'rm' | 'mv' | 'cp'
             | 'chmod' | 'grep' | 'wc' | 'head' | 'whoami' | 'help' | 'clear' ;
word         = bare-word | '"' { any-char - '"' } '"' | "'" { any-char - "'" } "'" ;
chmod-mode   = octal-mode | clause { ',' clause } ;
clause       = /[ugoa]*/ ( '+' | '-' | '=' ) /[rwx]+/ ;
```

Supported flags: `ls -l -a`, `mkdir -p`, `rm -r`, `cp -r`, `grep -v -c -i`, `wc -l`, `head -n N`.
Permissions are enforced: reading needs `r`, creating or removing needs `w` on the parent
directory, `cd` needs `x`, and only the owner or root may `chmod`.

#### Goal conditions

```text
linux-condition = 'cwd' path-id
                | 'exists' path-id
                | 'missing' path-id
                | 'mode' path-id octal-mode
                | 'ran' text                 (* the learner ran a command starting with text *)
                | 'output' text              (* the learner's latest output contains text *)
                | 'contains' path-id text ;  (* file content contains text *)
```

`ran` and `output` only count commands the **learner** typed; scripted `run` lines do not count.

```scene
scene linux.grammar-demo "Finding your way"
use linux

fs as=asha show=perms
  home/
    asha/
      notes.txt "buy milk"
      deploy.sh mode=644
        | echo Deploying
        | echo Done
  etc/
    hosts "127.0.0.1 localhost"
  tmp/

step "Where am I?"
  run pwd
  highlight /home/asha
  note /home/asha "your home"

step "Look and move"
  ask "What does ls show?" "Everything" "This folder" answer=2
  run "ls -l"
  run "cd /etc"

step "Your turn"
  goal cwd /etc, ran cat, output "localhost", mode /home/asha/deploy.sh 755
```

### Pack `concept`

Generic building blocks for any subject. It is also the **base of every data pack** (§6): data
packs add their own kinds and macros, and the building blocks and goals below are available in
all of them. Packs of this family share **one graph state**, so `use git, concept` works on a
single graph.

#### Entity kinds

| Kind | Tier | Icon | Meaning |
|---|---|---|---|
| `actor` | 0 | person | someone or something that acts |
| `box` | 1 | box | a component or thing |
| `process` | 1 | gear | a step that does work |
| `idea` | 1 | circle | a concept or state |
| `doc` | 2 | file | a document, message or data item |
| `store` | 3 | database | where data is kept |

Any `key=value` prop is accepted on these kinds and becomes graph state (readable by goals).

#### Building blocks (verbs)

```text
add-action        = 'add' kind id [ 'to' ref ] { kv-token } ;  (* creates a hidden entity, shown when it runs *)
remove-action     = 'remove' id-list ;
connect-action    = 'connect' ref ref ;
disconnect-action = 'disconnect' ref ref ;
point-action      = 'point' ref ref ;          (* drop A's outgoing links, then link A → B (pointers, labels) *)
set-action        = 'set' ref kv-token { kv-token } ;
flow-action       = 'flow' ref ref { ref } [ 'label=' value ] [ 'tone=' tone ] ;
mark-action       = 'mark' ref text ;          (* persistent badge *)
unmark-action     = 'unmark' ref ;
flash-action      = 'flash' ref [ tone ] ;
tone              = 'ok' | 'bad' | 'warn' | 'info' ;
```

- An `add` registers its id when the lesson compiles, so later lines can refer to it. An id must be added before it is referenced, and ids are unique.
- When a kind declares `show=PROP`, `set ID PROP=…` updates the node's sub-label.

#### Goal conditions

```text
concept-condition = ref '.' prop ( '=' | '!=' ) text
                  | 'exists' ref | 'missing' ref
                  | 'linked' ref ref                       (* either direction *)
                  | 'count' kind ( '=' | '>=' | '<=' ) integer ;
```

```scene
scene concept.grammar-demo "Requests and caches"
use concept

actor user label="You"
process app label="Web app"
store cache label="Cache"
store db label="Database"
link user app
link app cache
link app db

step "First request misses the cache"
  flow user app db label="query"
  set cache status=empty

step "Your turn"
  button "Warm the cache" set cache status=warm
  goal cache.status = warm
```

## 6. Pack definition language (data packs)

A **data pack** adds vocabulary without code. Modules carry data packs, the Studio's model
writes them, and the marketplace distributes them. A data pack is pure data: kinds (name, icon,
colour, props) and **macros** composed from the concept building blocks. The engine never runs
code from a pack.

```text
pack-file   = 'pack' pack-name quoted-token NEWLINE { pack-stmt NEWLINE } ;
pack-name   = /[a-z][a-z0-9-]{1,31}/ ;                  (* must not be a built-in pack name *)
pack-stmt   = about-stmt | kind-def | macro-def ;
kind-def    = 'kind' kind-name { kind-opt } NEWLINE [ INDENT> { prop-def NEWLINE } DEDENT ] ;
kind-name   = /[a-z][a-z0-9-]*/ ;                       (* not a building-block or core keyword *)
kind-opt    = 'icon=' icon | 'swatch=' swatch | 'tier=' /[0-9]/ | 'show=' prop | 'role=label' | 'about=' value ;
icon        = library-icon | '"path:' svg-path '"' ;
library-icon= 'box' | 'circle' | 'diamond' | 'database' | 'table' | 'person' | 'people' | 'server'
            | 'file' | 'folder' | 'gear' | 'cloud' | 'lock' | 'key' | 'tag' | 'flag' | 'star'
            | 'bolt' | 'clock' | 'chat' | 'globe' | 'book' | 'cpu' | 'list' | 'check'
            | 'question' | 'branch' | 'layers' | 'arrow' ;
svg-path    = /[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,2000}/ ; (* commands and numbers only: no markup *)
swatch      = 'mustard' | 'mint' | 'lilac' | 'peach' | 'sky' | 'rose' ;
prop-def    = 'prop' prop [ text ] ;
macro-def   = 'macro' macro-name { PARAM } NEWLINE INDENT> { macro-line NEWLINE } DEDENT ;
PARAM       = /[A-Z][A-Z0-9_]*/ ;
macro-line  = ( building-block | 'highlight' | 'note' | 'wait' | macro-name ) { argument } ;
```

Semantics:

- `role=label` marks pointer-like kinds (branches, HEAD, tags). They are drawn in the column of what they point at, so `HEAD → main → c3` stacks over `c3`.
- Icons are chosen from the built-in library, or given as a validated path. Raw SVG is never accepted.
- Macro bodies may use only the building blocks, `highlight`, `note`, `wait` and other macros of the same pack. Every UPPERCASE word in a body must be one of the macro's parameters.
- Macro lines are shape-checked when the pack compiles: `add` needs a kind (or a parameter) and an id before `to`; `connect`, `disconnect`, `point` and `flow` take ids only (no `to`); `set` needs `prop=value`. Errors raised while a lesson expands a macro are prefixed `in macro <name>:`.
- A lesson calls a macro like any verb (`commit c2 c1 main`). Arguments replace the parameters, and the expanded lines are compiled as if written at the call site, so errors point at the lesson line.
- Macros may call macros (nesting depth ≤ 8). A macro named like a building block, or like `ask`, `goal`, `say`, `hint` or `button`, is an error.
- A lesson uses a data pack with `use <name>`. Its registry is the built-in packs plus the data packs of the module it belongs to.

```pack
pack git "Git basics"
about "Commits, branches and merges."
kind commit icon=circle swatch=mustard show=message about="A saved snapshot of the project."
  prop message "what changed"
kind branch icon=tag swatch=mint tier=0 role=label about="A movable label that points at a commit."
macro commit ID PARENT BRANCH
  add commit ID to PARENT
  point BRANCH ID
  flash ID ok
macro branch NAME AT
  add branch NAME
  point NAME AT
```

## 7. Name resolution and diagnostics

- **Entity references** (`ref`) must name a declared or generated entity. An unknown reference is an error carrying a suggestion, e.g. `unknown entity '/etc/hostz' (did you mean '/etc/hosts'?)`.
- **Keywords** are case-sensitive and lower-case.
- **Severity:** *errors* make the scene invalid (it is not rendered; the catalog lists it under "Scenes with errors"). *Warnings* are reported but the scene still runs.
- Diagnostics have the form `L<line> <severity>: <message>` and are sorted by line. They are deliberately short and actionable so an author or AI can fix them in one pass.

## 8. A minimal valid scene

```scene
scene net.minimal "Minimal"
use net
host a
server b port=80
link a b
step "Hello"
  a send b:80
```

## 9. Changelog

| Version | Change |
|---|---|
| 1.2 | Core step line `button`. Hidden entities (created by actions). Pack `concept` (building blocks, graph goals). §6 pack definition language for data packs (kinds, icons, props, macros); the pack registry is per module. |
| 1.1 | Pack `linux`: `fs` directive (tree, `|` content lines, `mode=`, `owner=`), generated kinds `dir`/`file` with path ids, `run` verb, goals `cwd exists missing mode ran output contains`. Packs may generate entities. |
| 1.0 | Core language: `scene use about link step`, step lines `say hint highlight note wait ask goal`, pack `net` (`rules`, `send ping kill revive`, reachability goals). |
