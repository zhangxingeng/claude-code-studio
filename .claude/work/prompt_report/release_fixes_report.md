# ccdeck pre-release fixes — report (v0.14.0 gate)

Branch `release-fixes` off `a147937`, 4 commits, tree clean. Full suite green:
`pnpm check` 0 errors · `cargo test --lib` 48 passed, 0 warnings · `test:smoke`
12 assertions · `pnpm build` OK · e2e 9 passed (2 new fork specs).

## Item 1 — dead fork button (`38d6b5a`)
**Root cause (proven, not reasoned):** a self-close race. The fork wiring was
already complete — it forks, then opens `ResumeMenu` with the copyable
`claude --resume` line. But `ResumeMenu` mounts a `<svelte:window onclick=
{onClose}>` outside-click guard, and the *same click* that opened it bubbled to
window and closed it before paint. A Playwright probe with source logging
showed `setMenu` immediately followed by `close`. The sibling header Resume
button (`+page.svelte`) already dodges this with `e.stopPropagation()`; the fork
handler didn't. Fix mirrors the sibling. Broken **everywhere**, not dev-only.
Output stays a displayed copyable command (no console invocation) — already the
design; it just never painted.

## Item 2 — fork/delete overlap (`38d6b5a`)
The ⑂ floated top-right, the delete ✕'s corner. Moved into the right gutter
outside the bubble, mirroring the select-checkbox's left gutter (`-1.35rem`),
hidden in select mode. Clip at the 640px min width is identical to the existing
checkbox (8px, verified); zero clip above 640px.

## Item 3 — remove View File (`496befd`)
Deleted button, `viewFile()`, `fileOpenError` toast, and the `openSessionFile`
wrapper. No Tauri command existed (it called the opener plugin directly); the
plugin stays — `+layout.svelte` uses it for external links.

## Item 4 — divider bubble — **DONE** (`f884c20`)
Contained CSS+markup, stayed in the time-box. The bare hairline gained a small
node bubble centered on the rule (a ⌄ at the turn's content). Hover
Delete/Restore-turn unchanged; delete-editing e2e still passes.

## Item 5 — #38 backup restore (`8614395`)
Kept the pre-save snapshot untouched. Cut `listBackups`/`restoreBackup`
(api.ts) and `list_backups`/`restore_backup` Tauri commands + handler entries.
README's "one-click restore" corrected to the truth (snapshot on disk,
restore-by-hand); save-dialog wording was already truthful, left alone.

## Compromises
- `list_backups_at` had no dedicated tests to delete; the *snapshot* tests
  legitimately read a snapshot back through it, so I gated it `#[cfg(test)]`
  (test helper) rather than delete it. `legacy_backups_dir` kept (migration
  uses it); orphaned `devBackups` dev store removed.
- Item-2 min-width clip is inherited from the mirrored checkbox convention, not
  eliminated — matching the lead's "mirror its constraints" call.
- Browser extension wouldn't connect; all verification ran headless via
  Playwright instead.
