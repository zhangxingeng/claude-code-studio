# Quality scan — ccdeck-rust region

Region: `src-tauri/src/**`, `src-tauri/Cargo.toml`. Read cold in full.
Checks after fixes: `cargo test --lib` → **47 passed, 0 failed**; `cargo clippy --lib` → **0 warnings** (was 5).

## Local fixes applied

- **lib.rs `enrich_sessions`** — data-loss fix (see Suspected bugs). Read failure no longer
  falls open to an empty scan that the cleanup pass would delete; unreadable files are now skipped.
- **search.rs** — removed the entire top-level `#[allow(unused_imports)] pub use db/extract/index/query::*`
  re-export block. Verified dead: every `search::<sym>` path grepped to NONE outside search.rs; all real
  callers use `db::`/`index::`/`query::`/`super::`. Kept `pub mod state;` (live). Orphan surface behind an `allow`.
- **state.rs + index.rs** — cut the dead `Indexer::remove_one` → `index::remove_from_index` chain.
  `remove_one` was `#[allow(dead_code)]` ("no caller yet"); it was the only caller of `remove_from_index`.
  Speculative future code for a delete-session feature that doesn't exist. (Judgment call — see Compromises.)
- **extract.rs:52** — stale/lying comment: "a row-to-be in the `blocks` table". The SQLite `blocks` table
  was removed (issue #5, content moved to tantivy). Rewritten to describe the tantivy staging.
- **Clippy (all 5, all real):** db.rs lock-file open → explicit `.truncate(false)` (advisory-lock target,
  never truncate); lib.rs `splitn(2,'-')` → `split_once('-')`; lib.rs `sort_by` → `sort_by_key(Reverse)`;
  state.rs `iter().any(|p| *p==project)` → `contains(&project)`; query.rs `cold_match` return type →
  new `pub type ColdMatch` alias (cleared `type_complexity`, improves the state.rs call site too).

## Suspected bugs

1. **`enrich_sessions` deleted real files on read failure (FIXED).** The junk-cleanup pass folds into the
   enrichment walk. Old code: `let content = fs::read_to_string(&file_path).unwrap_or_default();`. A file
   that exists (so `mtime` is `Some`) but can't be read as UTF-8 — invalid bytes, a transient I/O error —
   yielded `""`, which `scan_session_lines` reports as zero turns / no title. `should_cleanup` then sees
   empty + untitled + (if >15 min old) stale = eligible, and `fs::remove_file` **deletes the real session
   file** irreversibly (browse cleanup takes no backup). This is precisely the wave's "fail-open-to-empty =
   silent data loss" class. Fix: `let Ok(content) = fs::read_to_string(&file_path) else { continue };` —
   an unreadable file stays an un-enriched stub; a genuinely empty 0-byte file still reads `Ok("")` and
   remains eligible, so the feature is preserved. No test covered the enrich read path (unit tests hit
   `is_cleanup_eligible`/`should_cleanup` purely), so this was invisible to the suite.

2. **`query.rs::cold_match` mixes lowercased-string byte offsets into the original string (NOT fixed —
   flagged for a design call).** It computes `lower = text.to_lowercase()`, finds token positions and
   window bounds (`win_start`/`win_end` via `floor_boundary`/`ceil_boundary`) in **`lower`-space**, then
   slices those offsets into the **original `text`**: `&text[win_start..win_end]` (line ~403) and
   `text[win_start..s]` (line ~418). `str::to_lowercase` is documented to change length for some chars
   (e.g. 'İ' U+0130 → 2 chars). Any such char before the match desynchronizes the two byte layouts, so the
   `text[..]` slices can cut wrong bytes or **panic** on a non-char-boundary. Only reachable in the cold
   tier (sessions not yet indexed — first-launch / post-rebuild window) and needs length-changing Unicode
   before the match, so low probability but a real latent panic. Fix options, each a tradeoff worth a
   decision: (a) `text.to_ascii_lowercase()` — byte-length-preserving, so offsets are always valid, but
   loses non-ASCII case-folded matches (tokens are full-Unicode-lowercased by tantivy's `LowerCaser`, so
   "café" wouldn't match "CAFÉ" cold); (b) keep `to_lowercase()` for matching but build snippet/ranges from
   a lower→text char-offset map (behavior-preserving, more code). Left for the lead since it's a
   correctness-vs-recall tradeoff, though it's region-local if you want it fixed in place.

## Wide escalations

None. All fixes stayed within `src-tauri/src/**`; no shared contract, Tauri command signature, or
Rust↔JS boundary touched (the removed re-exports and dead methods had zero external callers).

## Compromises

- **Cutting `remove_one`/`remove_from_index` is a judgment call.** They're coherent, documented, dead-by-
  annotation code kept as a "deletion counterpart to reindex_one" for a delete-session feature that doesn't
  exist. I cut them per "lean beats impressive-and-idle" and the founder's subtraction mandate; if a delete
  feature is actually on the roadmap, `git revert` restores a correct primitive. Easy to undo — flagging so
  the lead owns the call.
- **cold_match Unicode bug verified by reasoning, not a reproduction.** I did not stand up a repro binary;
  the argument rests on the documented length-changing behavior of `to_lowercase` plus the offset-space
  mixing visible in the code. Confidence high on the defect, deliberately deferred on the fix.
- **`type_complexity` (query.rs) is the one borderline-pedantic clippy lint I fixed** — a `type` alias is a
  net readability win here and clears the warning, so I judged it worth doing rather than `#[allow]`-ing.

## Out-of-scope observations

- **Cargo.toml `version = "0.13.2"`** while the branch is `v0.14-core-refocus` — expected (the release
  version bump is its own step; see the cut-release skill). Not slop, noting for the release step.
- **`state.rs` cold-tier `summary.scanned`** semantics differ between tiers: warm sets it to the tantivy
  total-match count; cold does `+= 1` per *emitted* (limit-bounded) hit. The `SearchSummary::scanned` doc
  says "total matching blocks before limit truncation", which the cold path doesn't honor. Cosmetic (drives
  a coarse UI counter only) — not fixed, noting.
- The two session-file walkers — `lib.rs::collect_session_files` and `index.rs::session_files` — are
  near-identical (same skip rules: `subagents`/`tool-results` dirs, `agent-*.jsonl`, non-`.jsonl`). They
  live in different regions' mental models (browse vs. search) and each has its own tests; unifying them
  would be a cross-concern refactor, not a clean local cut. Noting as duplication, not escalating.
