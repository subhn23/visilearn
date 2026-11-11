# visilearn Modules: Format Specification

Module format version: 2
Status: normative. `tests/modules.format.test.ts` checks that every field below is documented.

A **module** is a portable bundle of lessons. It can be saved on the device ("My modules"),
exported as a file, shared as a link, imported by anyone, and later published to a marketplace.
A module contains **only lesson text** in the scene language ([GRAMMAR.md](GRAMMAR.md)): no
HTML and no scripts. Every lesson is checked by the same compiler as built-in lessons, which is
what makes modules from strangers safe to open.

## File

- Extension: `.visilearn.json` (UTF-8 JSON). MIME type: `application/json`.
- Maximum size: 256 KB. Maximum 50 lessons.

```json
{
  "format": "visilearn.module",
  "version": 2,
  "id": "git-basics-k3x9qa",
  "title": "Git basics",
  "description": "Commits, branches and merges, step by step.",
  "author": "Asha",
  "track": "concept",
  "tags": ["git", "beginner"],
  "sources": [{ "title": "Git Notes for Professionals", "pages": "pp. 11-25", "license": "CC BY-SA" }],
  "created": "2026-11-11T10:00:00.000Z",
  "updated": "2026-11-11T10:00:00.000Z",
  "scenes": [{ "source": "scene git.commits \"Commits\"\nuse git\n…" }],
  "packs": [{ "source": "pack git \"Git basics\"\nkind commit icon=circle\n…" }]
}
```

## Fields

| Field | Type | Required | Rules |
|---|---|---|---|
| `format` | string | yes | Always `"visilearn.module"`. |
| `version` | number | yes | Format version. A file with a higher version than the app supports is rejected with "needs a newer version of visilearn". |
| `id` | string | yes | 3–64 chars, `[a-z0-9][a-z0-9-]*`. Generated as `<slug-of-title>-<6 random chars>`. Identifies the module across devices: importing a module with an existing id replaces the local copy (progress is kept). |
| `title` | string | yes | Non-empty, ≤ 120 chars. |
| `description` | string | no | Plain text. |
| `author` | string | no | Plain text display name. |
| `track` | string | no | Suggested track (`net`, `linux`, …), used for grouping. |
| `tags` | string[] | no | ≤ 12 tags. Non-strings are dropped. |
| `sources` | object[] | no | Where the content came from: `{ title, pages?, url?, license? }`. Shown to learners and reviewers. Generated modules must record their sources. |
| `created` | string | no | ISO 8601 timestamp. |
| `updated` | string | no | ISO 8601 timestamp. |
| `packs` | object[] | no | **Version 2.** 0–10 data packs, each `{ "source": "<pack definition text>" }` ([GRAMMAR.md §6](GRAMMAR.md)). They are compiled first, and the module's lessons then compile against the built-in packs plus these. Names must not clash with built-in packs or with each other. Packs are data only (kinds, icons, props, macros) and are never executed as code. A module that carries packs is written as `version: 2`. |
| `scenes` | object[] | yes | 1–50 lessons, each `{ "source": "<scene language text>" }`. Every source must compile without errors, and lesson ids (`scene <id>`) must be unique within the module. |

Unknown fields are **ignored and dropped** on import, so they never reach storage or the UI.
Device-only fields (`added`, `saved`) are added when a module is stored locally and are
**never exported**.

## Lesson keys

Inside the app, a module lesson is addressed as `m:<moduleId>/<sceneId>`
(e.g. `m:git-basics-k3x9qa/concept.commits`). That keeps module lessons from colliding with
built-in lessons or with each other. Progress is stored under the same key, and the player opens
it at `#/s/m:<moduleId>/<sceneId>`.

## Share links

```
https://<app>/#/import/<payload>
payload = base64url( deflate-raw( UTF-8 JSON of the module ) )
```

- The payload lives in the **URL fragment**, which browsers never send to a server, so sharing works with static hosting and no backend.
- Links longer than 12,000 characters are considered unreliable (chat apps truncate them). The app then asks the user to share the file instead.
- A payload that fails to decode (bad characters, truncated, corrupt) is reported as "This link is damaged or incomplete."
- A decoded module goes through exactly the same validation as an imported file.

## Import rules

1. Parse JSON. If that fails, the file is "not a valid module file".
2. Check the envelope (`format`, `version`, size, `id`, `title`, lesson and pack counts).
3. Compile every pack (`Pack <n> (<name>): L<line> <message>`), then build the module's registry: built-ins plus its packs.
4. Compile every lesson against that registry. Errors are reported as `Lesson <n> (<scene id>): L<line> <message>`, and warnings are shown but don't block.
5. Show the review screen, listing the packs the module adds. The user chooses **Add to My modules**; nothing is saved before that.

## Versioning

Additive changes that old readers can safely ignore keep the version number. Changes that old
readers would mis-handle (like `packs`, without which lessons would not compile) bump `version`,
so older apps say "needs a newer version" instead of failing confusingly. The app must keep reading every older version.

## Changelog

| Version | Change |
|---|---|
| 2 | Optional `packs`: modules can carry data packs (new topic vocabulary). Readers must still accept version 1. |
| 1 | Initial format: envelope, sources, lessons as scene-language text, share links. |
