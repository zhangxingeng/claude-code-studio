# Quality fix wave — three escalations from the scan wave

## Why

A four-region quality scan of ccdeck just landed its local fixes (uncommitted in the working tree —
that's expected state, don't be surprised by a dirty tree and do NOT revert or commit anything; the
lead commits at the barrier). Three findings crossed region boundaries and were escalated fix-ready.
You are the fix worker for all three; they share the search surface, so one cold read covers them.
Work in `/home/shane/workspace/ccdeck` on the checked-out `v0.14-core-refocus` branch.

## The three fixes

1. **Extract duplicated search-highlight helpers.** `Seg`, `highlight()`, `hitKey()`, and
   `sourceBadge()` are byte-identical in `src/lib/components/BrowseView.svelte` and
   `src/lib/components/InlineSearchPanel.svelte` (the scan already trimmed dead `sourceBadge`
   branches in both — verify they're still identical post-trim). Move them to a new
   `src/lib/searchHighlight.ts` and import in both. Pure move, no logic change; keep the existing
   comments with the code. Note `highlight()` slices with `Array.from` because the Rust side emits
   code-point offsets — that comment is load-bearing, keep it.
2. **Kill the doubled `listSessions()` IPC per browse mount.** BrowseView fetches the session list
   itself AND `initSearch` (`src/lib/search.svelte.ts`) fetches it again just to build project-chip
   options. The chips already self-heal via the `$effect` in BrowseView calling
   `setProjectOptions(sessions, homeDir)` whenever enrichment lands, so `initSearch`'s own
   fetch is redundant on the browse path. Decide the cleanest seam (likely: drop the fetch from
   `initSearch` and let callers pass or push options) — but check the OTHER `initSearch` call sites
   first (the in-session search panel opens search without BrowseView's effect); the project chips
   must still populate there. Don't break that path to save one IPC on this one.
3. **`cold_match` offset bug in `src-tauri/src/search/query.rs`.** It computes byte offsets on
   `text.to_lowercase()` and slices them into the original `text`; `to_lowercase()` can change byte
   length (e.g. 'İ'), so slices can misalign or panic on a non-char boundary. Decision made — use
   `to_ascii_lowercase()` for the haystack AND the needle: byte-length identical to the original by
   construction, so offsets are always valid, and a panic in the cold tier is worse than the recall
   we lose (non-ASCII case-insensitive matches degrade to case-sensitive in the cold tier only; the
   warm tantivy tier keeps its own lowercasing). Document that tradeoff in a comment where the
   folding happens, and add a regression test with a length-changing Unicode needle/haystack
   (e.g. 'İstanbul') proving no panic and sane offsets.

## Verify, then report

`pnpm check` (timeout 120s), `cargo test --lib --manifest-path src-tauri/Cargo.toml` (timeout
300s), `pnpm run test:smoke` (timeout 120s). All three must be green — the tree already carries the
scan wave's fixes, so a failure may not be yours; diagnose before touching anything outside the
three fixes above, and if it isn't yours, stop and report rather than fixing around it.

Report to `.claude/work/prompt_report/quality_fix_wave_report.md`, cap ~300 words: what moved/changed
per fix, test results, Compromises (mandatory), anything you chose differently from this brief and
why.
