# Build brief: restore schema-driven settings backend, add a search-and-popover editor (#18 reversal, #20)

## Why this work exists

Last session, issue #18 removed the Claude Code settings editor entirely — both the backend
(`settings.rs`), the vendored schema, and the frontend (`SettingsView.svelte`'s tabbed, ~125-field
form covering every schema property at once). Immediately after shipping that, the founder realized
the actual complaint was never "schema-driven editing is useless" — it was "a giant always-visible
form of 125 fields is a complex tool no one knows how to use." People *do* want an easy way to find
and tweak one Claude Code setting; they just don't want to wade through a big form to do it.

So: **restore the backend/schema/types exactly as they were** (the read/merge/conflict/write
mechanism was never the problem), and **build a genuinely new, much smaller frontend**: a fuzzy
search box over the schema's ~125 keys, and a popover that edits exactly one field at a time. Full
design history is in the issue comments — read them, don't re-derive the design:

- https://github.com/zhangxingeng/ccdeck/issues/18 (bottom comment: the reversal)
- https://github.com/zhangxingeng/ccdeck/issues/20 (bottom comment: the settled design)

## Mandatory reading

| Doc | What it floors |
|---|---|
| `.claude/memory/MEMORY.md` | Standing rules: target latest toolchain, cut unused features, round-trip test parse/serialize-shaped code. |
| `ai-first-docs/stack/svelte/design_protocol.mdx` | Svelte 5 rune rules, Props conventions — the new component should follow these, not the deleted `SettingsView`'s exact shape (that shape — a big always-visible form — is precisely what's being replaced). |
| `ARCHITECTURE.md` (repo root) | Rust/TS layering contract — `src-tauri/` is the only FS-touching layer, commands are snake_case, `api.ts` is the thin invoke wrapper with a dev fallback. |
| `.claude/work/prompt_report/appconfig_relaunch_prompt.md` + `_report.md` + `_audit_report.md` | Last session's build/audit of the adjacent App Config feature — read for context on what `+page.svelte`'s current view-state shape and header-actions area look like now (it changed since `settings.rs` was deleted), and the project's audit/verify conventions used on that pass. |

## Step 1 — restore exactly what #18 deleted (git history has it verbatim)

The commit that deleted these is `940d66f`; its parent `940d66f~1` has the pre-deletion content.
Restore each file's content **exactly as it was** — do not modify the restored code beyond what's
needed to re-integrate it with what changed since (the `resume_in_terminal`/`AppConfig` rework from
the adjacent App Config build did NOT touch any of these files, so there should be no real merge
conflict, just re-adding deleted content):

```bash
git show 940d66f~1:src-tauri/src/settings.rs > src-tauri/src/settings.rs
git show 940d66f~1:src/lib/schema/claude-code-settings.json > src/lib/schema/claude-code-settings.json
```

- `src-tauri/src/lib.rs` — re-add `mod settings;` (was at line 15, may have shifted) and the two
  command registrations `settings::read_claude_settings, settings::write_claude_settings` in the
  `tauri::generate_handler!`/`invoke_handler` list (was near the `appconfig::*` registrations —
  read the current file to find the right spot, it moved since the App Config rework).
