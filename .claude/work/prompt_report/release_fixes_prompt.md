# ccdeck pre-release fixes — founder feel-check punch list (v0.14.0 gate)

## Why

The founder feel-checked the app and green-lit the 0.14.0 release behind a short fix list. These are
the last code changes before the release is cut, so quality bar applies in full — no shortcuts that
would need re-touching post-tag. Repo: `/home/shane/workspace/ccdeck`, branch `v0.14-core-refocus`
(checked out; clean tree at `a147937`). You are a steerable teammate: **investigate → STOP with a
short plan → lead approves → implement + commit (append-only, on a branch `release-fixes` off the
current HEAD) → STOP with diff summary**. Read
`/home/shane/workspace/ccdeck/ai-first-docs/craft/workflow/teammate_execution_protocol.mdx` before
your first code action if you haven't been cast this way before.

## The punch list (founder's words paraphrased, his intent in bold)

1. **Fork-from-here must work, and its output is a displayed command — never a console invocation.**
   Today the fork button "doesn't do anything" when he clicks it (he was on the web/`pnpm dev` build;
   check whether it's broken there only, or everywhere). Desired behavior: clicking fork performs the
   existing truncated-duplicate-jsonl fork, then **shows the new session's resume command as copyable
   text** — the same interaction pattern `ResumeMenu.svelte` already ships (popover with the
   `cd '<project>' && claude --resume '<id>'` line, path, id). His reasoning, keep it in the code
   where relevant: "We want to be simpler; integrating with different consoles for different
   platforms is a pain not worth having." In the browser/mock build, follow whatever convention the
   existing api.ts mock fallbacks use (disabled-with-reason or mock-backed — match the codebase, do
   not invent a third pattern).
2. **The fork button overlaps the delete (cross) button — move it.** Find a placement that can't
   collide; this is his second complaint about the same control, so treat placement as part of the
   fix, not cosmetics.
3. **Remove the "View file" button completely.** His call: "no use." Delete the control and any
   now-orphaned handler/CSS; if a Tauri command exists solely for it, cut that too (grep for other
   callers first).
4. **Best-effort, explicitly optional:** the delete-turn affordance is "a horizontal line which
   doesn't really show the layer" — he suggests "some little bubble" that shows structure better.
   His exact framing: "If you can fix it, great. If not, don't worry about it." Time-box this: if a
   clean small change presents itself at investigation, plan it; if it balloons, skip it and say so.
5. **Resolve issue #38 (backup restore) in the subtraction direction.** Decision context: the
   founder was shown the fork (wire restore back vs retire) and answered with a message whose whole
   theme was "simpler"; he uses the app and has never missed restore. So: **keep the silent
   pre-save `.bak` snapshot exactly as is** (it's real insurance, filesystem-recoverable), **delete
   the dead `listBackups`/`restoreBackup` wrappers (api.ts) and the `list_backups`/`restore_backup`
   Tauri commands + their tests** (zero UI callers — verified by the sweep), and **fix the copy that
   over-promises**: README's "one-click restore" line and check SessionEditor's save-dialog wording
   still tells the truth (a snapshot IS saved; only "restore in-app" was the lie). Carry the why in
   the commit body: history preserves the code if a restore UI is ever wanted back.

## Ground rules

- Behavior beyond this list is frozen — this is a release gate, not an improvement pass.
- Full suite before each stop: `pnpm check` (120s), `cargo test --lib --manifest-path
  src-tauri/Cargo.toml` (300s), `pnpm run test:smoke` (120s), `pnpm build` (180s).
- Never touch `CLAUDE.md`, `.claude/memory/`, `.claude/system_prompt_append.md`, `ai-first-docs/`.
- Commit per cohesive concern (fork rework / view-file cut / #38 / divider), Conventional Commits,
  the why in the body. No pushes; the lead merges.
- Out-of-slice defects: small+local → fix and disclose; else flag in the report.

## Report

`.claude/work/prompt_report/release_fixes_report.md`, cap ~400 words: per-item outcome (incl. the
root cause of the dead fork button), tests, **Compromises** (mandatory), whether item 4 was done or
skipped and why.
