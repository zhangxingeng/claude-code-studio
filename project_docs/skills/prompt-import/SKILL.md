---
name: prompt-import
description: "Use when asked to import, migrate, or translate hand-written prompts (markdown, text, a docs folder, a pasted blob) into the ccdeck Prompt Library — turns them into schema-compliant snippet JSON in ~/.ccdeck/prompts/, with a validator to prove compliance."
---

# prompt-import

Translate hand-written prompts into ccdeck snippet JSON. The library is the user's own —
you write **directly into `~/.ccdeck/prompts/`** (they know what they're doing), which makes the
plan step and the validator the only things standing between a sloppy read and a polluted library.
Take both seriously.

The engineering contract is `project_docs/prompts-design.md` (schema, storage, grammar); the
interaction contract is `project_docs/prompts-ux.md`. Read them if anything here is ambiguous —
they win over this file.

## The one structural fact that shapes every import

**Snippets do not reference or include each other on disk.** There is no `includes` field. A
snippet is a flat, self-contained body. "Modular and DRY" therefore means: cut the source into
small chunks that each stand alone and get *pasted together* in ccdeck's compose box at use time,
with shared variables (`{ticket}`) instead of hardcoded specifics. It does **not** mean a snippet
that pulls in another snippet — you cannot express that, and inventing a convention for it is a
contract change, not an import decision.

## Procedure

### 1. Read the sources, then ask what you cannot know

Read every file you were pointed at, fully, before asking anything — most questions answer
themselves on the page. Then ask the user (`AskUserQuestion`, batched into one round) about the
forks the text genuinely cannot settle. **Never assume any of these:**

- **Which project?** Global, or scoped to a project? If a project, which one — read
  `~/.ccdeck/projects.json` and offer the existing projects by name. If the right project does not
  exist, ask whether to create it; **only on an explicit yes** may you append to `projects.json`
  (`{id: uuid4, name, color: <one of red orange yellow green teal blue purple pink graphite>,
  pinned: false, path: null, created_at: <unix seconds>}`, inside the `{"projects": [...]}`
  wrapper — never a bare array). Never invent a project silently.
- **How should these prompts be managed?** Do not pick a split style for the user. Ask, with a
  free-text option so they can describe what they want in their own words: one snippet per source
  file, or broken into small reusable chunks, or repeated preamble factored into one shared
  snippet — and how aggressively hardcoded specifics should become variables. Their answer governs
  the plan.
- **Anything else the text leaves open** — naming, tags/category, whether stale prompts should be
  dropped rather than imported. Ask; don't guess and don't quietly fix.

### 2. Propose the plan in plain words, then STOP

Show a short table — one row per snippet you intend to write — and wait for approval. No files
before this is approved.

| title | what it does | from | variables | notes |
|-|-|-|-|-|
| senior-reviewer | review persona for PRs | review.md | `{ticket}` | preamble factored out into `house-style` |

Say explicitly what you're dropping, merging, or rewording. If two sources share text, say which
snippet now owns it and that both will paste it. The user must be able to see the whole shape of
their new library from this table alone.

### 3. Write the JSON

One file per snippet at `~/.ccdeck/prompts/<id>.json` (`$CCDECK_DATA_DIR` overrides `~/.ccdeck` if
set). Pretty-printed, trailing newline — this is a hand-editing surface. Field order as below.

```json
{
  "id": "3f2a1c4e-9b7d-4a11-8c2e-5d6f7a8b9c01",
  "title": "senior-reviewer",
  "body": "You are a senior reviewer. Review the PR for {ticket:ABC-123}…",
  "keywords": ["review", "role"],
  "tags": [],
  "category": null,
  "scope": { "kind": "global" },
  "placeholders": [{ "name": "ticket", "default": "ABC-123" }],
  "created_at": 1770000000,
  "updated_at": 1770000000,
  "versions": []
}
```

- `id` — a fresh **UUID v4**, and the filename **must** be `<id>.json`.
- `created_at` / `updated_at` / `saved_at` — **unix seconds**, not milliseconds.
- `scope` — exactly `{"kind":"global"}` or `{"kind":"project","project_id":"<id from the roster>"}`.
  A `project_id` matching no roster entry makes the app silently load the snippet as global.
- `versions` — `[]` for a fresh import. It is edit history, not a place to stash source variants.
- `recovered` — **never author it.** The app sets it when it repairs a corrupt file.
- Never write your own extra top-level keys. Unknown keys survive round-trips, so a typo'd field
  name persists forever, looking official and doing nothing.

### 4. The variable grammar (get this exactly right)

Single-brace, python-f-string flavored. `placeholders` is **derived from the body** by the app at
save time, so your array must equal what the body implies, or the app overwrites it.

- `{name}` or `{name:default}`, where `name` is ASCII `[A-Za-z0-9_-]+` — case-sensitive, **no dots,
  no unicode**. `{a.b}` and `{tickét}` are prose, not variables.
- The **first** `:` splits name from default. `{x:a:b}` → default `a:b`. A default may **not**
  contain braces.
- `{{` and `}}` are escapes for literal braces. So `{{task}}` is literal text, not a variable.
- `{x:}` means "default is empty string"; `{x}` means "no default". They differ.
- One name = one variable document-wide, and the **first occurrence's default wins** — even when
  the first occurrence has none (`{x} {x:b}` → `x` with no default). Put the default on the first
  mention.
- A body containing JSON examples or shell braces is fine — malformed runs stay prose — but check
  the validator's derived list against what you meant, because a stray `{word}` inside prose
  becomes a real variable the user has to fill on every paste.

### 5. Validate — every file, every time

```bash
uv run --script project_docs/skills/prompt-import/validate_prompts.py ~/.ccdeck/prompts
```

It checks required fields and types, UUID/filename agreement, unix-second timestamps, scope shape
and that `project_id` exists in the roster, duplicate ids across files, and — the one that catches
real drift — that `placeholders` matches exactly what the body's grammar derives (it ports the
Rust `derive_placeholders` byte for byte). Fix everything it flags and re-run until clean. A green
run is part of the report; do not tell the user you're done without it.

### 6. Report

What you wrote, where, any source content you deliberately dropped, and the validator result.
Suggest they open ccdeck and eyeball a couple of snippets — a schema-valid snippet can still be a
badly-cut one, and only they can judge that.
