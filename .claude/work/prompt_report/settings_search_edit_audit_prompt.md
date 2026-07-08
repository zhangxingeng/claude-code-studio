# Audit brief: settings backend restore + search-and-popover editor (#18 reversal, #20)

You are auditing a just-completed feature build, cold. Read the diff and surrounding surface
fresh — don't read `.claude/work/prompt_report/settings_search_edit_*` files, form your own read.

Answer one question: **does this code merge cleanly into the codebase's existing shape, or does
it sit on top as a patch?** Specifically here: is the *restored* backend genuinely unchanged
(a faithful revert, not a subtly-different reimplementation), and does the *new* frontend actually
deliver "one field at a time" or does it quietly regress toward the old always-everything-visible
form?

## Surface — read cold

`git diff` / `git status` at the repo root. Focus on:

- `src-tauri/src/settings.rs` (restored — new file in this diff) and `src-tauri/src/lib.rs`'s
  `mod settings;` + the two `settings::*` command registrations
- `src/lib/components/SettingsSearchView.svelte` (new, ~450 lines) — the whole file
- `src/lib/types.ts`, `src/lib/api.ts` — the restored `SettingsTier`-family types and
  `readClaudeSettings`/`writeClaudeSettings`/`isSettingsConflict`, checked against what's *since*
  changed in the same files (`AppConfig`, `resumeInTerminal`) to confirm no cross-contamination
  between the restore and the adjacent, unrelated App Config feature
- `src/lib/components/BrowseView.svelte`, `src/routes/+page.svelte`, `src/app.css` — the
  restored per-project gear icon + new global entry point, checked against the same "did this
  quietly revert unrelated App Config work" concern
- `src/lib/components/AppConfigView.svelte` — only the comment change

Adjacent, unchanged-by-this-diff for reference: the git history at `940d66f~1` has the exact
pre-deletion versions of `settings.rs`/`types.ts`/`api.ts`/schema — useful if you want to diff the
restored content against the original to confirm it's truly verbatim, not a paraphrase.

## Vocabulary docs

| Doc | Why it matters here |
|---|---|
| `ARCHITECTURE.md` | Layering contract — commands snake_case, `src-tauri/` owns FS access, `api.ts` is the thin wrapper. |
| `ai-first-docs/stack/svelte/design_protocol.mdx` | Svelte 5 conventions the new popover component should follow. |
| `.claude/memory/MEMORY.md` | Cut-unused-features and round-trip-testing standing preferences. |

## The wholesomeness questions

1. **Is the restore actually verbatim, or a subtly-different reimplementation?** Spot-check
   `settings.rs`'s tier precedence logic, conflict detection, and the optimistic-write-guard
   against `git show 940d66f~1:src-tauri/src/settings.rs`. A restore that "looks the same" but
   quietly changed a comparison or an error message is worse than an honest fresh reimplementation
   — it reads as unchanged to a reviewer skimming the diff summary but isn't.
2. **Does the new frontend actually honor "one field at a time," or does it regress?** The whole
   point of this rebuild is never showing all ~125 schema properties on screen simultaneously.
   Confirm `SettingsSearchView.svelte` truly gates the schema-driven widget behind
   `{#if selectedKey}` (or equivalent) and the search results list never itself renders the full
   editable widget inline per row (only key + truncated description + a "set" indicator).
3. **Command-registry correctness.** Does `mod settings;` and the two registrations in
   `lib.rs` exactly restore what existed before deletion, with no orphaned or duplicate
   registration, and does the restored `settings.rs` compile against the *current* `lib.rs`
   (which changed since deletion — the App Config rework touched `resume_in_terminal` and
   `shell_quote`'s visibility) without any accidental coupling between the two modules?
4. **Cross-contamination check.** Did restoring `BrowseView.svelte`/`+page.svelte`/`types.ts`/
   `api.ts` content from `940d66f~1` silently revert any of the App Config-era changes made in the
   prior build (the `doResume(path, cwd, title)` signature, `resumeInTerminal`'s `sessionTitle`
   param, `AppConfig`'s `launchCommand`/`updateCheckOnLaunch` fields, the `goAppConfig`/`appconfig`
   view wiring)? Grep/read carefully — a partial restore across a file that's diverged in two
   unrelated directions is exactly where this class of mistake hides.
5. **Optimistic-concurrency correctness in the new write path.** `SettingsSearchView`'s `writeTier`
   builds `nextObj` by spreading the tier's currently-loaded `parsed` value, then mutating one key,
   then writing with `baseVersion = t?.raw`. Confirm this can't silently clobber unrelated fields
   in that tier's file if the loaded `parsed` is stale relative to `raw` (i.e., confirm `parsed`
   and `raw` are always loaded together from the same `readClaudeSettings` response, never mixed
   across two different loads) — a "two representations agree with each other yet both are wrong"
   class of bug would be `parsed` silently drifting from what `raw`/`baseVersion` represents.
6. **The `Clear` vs `Save`-with-cleared-value distinction.** The build's own report flagged this as
   a judgment call it made (Clear writes immediately rather than staging). Confirm the actual
   behavior is sound: does `Clear` correctly no-op (button disabled) when the field isn't set in
   the selected tier, and does switching tiers mid-popover (`selectPopTier`) correctly reset
   `popFieldError`/re-sync `popValue` so a stale error/value from the previous tier doesn't leak in?
7. **Doc coherence.** Spot-check `roadmap.md`'s new Phase 13 entry against the actual diff.

## Out of scope

#21 (provider profiles) and any deeper search infra (tantivy-style indexing) — this issue
explicitly chose client-side substring filtering for ~125 keys; don't flag the absence of a real
search index as a gap.

## Fix in-pass vs flag

Same convention as prior audits: fix in-pass only if single-file, local-semantics, mechanically
obvious. Flag anything touching a signature/contract or requiring a judgment call.

## Response format

Write to `.claude/work/prompt_report/settings_search_edit_audit_report.md`, ~500 words:
- **Fixed in-pass** (table, or "None")
- **Findings** — severity-tagged, file:line, one-sentence failure scenario
- **Out-of-scope but flagged** (or "None")