- `src/lib/types.ts` — restore `SettingsTier`, `SettingsTierData`, `SettingsConflictValue`,
  `SettingsConflict`, `ClaudeSettings` (get the exact prior text via
  `git show 940d66f~1:src/lib/types.ts` and diff against current to find what to re-add — the
  `AppConfig` interface below it has since changed shape, don't touch that part).
- `src/lib/api.ts` — restore `readClaudeSettings`, `writeClaudeSettings`, `isSettingsConflict`, and
  the `devSettingsStore`/`devTierPath`/`devReadClaudeSettings` dev-mode shims (same approach: pull
  the exact prior text via `git show 940d66f~1:src/lib/api.ts`, re-add without disturbing the
  `AppConfig`/`resumeInTerminal` code that's since changed).

Verify after this step: `cargo build --lib --manifest-path src-tauri/Cargo.toml` and `pnpm check`
both still fail only on the *missing new frontend* (undefined imports for the component you're
about to write), not on anything backend/type-related — confirms the restore was clean before you
build on top of it.

## Step 2 — build the new frontend: search + one-field-at-a-time popover

**Do not restore or reference `SettingsView.svelte`'s form/tab UI shape** — it no longer exists
(deleted, correctly, and stays deleted) and its always-everything-visible layout is exactly the
anti-pattern this rebuild avoids. Build a new component, suggested name
`src/lib/components/SettingsSearchView.svelte`, with this shape:

1. **Header** — title, scope indicator (which project, or "User (global)"), a Close button —
   same header pattern as `AppConfigView.svelte` (`.appconfig-head`-style), for visual consistency
   with the sibling preferences page.
2. **Search box** — a single text input. On every keystroke, fuzzy-filter the schema's top-level
   properties (`schema.properties`, same source `SettingsView` used) by matching the query against
   the property key and its `description` text. A simple scoring fuzzy match is sufficient (e.g.
   substring match on key gets highest rank, substring match on description next, no match
   excluded) — this is ~125 short strings filtered client-side on every keystroke; no need for a
   search index or the tantivy engine `search/` uses for session content.
3. **Candidate list** — below the search box, up to some reasonable cap (e.g. 30) of matching
   keys, each row showing: the key (`<code>`), a one-line truncated description, and a small dot
   or badge if the key is currently set in *any* tier (reuse the already-loaded settings response's
   tier data to compute this — don't add a new backend call for it). Clicking a row opens the
   popover for that key.
4. **Popover/modal — exactly one field, never the whole schema.** Shows:
   - The key and its full `description` as helper text (same info the schema already carries;
     this is the "helper text" the founder asked for, generated from the schema, not hand-written).
   - A **Local / Workspace / User radio** (three options, matching the three tiers
     `read_claude_settings`/`write_claude_settings` already model as `'local' | 'project' | 'user'`
     — label the project tier "Workspace" in the UI text even though the type/API keeps the
     existing `'project'` string value, so the backend contract doesn't need renaming). When
     opened with no project context (global entry point, see below), only "User" is
     selectable/shown — Local and Workspace need a project cwd that doesn't exist in that scope.
   - The schema-driven widget for the field's current value in the selected tier — reuse the exact
     `widgetKind`/rendering logic `SettingsView.svelte` used (boolean checkbox, enum select, string
     input, number input, comma-separated string-array input, JSON textarea fallback) — that
     widget-mapping logic was sound; it's the "always show all 125 at once" layout that wasn't.
   - If the key is also set in a different tier with a different value, a small one-line inline
     hint ("Also set in User: `true`") — reuse the `conflicts` array the backend already computes;
     this is a lightweight parity nod to the old conflict banner, not a rebuild of it. Optional
     nice-to-have — skip if it meaningfully complicates the popover; don't let it balloon scope.
   - Save / Clear (remove from this tier) / Cancel buttons. Save writes via `writeClaudeSettings`
     exactly like before: the full tier object with just this one key mutated, using that tier's
     `raw` text (from the initial `readClaudeSettings` load) as `baseVersion` for the existing
     optimistic-concurrency guard. Surface `isSettingsConflict` the same way `SettingsView` did
     (a dismissible "reload" message) if the write is refused.
5. **Data loading** — call `readClaudeSettings(projectCwd)` once on mount (same as before); hold
   the result in state; the search/candidate list and the popover both read from that same loaded
   state, no per-keystroke backend calls.

## Step 3 — wire the two entry points

Both must exist (per the founder's explicit choice — not just one):

- **Per-project gear icon in `BrowseView.svelte`** — restore the `onOpenSettings` prop and the two
  near-identical gear-icon blocks that were removed in the prior commit (`git show
  940d66f~1:src/lib/components/BrowseView.svelte` has the exact prior shape — restore the prop
  and icon blocks, but keep the *other* App Config changes made since then, e.g. `doResume`'s
  `title` parameter — this file has diverged on an unrelated axis since the deletion, so a blind
  file-level restore would silently revert the App Config work; add back only the settings-gear
  pieces). Restore the matching `.project-group__settings` CSS in `src/app.css` (it was removed
  when the gear icon was deleted).
- **Global header button** — add a second header button in `+page.svelte` alongside the existing
  "⚙ App Config" one (e.g. "⚙ Settings" or similar — your call on exact label, just make it
  clearly distinct from "App Config" since they're different things: CC Deck's own prefs vs.
  Claude Code's settings.json). `view` state needs a fourth member (`'browse' | 'viewer' |
  'appconfig' | 'settings'`), and the old `settingsProjectCwd`/`settingsProjectLabel` state
  (removed in the prior commit) needs restoring for scoping — get the exact prior shape via `git
  show 940d66f~1:src/routes/+page.svelte` and re-add just those pieces, keeping everything since
  changed (the `appconfig`/`AppConfigView` wiring, `resumeInTerminal`'s `sessionTitle` param, etc.)
  intact.

## Forbidden moves — do not silently decide these

- Do not resurrect `SettingsView.svelte`'s all-125-fields-visible form layout in any shape — that
  is the exact UX the founder is moving away from. If you find yourself building a component that
  renders every schema property on screen at once, stop — you've rebuilt the wrong thing.
- Do not invent a fourth tier or rename the existing `'local' | 'project' | 'user'` `SettingsTier`
  union — the UI may *label* the project tier "Workspace," but the underlying type/API contract
  stays as `settings.rs` already defines it (no backend changes needed for tier naming).
- Do not add a dedicated search backend/index for this — the schema has ~125 properties; client-
  side substring/fuzzy filtering on each keystroke is sufficient and matches the founder's
  "simplified version" framing. That heavier tooling exists for session-content search
  (`search/`, tantivy-backed) for a reason that doesn't apply here (thousands of large files vs.
  ~125 short strings).
- Do not merge this feature into `AppConfigView.svelte` — they stay two distinct views/entry
  points (CC Deck's own prefs vs. Claude Code's settings.json), consistent with how #18/#19 already
  drew that line.

## Verification sequence

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml 2>&1 | tail -40   # timeout 120000ms
```
```bash
pnpm check 2>&1 | tail -60   # timeout 120000ms
```

Both clean before reporting done. If you can run the dev app, do a quick manual pass: open the
global settings entry point, search for a key (e.g. "model"), confirm the popover shows only that
field with its description and a working widget; open the per-project gear icon on a project with
existing settings and confirm Local/Workspace/User all appear and an edit round-trips (save,
reload, value persists). If you can't get a GUI up, say so explicitly rather than skipping silently.

## Doc sync

In `project_docs/roadmap.md`, add a new `## Phase 13 — ...` entry (following the existing phase
style) describing: the #18 partial reversal (what came back unchanged: backend/schema/types; what
didn't: the giant form), the new search-and-popover frontend, the three-tier radio, and both entry
points. Note it closes/resolves #20 in its new expanded shape and amends #18.

## What to return

Write your report to `.claude/work/prompt_report/settings_search_edit_report.md`, capped ~500
words: Diffs touched (table), Tests run, Compromises bubbled up (mandatory — e.g. did the
`BrowseView.svelte`/`+page.svelte` restores cleanly avoid reverting the App Config changes made
since the deletion, or was that fiddly?), Open questions.
