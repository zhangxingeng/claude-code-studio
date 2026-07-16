# Quality fix wave — report

All three escalations applied on `v0.14-core-refocus`. No files touched outside the three fixes.

## Fix 1 — extract duplicated search-highlight helpers
Verified `Seg`, `highlight()`, `hitKey()`, `sourceBadge()` were byte-identical post-trim in
`BrowseView.svelte` and `InlineSearchPanel.svelte`. Moved all four to new
**`src/lib/searchHighlight.ts`** (exported), imported in both components. Pure move. Kept the
`sourceBadge` #35 comment; added the load-bearing rationale comment on `highlight()`'s `Array.from`
(the code carried none inline — the offsets-are-code-points reason lived only on the Rust `SearchHit`
doc, so I wrote it explicitly into the shared fn). Removed the now-unused `SearchHit` type import from
InlineSearchPanel.

## Fix 2 — kill doubled `listSessions()` per browse mount
Dropped the `Promise.all([listSessions(), homeDir()])` + `setProjectOptions` from `initSearch`
(`search.svelte.ts`), plus the now-unused `listSessions`/`homeDir` imports. BrowseView already pushes
options via its enrichment `$effect`, so the browse path is unaffected (and its lossy-stub self-heal
still runs). Checked both call sites: the only other caller, InlineSearchPanel, renders **no project
chips at all** ("just a query box"), so it never needed the options — nothing to break there.
Rewrote the `initSearch` and `setProjectOptions` doc comments to match the new ownership.

## Fix 3 — `cold_match` offset bug (`query.rs`)
Swapped `text.to_lowercase()` → `to_ascii_lowercase()` for the haystack, and ASCII-fold the needles
too. Byte-length-identical folding keeps computed offsets valid against the original `text`.
Documented the tradeoff (non-ASCII case-insensitivity degrades to case-sensitive in the cold tier
only; warm tier unaffected; a panic is worse than lost recall) in a comment at the fold site. Added
regression test `cold_match_survives_length_changing_unicode_and_keeps_offsets_sane` using 'İstanbul'
(U+0130) — proves no panic and that the highlighted range maps back to the correct substring across
the two-byte char, plus that an 'İ'-only needle now cleanly returns `None`.

## Verify
- `pnpm check`: 0 errors, 0 warnings (224 files)
- `cargo test --lib`: 48 passed, 0 failed (incl. the new test)
- `pnpm run test:smoke`: all assertions passed

## Compromises
- Fix 1's `Array.from` comment: the brief said "keep the existing comment," but no such comment
  existed inline in either component (the rationale lived only on the Rust side). I authored one in
  the shared module rather than leaving the invariant undocumented. Flagging since it's an addition,
  not a verbatim move.
- Nothing else diverged from the brief; the dirty working tree from the scan wave was left untouched.
