# Audit report: settings backend restore + search-and-popover editor (#18 reversal, #20)

**Verdict:** This merges cleanly. The restore is genuinely verbatim (not a paraphrase), the App
Config-era work is untouched, and the new frontend honestly delivers "one field at a time." One
real data-loss edge (parse-error tier clobber) and one low a11y nit are worth flagging; nothing
else.

Empirical checks run: `cargo check --lib` clean; `pnpm check` 0 errors / 0 warnings / 223 files.

## Fixed in-pass

None. The one behavioral finding is a judgment call (data-loss vs. self-repair) and touches the
write contract, so it is flagged, not silently changed.

## Findings

**[Verbatim — PASS]** `git diff 940d66f~1 -- settings.rs` and the vendored schema are byte-identical
(tier precedence, `merge_and_conflicts`, the `current_raw != base_version` optimistic guard, the
`"CONFLICT: ..."` message — all unchanged). The `types.ts` `SettingsTier` block and `api.ts`
`readClaudeSettings`/`writeClaudeSettings`/`isSettingsConflict` block are verbatim except one
comment word in the dev-mock header: `conflict banner` → `conflict hint`
(`api.ts:6`). That is an intentional, coherent update to the new UI's "hint" vocabulary, not a
disguised logic change — benign.

**[Cross-contamination — PASS]** `git diff HEAD` on `BrowseView.svelte` is pure addition (no removed
lines); `doResume(path, cwd, title)`, `resumeInTerminal(cwd, id, title)`, `goAppConfig`, the
`appconfig` view, and `AppConfig`'s `launchCommand`/`updateCheckOnLaunch` all survive intact in
`+page.svelte` / `types.ts` / `api.ts`. No partial revert of the diverged App Config direction.

**[Registry — PASS]** `lib.rs:15` one `mod settings;`, `lib.rs:904-905` two registrations, no
duplicate/orphan. `settings.rs` has zero coupling to `lib.rs` internals (only `std`/`serde`), so the
`resume_in_terminal`/`shell_quote` churn can't touch it; compiles clean.

**[Q2 one-field-at-a-time — PASS]** The candidate row (`SettingsSearchView.svelte:297-303`) renders
only `<code>{key}</code>` + a set-dot + truncated `.candidate-row__desc`. Every editable widget is
gated behind `{#if selectedKey}` (`:316`). No inline-per-row widget; the ~125-field form stays dead.

**[Q5 optimistic concurrency — PASS]** `writeTier` (`:213-218`) takes both `baseVersion = t?.raw`
and `nextObj = {...t?.parsed}` from the *same* `tierData(popTier)` off the *same* `settings` load,
then `load()` refetches both together. `parsed` cannot drift from `raw`; no unrelated-field clobber.

**[Q6 Clear/tier-switch — PASS]** `Clear` is `disabled={!popIsSet}` (`:429`) and `popIsSet` reflects
on-disk set-state via `syncPopValue`; `selectPopTier` (`:128-132`) clears `popConflictMsg` and calls
`syncPopValue`, which resets `popFieldError`/`popValue`/`popIsSet` — no stale leak across tiers.

**[MEDIUM] `SettingsSearchView.svelte:217` — write clobbers a parse-error tier.** For a tier whose
on-disk JSON is currently invalid, the backend returns `parsed: null` + a `parseError`, but this
frontend never reads `parseError` (grep: 0 hits). `syncPopValue` treats it as unset, and `writeTier`
spreads `{...null}` = `{}`; the optimistic guard passes (raw unchanged), so Save writes
`{"key": value}` and silently discards the rest of the user's unparseable file. Failure: user with a
typo'd `settings.json` edits one key and loses the whole file's other contents with no warning.
Surface `t.parseError` in the popover and block/gate Save for that tier.

**[LOW] `SettingsSearchView.svelte:325-331` — popover not focused on open.** `tabindex="-1"` is set
but nothing calls `.focus()`, so the backdrop `onkeydown` Escape only fires while a child input holds
focus; a mouse-opened popover with no field focused can't be Escape-dismissed. Add a focus on mount.

## Out-of-scope but flagged

None. (Client-side substring filtering over 125 keys is the chosen design, per the brief.)

## Doc coherence

`roadmap.md` Phase 13 matches the diff — verbatim-restore list, two entry points, "Workspace" label
over the retained `'project'` type, and honest "live GUI verification not performed" note all check
out.
