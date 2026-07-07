# Prompt Library — Product Design & Feature Spec

Status: **DESIGN — not built.** This is a product-design doc: it defines *what the feature is* and
*what using it feels like*, not how it's wired into the Tauri/Svelte stack. Engineering breakdown
(commands, storage paths, components) comes in a later pass. Decisions here were aligned with the
founder on 2026-07-06.

Home: a new top-level view inside Deck, alongside **Browse**, **Search**, **Settings**. Working name
**Prompts** (final name TBD).

---

## Why this exists

Deck's mission is to make Claude Code approachable — *simple by default, advanced on demand.* Writing
good prompts is the other half of that problem: everyone rebuilds the same scaffolding ("you are a
senior reviewer…", "be terse", "focus on error handling") from scratch, every session, in every
project. There's no home for the prompt fragments you keep reusing.

The Prompt Library is that home. It's a **reusable prompt-piece collection with a compose surface**:
you keep a library of small, named prompt fragments ("pieces"), and you build a finished prompt by
typing freely in one box while the library fuzzy-matches what you're writing and lets you drop pieces
in with a click. Tweak, save the good ones back, copy the result, done.

Two properties make it worth building as its own thing rather than a per-project script:

- **It generalizes.** A piece can be **global** (available in every project) or **scoped to one
  project**. The library is not coupled to any single codebase.
- **It's modular.** You compose finished prompts out of small reusable parts instead of maintaining
  giant monolithic prompt templates.

Superseded idea: an earlier plan was a Trogon-style TUI that turned *this repo's* CLI into an
interactive picker. Killed — it was project-coupled, it built command invocations rather than prose,
and a terminal is a worse text-composition surface than the browser. This replaces it.

---

## Vocabulary

- **Piece** — an atomic, reusable prompt fragment. Has a body (markdown/plain text), a title,
  keywords, optional tags + one category, a scope, optional placeholders, and version history.
  Stored as one JSON object (see *Storage*).
- **Scope** — where a piece is available: **Global** (every project) or **Project** (one project).
- **Placeholder** — a `{{token}}` inside a piece body that gets filled in at insert time
  (e.g. `Review the PR for {{ticket}}`).
- **Compose box** — the single freeform text area where you build the finished prompt.
- **Linked span** — a run of text in the compose box that came from a piece (rendered colored, so
  you can always see what's from the library vs. what you typed).
- **Project** — a namespace/filter. Picking the active project decides which project-scoped pieces
  are in play; global pieces are always in play.

---

## The happy path (narrative)

1. You open **Prompts**, pick your active project (or "no project / global only").
2. You start typing in the compose box: *"review this PR and…"*.
3. As you type, a live panel shows fuzzy matches from the library — pieces whose title, keywords, or
   body match what you're writing. You see `senior-reviewer`, `be-terse`, `pr-review-checklist`.
4. You click `senior-reviewer`. Its text drops into the box **at your cursor**, rendered in the
   "from a piece" color. You keep typing plain text around it.
5. You click `pr-review-checklist`, which has placeholders. A tiny popover asks `ticket:` and
   `concern:`; you fill them, hit enter, and the filled text lands as a linked span.
6. You realize one inserted line needs a tweak *just this once*. You click the colored span → a
   **modal zooms in on that piece**. You edit the text and choose "just this prompt" — the change
   applies only to what's in the box.
7. A different span you actually want to improve *permanently*: you click it, switch the modal into
   **template mode** (the background color changes to signal "you're editing the reusable template
   now, not this prompt"), fix the wording, mark a word as a `{{placeholder}}`, and **Save → Global**.
   The library piece is updated and versioned.
8. Some plain text you typed turns out to be reusable. You select it in the box → **Save as piece** →
   the modal opens in template mode with your selection as the body; you name it, choose **This
   project**, save. Next time it shows up in search.
9. You hit **Copy prompt**. The whole box (linked spans flattened to plain text, placeholders
   substituted) goes to your clipboard. Paste it wherever you're prompting.

---

## Feature specs

### F1 — The compose surface

- One freeform, editable text area. **The finished prompt is literally whatever is in the box** —
  there is no hidden structure, no forced ordering. Fully flexible, like writing normally.
- Text carries a **visual provenance state**, so you always know where each part came from:
  - **Typed** — plain default color. You wrote it. Not stored anywhere until you choose to save it.
  - **Linked** — colored tint. Came from a piece, unchanged. Hovering shows the piece's name + scope.
  - **Linked-modified** — colored tint + a subtle marker (e.g. dotted underline). Came from a piece
    but you edited it inline in the box, so it has diverged from the stored piece.
- Editing inside the box is unrestricted — you can type into, split, or delete any span, linked or
  not. Editing a linked span in place turns it *linked-modified* (a one-off tweak); it does **not**
  touch the stored library piece unless you explicitly save it back via the modal.
- **Copy prompt** button: emits the box as clean plain text — linked coloring removed, any remaining
  placeholders substituted with their filled values. That's the deliverable.

```
┌─ compose ──────────────────────────────────┐   Legend
│ You are a senior reviewer.                  │   ░ plain (typed)
│ ▓Review the PR for JUROR-412, focus on      │   ▓ linked (from a piece)
│  error handling.▓                           │   ▓̣ linked-modified
│ ░Be terse and concrete.░                    │
└─────────────────────────────────────────────┘
                                [ Copy prompt ]
```

### F2 — Live fuzzy search & insertion

- As you type in the box, a side/adjacent panel shows the **top fuzzy matches** live.
- Match target: **title + keywords + body**, weighted so title/keyword hits rank above body hits
  (aligned decision — best recall; body hits catch pieces you never tagged well).
- Scope of the pool: all **global** pieces + all pieces scoped to the **active project**.
- **Click a match → insert at cursor** as a linked span. (Keyboard path — arrow to a match, Enter to
  insert — is a nice-to-have, matching Search's existing keyboard nav.)
- If the piece has placeholders, insertion first shows a compact **fill-in popover** (one field per
  token) before the span lands. Filled spans remember their template, so re-opening them can re-ask.

### F3 — The piece modal (zoom-in): two modes

Clicking any linked span opens a modal that "zooms in" on that piece. The modal has **two modes,
distinguished by background color**, because you are doing two genuinely different things:

- **Instance mode** (default background) — *"you are editing this prompt."*
  - Edit the text as it appears in *this* compose session only.
  - If the piece has placeholders, show them as fill-in fields here too (re-fill without re-inserting).
  - Actions: **Apply to this prompt** (updates the span in the box, one-off), **Cancel**.

- **Template mode** (shifted background — the color change is the whole signal that you left the
  prompt and are now editing the reusable definition) — *"you are editing the template."*
  - Edit the canonical body of the piece.
  - **Select text and mark it as a placeholder** — give the `{{token}}` a name; unmark to revert.
  - Edit metadata: title, keywords, tags, category, scope.
  - **Save** with a destination dropdown: **This project** / **Global**. Save updates the library
    piece and creates a new version (history preserved).
  - **Use current text as template body** — when you got here from an edited (linked-modified) span,
    one click makes the piece's body exactly the span's current text (straight replace, versioned;
    no merge).
  - Optional: **Save as new piece** (fork) instead of overwriting.

The background-color flip between the two modes is deliberate and load-bearing: it's how the user
knows whether their edits will affect just this prompt or the whole library going forward.

### F4 — New text → chunk (promote typed text to a piece)

- Select any plain typed text in the compose box → **Save as piece** (context action / button).
- Opens the piece modal **directly in template mode** (background already shifted) with the selection
  pre-loaded as the body.
- You name it, optionally mark placeholders, set tags/category, and choose **This project / Global**.
- On save, the selection in the box becomes a **linked span** pointing at the new piece.

This closes the loop: type freely → notice something reusable → one gesture turns it into a library
piece, with the same template-editing surface as everything else.

### F5 — Placeholders

- A piece body can contain `{{token}}` markers. Tokens are named (e.g. `{{ticket}}`, `{{concern}}`).
- **At insert time** (F2) or when re-opening in instance mode (F3), the user fills each token via a
  small form; the values are substituted into the linked span.
- Placeholders keep pieces reusable without forcing an inline edit every time — the library piece
  stays generic, the compose box gets the specific version.
- **Deferred: presets.** A "preset" = a *named, already-filled* combination of a template's
  placeholders (e.g. save `{ticket: JUROR-412, concern: error handling}` as "juror-412 review") so a
  common fill is one click instead of re-typing. Useful but adds UI; not in the first build.

### F6 — The library: scope, tags, categories, management

- Every piece is **Global** or **Project**-scoped. The active-project picker at the top of the view
  controls which project-scoped pieces are visible; global pieces are always visible.
- **Browse panel** (lightweight): a list of pieces filterable by **scope** and by **tag/category**,
  **side-by-side** with the compose box (left panel, collapsible for a distraction-free box), in
  addition to type-to-search. Rationale: some users (the founder included) will *only* ever
  type-to-search and never tag anything — so browse/tagging must be **fully optional** and never in
  the way. But for users who invest in tags, a browse view earns its keep as the library grows.
- **Active-project picker** reuses Deck's existing project list (from `~/.claude/projects/`), plus a
  **"Global only"** option; there is no separate "prompt project" concept.
- **Tags** — many per piece, freeform. **Category** — at most one per piece, chosen from a managed
  list. Both are optional.
- **Tag & category management UI** — a small admin surface to rename/merge/delete tags and manage the
  category list, so the taxonomy doesn't rot into 12 near-duplicate tags.
- Because tagging is optional, we lean on two things to keep an untagged library usable: (1) body-text
  fuzzy search (F2) finds pieces with zero tags, and (2) **LLM auto-fill** (F7) can populate
  tags/category from the body later.

### F7 — Storage as JSON + LLM-friendliness

- Each piece is stored as **one JSON object** (plain files on disk, following Deck's ethos: nothing
  proprietary, hand-editable, git-able, never leaves the machine).
- JSON (not opaque blobs) is a deliberate product choice: a user can **hand the JSON to any AI and
  ask it to fill in tags / keywords / category** from the body, then load it back. The format is
  designed to make LLM-assisted curation trivial — even before we build any in-app AI.
- Indicative shape (fields, not final schema):
  ```json
  {
    "id": "…",
    "title": "senior-reviewer",
    "body": "You are a senior reviewer. Review the PR for {{ticket}}…",
    "keywords": ["review", "role"],
    "tags": ["review"],
    "category": "roles",
    "scope": { "kind": "project", "project": "juror_fullstack" },
    "placeholders": [{ "name": "ticket" }],
    "versions": [ /* prior bodies, newest-first */ ]
  }
  ```
- **Versioning** reuses the model Deck already has for session edits (snapshot on save, list history,
  restore). Product-level promise: **saving a piece never destroys the previous version** — you can
  always roll a piece back.

### F8 — Output

- **Copy prompt** is the primary exit: box → clipboard as clean plain text.
- (Later, low priority: "insert into a new Claude Code session" once Deck can launch sessions — keeps
  the whole loop inside Deck. Not required for v1.)

---

## Deferred (foundation first, these come later)

- **RAG / dynamic assembly.** Vector-DB-backed retrieval that *auto-suggests or auto-assembles* a
  prompt from the whole library given a short intent. Genuinely valuable but genuinely complex —
  **deferred**. Build the manual foundation (compose + pieces + fuzzy search + save) first; the JSON
  storage format is already RAG-ready when we get there. When built: **small, in-app, local** vector
  index — privacy is a hard requirement, nothing leaves the machine.
- **LLM features** (auto-tag, auto-category, RAG). When we add any LLM call, use an
  **OpenAI-compatible API interface** — most providers speak it now, keeps config to one base-URL +
  key. Bring-your-own-key, off by default, privacy-forward.
- **Presets** (F5) — named filled-in placeholder combinations.
- **Sharing / export-import** — send a piece or a pack to someone else; the JSON format makes this
  cheap when we want it.
- **Reorderable-block compose mode** — the alternative to F1's freeform box (pieces as draggable
  chips). Rejected as the default for being heavier and less free-flowing; noted here in case a
  structured-assembly mode is ever wanted as an option.

---

## Settled decisions (previously open, now closed 2026-07-06)

1. **Editing a linked span back into the template — yes, no merge.** When you've edited a linked (or
   linked-modified) span inline and re-open it in template mode, the modal offers **"Use current text
   as the template body."** It's a straight replace: the piece's body becomes exactly what's in the
   span now, versioned like any save. No 3-way diff/merge — that's overkill and confusing. The user
   always has two clean choices: **overwrite this piece** or **Save as new piece** (fork).
2. **Layout — side-by-side, collapsible.** The compose box is the primary surface (center/right); the
   search + browse panel sits beside it (left), and can be collapsed for a distraction-free box. This
   mirrors Deck's existing Search/Browse two-pane feel rather than hiding pieces behind a drawer.
3. **Projects — reuse Deck's project list, plus "Global only."** The active-project picker draws from
   Deck's existing projects (the `~/.claude/projects/` set the rest of the app already knows), so a
   piece scoped to a project lines up with where you actually work. A **"Global only"** option covers
   prompt work not tied to any repo. A "prompt project" is *not* a separate concept — one less thing
   to manage.

---

## Product milestone slices (not engineering tasks)

Each slice should be independently usable — the tool is valuable even at M1.

- **M1 — Compose + library core.** Freeform compose box with provenance coloring, a JSON-backed
  piece store (global + project scope), live fuzzy search (title+keywords+body), click-to-insert,
  Copy prompt. *No modal yet — pieces are created by a basic "save selection as piece" form.*
- **M2 — The piece modal.** Instance mode vs. template mode with the background-color signal, save to
  project/global, versioning, new-text→chunk via the modal.
- **M3 — Placeholders.** `{{tokens}}`, mark-in-template-mode, fill-in-on-insert.
- **M4 — Organization.** Tags + category, browse panel, tag/category management UI.
- **M5+ — Deferred.** LLM auto-tag, presets, RAG, sharing.
