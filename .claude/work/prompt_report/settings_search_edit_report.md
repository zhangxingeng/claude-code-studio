# Report: restore schema-driven settings backend, add search-and-popover editor (#18 reversal, #20)

## Diffs touched

| File | +/- | Summary |
|---|---|---|
| `src-tauri/src/settings.rs` | new (restored) | Verbatim `git show 940d66f~1` restore: tier read/merge/conflict/optimistic-write-guard + 12 unit tests. |
| `src/lib/schema/claude-code-settings.json` | new (restored) | Verbatim ~190KB vendored schema restore. |
| `src-tauri/src/lib.rs` | +5 | Re-added `mod settings;` and `settings::read_claude_settings`/`write_claude_settings` in `invoke_handler!`, beside `appconfig::*`. |
| `src/lib/types.ts` | +38 | Restored `SettingsTier`/`SettingsTierData`/`SettingsConflictValue`/`SettingsConflict`/`ClaudeSettings` verbatim; the since-reshaped `AppConfig` below untouched. |
| `src/lib/api.ts` | +93 | Restored `readClaudeSettings`/`writeClaudeSettings`/`isSettingsConflict` + dev-mode mock shims verbatim; `AppConfig`/`resumeInTerminal` untouched. |
| `src/lib/components/SettingsSearchView.svelte` | new (~450 lines) | New frontend: header, search box, capped (30) fuzzy candidate list, one-field popover (tier radio, schema-driven widget, conflict hint, Save/Clear/Cancel). Never renders the old always-visible form. |
| `src/lib/components/BrowseView.svelte` | +20 | Restored `onOpenSettings` prop + both project-group gear-icon blocks verbatim; the since-changed `doResume(path, cwd, title)` signature and other App Config edits left untouched. |
| `src/app.css` | +7 | Restored `.project-group__settings` CSS. |
| `src/lib/components/AppConfigView.svelte` | comment only | Fixed a stale header comment claiming the settings editor "was removed... users hand-edit settings.json themselves now" — now points at `SettingsSearchView` as the separate entry point. |
| `src/routes/+page.svelte` | +33/-6 | `view` gained `'settings'`; restored `settingsProjectCwd`/`settingsProjectLabel`; added `goSettings(cwd, label)`; new "⚙ Settings" header button beside "⚙ App Config"; `BrowseView` gets `onOpenSettings={goSettings}`. App Config wiring untouched. |
| `project_docs/roadmap.md` | +~45 | New `## Phase 13`: what came back unchanged, what didn't, the new frontend, the tier radio, both entry points; resolves #20 (expanded), amends #18. |

## Tests run

- `cargo build --lib` — clean after Step 1 alone, confirming the restore compiled before layering the frontend on top.
- `cargo test --lib` — **47/47 passing** (12 restored `settings` tests: precedence, effective-value winner, conflict-only-on-differing-values, user-only scope, write-creates-dir, invalid-JSON-non-fatal, 3-case optimistic write guard; plus 35 pre-existing tests unchanged).
- `pnpm check` — **0 errors, 0 warnings, 223 files** (fixed two a11y warnings on the popover along the way: Escape-to-close handler, and swapped a nested `stopPropagation` for an `e.target === e.currentTarget` backdrop check).
- `pnpm build` — clean production build; the pre-existing `INEFFECTIVE_DYNAMIC_IMPORT` Vite warning is unrelated.
- Grep for `SettingsView` — only in explanatory comments, no dangling code reference.
- **Not run: live GUI pass.** `pnpm dev` started cleanly on `:1420`, but `tabs_context_mcp` reported the Chrome extension not connected — same sandbox gap as Phase 6/7/12. Dev server killed afterward. Founder should manually: open "⚙ Settings" globally, search "model", confirm the popover shows only that field and only "User" is selectable; open a project's gear icon, confirm Local/Workspace/User all appear, and round-trip an edit.

## Compromises bubbled up

- **`BrowseView.svelte`/`+page.svelte` restores avoided reverting App Config cleanly, not fiddly.** The App Config-era edits (`doResume`'s `title` param, `appconfig`/`AppConfigView` wiring, `resumeInTerminal`'s `sessionTitle`) sit at different lines than the settings-gear/view pieces restored here, so there was no textual overlap — both diffs are pure additions, verified by re-reading them post-edit.
- **Live GUI verification not performed** — sandbox's Chrome extension isn't connected, a repeat of the Phase 6/7/12 gap; flagging rather than skipping silently.
- **Popover needed a real modal**, which `SettingsView` never had (no per-field popover existed before): added `role="dialog"`/`aria-modal`/`tabindex="-1"` + Escape-close to keep `pnpm check` at 0 warnings — not explicitly requested, but required once a modal was introduced.
- **Clear vs. Save semantics** weren't fully pinned by the prompt. Made Clear write immediately (remove the key from that tier's file, reload) rather than just staging a local removal — reads more usefully as a one-click "unset this" in a single-field popover with nothing else to batch it with. Cancel discards and closes without writing.

## Open questions

None.
