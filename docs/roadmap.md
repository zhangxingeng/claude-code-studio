# Deck — Roadmap

Status: **Phases 1–4 shipped in v0.5.0/v0.6.0**, committed on `main`. This doc replaces the
open-ended "Search Phase 2" tail in `docs/search-design.md` (that doc's own Phase 2 section is now
marked done and points here).

## Why the pivot

The app started as "Claude Code Studio" — a history browser/editor. It's repositioning as **Deck**,
a **Claude Code Control Center**: the founding mission is to make Claude Code approachable to
non-technical people, so the terminal and raw JSON config are never the wall that stops someone
from coding. Product principle throughout: **simple by default, advanced on demand.**

Naming note: "Claude Code Studio" led with Anthropic's trademark as the product's own brand, which
is the riskier pattern under US nominative-fair-use doctrine (using a mark *as your product name*
vs. using it *descriptively* to say what you're compatible with). Renamed to **Deck** — a fully
distinctive brand name — with "Claude Code Control Center" / "for Claude Code" used only as a
descriptor, plus an explicit unaffiliated disclaimer in the README. Ecosystem precedent (e.g. the
popular Claude Code GUI "Claudia" renaming to "Opcode") points the same direction.

## Phase 1 — Rebrand to Deck (DONE)

- `tauri.conf.json`: `productName` → "Deck", window title → "Deck — Claude Code Control Center",
  bundle descriptions rewritten, updater endpoint repointed at the renamed repo. `identifier`
  (`com.zhangxingeng.ccstudio`) and the `.ccstudio-*` on-disk paths **deliberately left unchanged**
  — renaming those would strand existing installs from updates and orphan every user's search
  cache/backups/drafts. Cargo crate name (`ccstudio`/`ccstudio_lib`) also left as-is — internal
  only, zero user-facing value, kept the diff small.
- `package.json` description rewritten; npm package name (`claude-code-studio`) left alone
  (cosmetic, not user-facing).
- Every other user-visible string updated: `src/routes/+page.svelte` (h1, footer), `src/app.html`
  title, `src/app.css` header comment, `ARCHITECTURE.md` title, `.github/workflows/release.yml`
  release name.
- **README.md fully rewritten** around the mission (hero, mission callout, personas, three feature
  pillars, privacy, FAQ, trademark disclaimer).
- **GitHub repo renamed** `zhangxingeng/claude-code-studio` → `zhangxingeng/deck` (`gh repo rename`,
  confirmed with the founder first since it's outward-facing). GitHub keeps a redirect from the old
  path. Local `origin` remote updated to match.

## Phase 2 — Schema-driven settings editor (DONE)

The founder's real pain: Claude Code config is spread across three files and you can't tell what's
set where.

- **Backend** (`src-tauri/src/settings.rs`): `read_claude_settings(project_cwd)` reads whichever of
  `~/.claude/settings.json` (user), `<project>/.claude/settings.json` (project), and
  `<project>/.claude/settings.local.json` (local) exist; returns each tier's path/exists/raw/parsed,
  a top-level merged `effective` view, and a `conflicts` list (key set to *differing* values in ≥2
  tiers, with the winning tier). `write_claude_settings(tier, project_cwd, value)` writes exactly
  one tier, pretty-printed, never merging. 6 unit tests (precedence, merge, conflict detection,
  user-only scope, write-creates-dir, malformed-JSON-doesn't-crash).
- **Schema**: Claude Code's published settings JSON Schema vendored at
  `src/lib/schema/claude-code-settings.json` (~190 KB, 125 top-level properties) so the app stays
  100% offline — no runtime fetch. **To refresh**: re-download
  `https://json.schemastore.org/claude-code-settings.json` and overwrite that file; nothing else
  needs to change unless key names change.
- **Frontend** (`src/lib/components/SettingsView.svelte`): tier tabs (Local/Project/User), a
  conflict banner up top with jump-to-field, and a schema-driven form — each field rendered with
  its schema `description`, typed by JSON-Schema `type`/`enum` (checkbox / select / text / number /
  comma-separated array / JSON-textarea fallback for objects and complex arrays). A curated
  "Simple" grouping (Model, Permissions, Environment, Git, Hooks, MCP, Interface — about 20 keys)
  is shown by default; a "Show advanced settings" toggle reveals the remaining ~100 keys
  alphabetically. Entry points: a "⚙ Settings" header button (global/user scope) and a per-project
  gear next to each project's group header in `BrowseView.svelte` (resolves that project's real
  `cwd` from its sessions' `meta.cwd`).
- Validation is render-time type coercion only (no `ajv`/JSON-Schema validator) — deferred per the
  original plan as out of scope for v1.

## Phase 3 — Configurable terminal launcher (DONE)

- **`src-tauri/src/appconfig.rs`**: Deck's own tiny preference file at
  `~/.claude/.ccstudio-config.json` (`{ terminal, terminalArgs }`), with `get_app_config` /
  `set_app_config` commands. Falls back to defaults (auto-detect, no extra args) on any read error.
- **`resume_in_terminal`** (`src-tauri/src/lib.rs`) generalized to load this preference: "auto"
  (default, empty string) reproduces the exact original per-OS auto-detect behavior; a custom
  preference supplies a terminal command template (first token = program, rest = args preceding the
  `claude` invocation) plus optional extra CLI args appended after `--resume <id>` (e.g.
  `--dangerously-skip-permissions`).
- **UI**: a "Terminal" section inside `SettingsView.svelte` (global scope only — terminal choice
  isn't a per-project concept). Default radio = "Automatic (recommended)"; "Custom" reveals a
  terminal-command field; extra arguments live behind an "Advanced" disclosure with a caution note.

## Phase 4 — Search Phase 2 cleanup (DONE)

Closes out the two items `docs/search-design.md` left "NOT STARTED":

- **Keyboard navigation**: `SearchView.svelte` tracks a `focusedIdx` over the flattened,
  collapse-aware hit list (`visibleHits`, derived from non-collapsed groups only). ↓/↑ on the
  search input move focus and scroll the focused hit into view; Enter jumps to it. Resets on every
  new query.
- **Tool-name filter**: `SearchFilters.toolName` (Rust `tool_name: Option<String>`) restricts to
  `tool_use` blocks whose text is exactly the tool name or starts with `"{name}\n"` (matching the
  extraction format in `search/extract.rs`) — implemented as an escaped `LIKE ... ESCAPE '\'`
  prefix match. **Overrides `sources`** rather than ANDing with it (an AND would always be empty,
  since `sources` rarely includes `tool_use` alongside a tool-name filter). Same override logic
  applied to the cold-path scanner (`passes_source_and_date`) so warm/cold tiers agree.
- **Current-session filter**: `SearchFilters.sessionPath` (Rust `session_path: Option<String>`)
  restricts to one session file — a `WHERE b.session_path = ?` clause in the warm-path SQL, and a
  file-skip in the cold-path directory loop (`state.rs`). Wired through `search.svelte.ts`
  (`sessionOnly` toggle + `currentSessionPath`, set via `initSearch(currentSessionPath)`) and a
  "This session only" checkbox in `SearchView.svelte`, shown when a `currentSessionPath` prop is
  passed. **Known gap**: today's navigation only reaches Search from Browse (`current` session is
  always cleared by then), so this checkbox has no live entry point yet — the filter itself is
  correct and tested, but wiring a "search within this session" button from the viewer is a
  follow-up, not done here.
- Model/git-branch filtering remains explicitly out of scope (needs new indexed columns + a
  reindex, not requested).
- 4 new Rust tests (tool-name match, tool-name overrides sources, session-path restriction) on top
  of the existing 27, all passing (30 total, `search::query` module). `pnpm check` / `pnpm build`
  clean throughout.

## Verification performed

- `cargo test --lib` (src-tauri): 30/30 passing.
- `pnpm check` (svelte-check): 0 errors, 0 warnings across 230 files.
- `pnpm build`: clean production build (client + server/prerender), including the vendored schema
  JSON bundling correctly.
- Full-repo grep confirms no remaining "Claude Code Studio" / "claude-code-studio" strings except
  the intentionally-left npm package name (`package.json`'s `"name"` field — cosmetic, not
  user-facing) — the same call already made for the Cargo crate name.
- **Not performed**: live GUI/browser verification of `SettingsView.svelte` and the search
  keyboard-nav/filter UI — the Chrome browser-automation extension wasn't connected in this
  session. Founder should do a visual pass before shipping, per the standing project convention
  that GUI verification happens on the founder's machine.

## Open follow-ups (not done here)

- New app icon/logo art for "Deck" (needs founder-supplied art).
- A "search within this session" entry point from the session viewer, to actually surface the
  current-session-only filter built in Phase 4.
- Guided onboarding / install-Claude-Code flow, for reaching truly non-technical users who don't
  yet have Claude Code installed.
- Heavier JSON-Schema validation (`ajv` or similar) for the settings form, if silent type coercion
  proves too loose in practice.

## Future ideas (exploratory — not planned, not scoped, no timeline)

Raised by the founder while reviewing the 0.6.0 release. Recorded here so they aren't lost, but
none of these are committed work — each needs its own design pass before becoming a real phase.

- **"Ask Claude" about a setting.** Inline AI help inside `SettingsView` so a user can ask what a
  specific field does / whether a value is sane, instead of just reading the schema description.
  Open design question (founder's own words): per-field AI help feels like a chore to wire up
  field-by-field, but one global "ask about this settings file" affordance might lose the specific
  context of which field the user is confused about. Possible directions to explore later: a
  skill-file-style prompt template fed the schema + current tier values + the field in focus;
  or a single chat panel scoped to the currently-open tier. Needs a design pass on UX (where the
  entry point lives) and on how it calls out to Claude (local `claude` CLI shellout? API key?)
  before any implementation starts.
- **Selective / smarter chat compaction.** A finer-grained alternative to Claude Code's raw
  `/compact` for editing session history — let a user selectively condense or drop irrelevant
  chunks of a long conversation rather than an all-or-nothing compact, aimed at complex sessions
  where blanket compaction loses detail that still matters. Founder is unsure this is worth the
  complexity ("actually that would be too complex... maybe not, I don't know yet") — flagged as
  worth exploring, not worth building yet. Would likely build on the existing edit/undo/backup
  infrastructure in `SessionEditor.svelte` rather than replacing it.
- Both ideas sit under the same theme as Phase 2/3: **embedding real AI assistance into the control
  center itself**, not just viewing/configuring Claude Code from the outside. Worth revisiting
  together once one of them gets a concrete design.

## Release history

- **v0.5.0 (2026-07-04)** — Deck pivot (Phases 1–4 above): rebrand, settings editor, terminal
  launcher, search cleanup. Founder tested locally (AppImage + `.deb`, after removing the
  superseded `claude-code-studio` package) — confirmed good.
- **v0.6.0** — Version bump after founder sign-off on the 0.5.0 Deck pivot testing pass; no
  functional changes beyond the version bump itself. README rebrand (marketing pass, non-technical
  section on top / technical below) and repo contribution setup (`CONTRIBUTING.md`, issue/PR
  templates) landed alongside it — see below.
- **CI/CD hardening (post-v0.6.0 tag).** The v0.6.0 release run flagged Node 20 deprecation
  warnings — `actions/checkout@v4`, `actions/setup-node@v4`, and `pnpm/action-setup@v4` were being
  silently forced onto Node 24 by GitHub. Bumped all three (`@v7`/`@v6`/`@v6`) plus
  `tauri-apps/tauri-action@v0` → `@v1` (checked the v1 changelog — none of its breaking changes
  touch the inputs this repo uses). Added `.github/workflows/ci.yml`: a real CI check
  (`pnpm check` + `pnpm build` + `cargo test --lib`) on every push/PR to `main` — previously the
  only workflow was the release build itself, so a broken PR could only be caught by a human.
  Added `.github/dependabot.yml` covering the three dependency surfaces (pnpm/npm, Cargo, and the
  GitHub Actions versions in our own workflows), weekly, grouped by minor/patch to keep the PR
  volume sane.
