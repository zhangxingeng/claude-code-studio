# Quality scan — ccdeck-core

Region: `src/lib/*.ts` + `src/lib/*.svelte.ts` (top level), `src/lib/mocks/**` (does not exist), `tests/**`.
Checks: `pnpm check` → 223 files, 0 errors/0 warnings. `pnpm run test:smoke` → all 7 suites pass (after the deletion below).

The region is in good shape — heavily documented, well-tested, and the v0.14 cut-explanation comments (terminal launcher / provider profiles in resume.ts, api.ts, types.ts) are intentional reasoning, not orphans. One dead module found and removed; two things cross my boundary.

## Local fixes applied

- **`src/lib/jsonHighlight.ts` — deleted (fully orphaned).** `highlightJson` / `isLongMarkdownish` and the whole module have zero importers anywhere in the repo (`src/`, `tests/`, `e2e/`, verified by grep). It rendered tool_use inputs as syntax-highlighted JSON; issue #14 made tool_use show only a one-line intent brief (toolIntent.ts: "NEVER raw JSON"), which killed the only caller. `pnpm check` + `test:smoke` still green after removal. (Staged via `git rm`, not committed — per wave rules.)

## Wide escalations (fix-ready)

- **Dead JSON-token CSS, orphaned by the deletion above → `src/app.css` (no region owner; ccdeck-ui is components/routes only).** Delete `src/app.css:238-243` (the `/* JSON syntax token colors (see src/lib/jsonHighlight.ts) */` comment + `.jt-key/.jt-str/.jt-num/.jt-bool/.jt-null` rules) and the now-unused custom props `--jt-str/--jt-num/--jt-bool` at lines 54-56 (light) and 77-79 (dark). No `.jt-*` class is referenced by any component (grepped). Crosses my boundary because app.css isn't in my file set.

- **`listBackups` / `restoreBackup` are dead on the JS side → api.ts (local) + `src-tauri/src/lib.rs` (Rust region) + a design call.** `api.ts:149` `listBackups` and `api.ts:154` `restoreBackup` have zero callers in `src/`/`tests/`/`e2e/`. Their Rust counterparts `list_backups`/`restore_backup` (lib.rs:669/715, registered lib.rs:1129-1130, and `list_backups_at` is unit-tested) are invoked only through these wrappers, so cutting the JS side orphans the Rust commands too. `snapshot` (single-slot backup on Save) IS still used by SessionEditor.svelte, but nothing ever lists or restores that backup — so the on-disk `.bak` a user's Save creates is currently unreachable. Escalated rather than cut because it spans the Rust region and "should a backup-restore path exist at all" is a design decision I don't own. If removed: also drop `devBackups` (api.ts:33) and simplify `snapshot`'s dev branch (api.ts:136-144), which only feed the dead `listBackups`.

## Suspected bugs

None that compute wrong. The rewritten loading (browseLoad.ts / api.ts tiers) and search (search.svelte.ts) code is internally consistent: `searchId`/`enrichId` supersession guards hold, `seen`-set dedup keys are unique per block, limit-reset is applied on every filter change except `loadMore` (correct — it grows the page). Reasoned through the superseded-search, load-more re-scan, and poll-status paths; no silent-failure or wrong-result path found.

## Compromises

- The two escalations are **verified only by grep** (`src/`, `tests/`, `e2e/`, and Rust for the command names) — no dynamic/string-built import could hide a caller, but I read no evidence of one.
- Did **not** touch the three near-duplicate metadata extractors (`parser.extractMeta`, `builder._deriveSessionMeta`, `editDraft.extractSessionInfo`). They look like duplicated machinery but each operates on a different input shape/surface (browse preview lines, export Session, editor info panel) and `_deriveSessionMeta` skips `cleanTitle` where extractMeta applies it — consolidating risks a behavior change on shipped installs for little gain. Left as-is deliberately.

## Out-of-scope observations

- `package.json:4` description still reads "browse history, **edit settings, and launch it your way**" — both the settings editor and terminal launcher were cut in v0.14. Stale (root file, no region owner).
- `parser.ts` `META_TYPES` filters `ai-title` but not `custom-title`/`agent-name` (the entries sessionOps.ts now writes on rename), so parseJsonl emits them as empty-block entries. Harmless downstream (no consumer surfaces them), so not fixed — but adding them to `META_TYPES` would be marginally cleaner if a future pass wants it.
