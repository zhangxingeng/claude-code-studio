# Handoff: settings backend restore + search-and-popover editor (#18 reversal, #20)

**Status: DONE, verified, ready to commit.** See `project_docs/roadmap.md`'s Phase 13 entry for the
full description.

## What happened this session (continuing from the App Config build earlier)

1. Founder course-corrected right after the #18/#19 commit shipped: schema-driven editing itself
   was never the problem, the always-visible ~125-field form was. Confirmed the new shape via
   `AskUserQuestion`: three-way Local/Workspace/User radio (not two — I'd misremembered), and
   restore **both** the per-project gear icon and a new global entry point.
2. Recorded the pivot as comments on issues #18 (partial reversal) and #20 (settled, expanded
   design) before dispatching, so the tracker reflects what actually happened.
3. Dispatched one build agent (brief/report: `.claude/work/prompt_report/settings_search_edit_
   prompt.md`/`_report.md`) — restored `settings.rs`/schema/types/api verbatim from git history
   (`940d66f~1`, the commit before deletion), built a new `SettingsSearchView.svelte` (search +
   one-field popover, never the old form), wired both entry points without disturbing the adjacent
   App Config feature.
4. Dispatched one independent cold audit (Opus; brief/report: `settings_search_edit_audit_
   prompt.md`/`_report.md`) — verdict: restore is genuinely verbatim, no cross-contamination with
   App Config, popover honestly gates to one field. Two findings:
   - **MEDIUM** (fixed): a tier with invalid on-disk JSON (`parseError` set) would have its write
     silently spread `{...null}` and clobber the rest of that file. Fixed directly: surfaced
     `parseError` as a popover warning, disabled the field/Save/Clear via `<fieldset disabled>`,
     plus a non-UI backstop in `writeTier` itself.
   - **LOW** (fixed): popover wasn't focused on open, so Escape only worked once a child input had
     focus. Fixed with a focus-on-open `$effect`.
5. Re-ran both verify gates after the fixes: `cargo test --lib` (47/47), `pnpm check` (0/0) — clean.

## Remaining before this ships

- **Live GUI verification not performed** across both builds this session (App Config + this one)
  — no Chrome browser-automation connection in this sandbox. Founder should before release:
  - Open global "⚙ Settings", search "model", confirm the popover shows only that field, only
    "User" selectable.
  - Open a project's gear icon, confirm Local/Workspace/User all appear, round-trip an edit.
  - Also re-verify the adjacent App Config flow (launch command, terminal, update toggle) — not
    touched this pass but worth a single combined visual sweep since both shipped close together.
- Issue **#22** (clipboard-fallback text vs. configured `launch_command`, filed during the App
  Config audit) is still open, LOW, not blocking.
- Prompt/report artifact pairs from both builds this session are still in the working tree
  (`.claude/work/prompt_report/appconfig_relaunch*`, `settings_search_edit*`) — commit alongside,
  `git rm` in a later cleanup pass once safely in history.

## Next candidate work (not started)

- **#21** (provider profiles / credential storage) — still blocked on the API-key-storage design
  question; now has both #19's env-var mechanism and this session's tier-radio UI pattern to build
  on if it goes that route.
- Consider closing #20 explicitly on GitHub now that its expanded design shipped (a "Fixes #20"
  in this commit will do it automatically once pushed/merged, if that's the intended flow — this
  repo commits straight to `main`, no PR, so closing needs either the commit trailer to auto-link
  or a manual close).
