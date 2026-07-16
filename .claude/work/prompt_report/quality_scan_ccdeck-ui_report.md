# Quality scan — region ccdeck-ui (`src/lib/components/**`, `src/routes/**`)

Branch `v0.14-core-refocus`. All 14 components + 3 route files read cold. `pnpm check` → 0 errors / 0 warnings; `pnpm build` → clean.

## Local fixes applied

- **BrowseView.svelte** | removed dead `scheduleSearch` import — it was in the import list only, never called (setQuery/loadMore/etc. invoke it internally inside the store). Confirmed by grep: sole reference was the import line.
- **BrowseView.svelte + InlineSearchPanel.svelte** | trimmed dead `sourceBadge` branches (`thinking`/`tool_use`/`tool_result`) and the now-unused `.b-think` / `.b-tool` / `.b-res` CSS. These are orphans of the messages-only search cut (#35): the Rust indexer only ever emits `source` of `user`/`assistant` — asserted by its own test (`src-tauri/src/search/extract.rs:253` "only user/assistant sources are indexed"). Kept the `default` case as a safety net + a comment recording the invariant.
- **routes/+page.svelte** | two stale/lying comments fixed: `goAppConfig` claimed "launch command / terminal / update toggle are app-level preferences" (launcher + launch-command removed in #34 — only the update toggle remains); `focusSearchPending` referenced "App Config/Settings close" (the Settings view is gone). Comment-only, no behavior change.
- **ResumeMenu.svelte** | doc comment referenced a deleted component (`ProviderResumeMenu`) as a positioning-pattern sibling; dropped that name, kept `CopyContextMenu`.

## Wide escalations

- **Duplicated search helpers → shared module (core region).** `Seg` interface, `highlight()`, and `hitKey()` are byte-identical in `BrowseView.svelte` and `InlineSearchPanel.svelte`; `sourceBadge()` is identical after my trim. Fix-ready: create `src/lib/searchHighlight.ts` exporting `type Seg`, `highlight(snippet, ranges)`, `hitKey(hit)`, `sourceBadge(source)`, then import in both components and delete the local copies. Crosses my boundary because the new file lives in `src/lib/*.ts` (ccdeck-core write authority). Low risk — pure pluck-and-move, no logic change. (Scoped-hit `id=` prefixes differ — `hit-` vs `ics-hit-` — those stay in each template; only the pure helpers move.)

## Suspected bugs

None confirmed in this region. Two candidates investigated and **dismissed**:
- `highlight()` offset units: it slices the snippet with `Array.from()` (code points) using `matchRanges`. Checked the Rust contract — `query.rs` builds ranges via `fragment[..r.start].chars().count()` (also code points / Unicode scalar values). They agree, so astral/multi-byte chars before a match do NOT misalign the highlight. Correct.
- Search reactivity / focus-reset `$effect`s in BrowseView + the tier1→tier2 enrichment flush path read as correct (Map insertion order = recency, throttled flush, superseding `enrichSeq`/`searchId` guards all present).

## Compromises

- The `sourceBadge`/CSS cut is verified dead by the backend's own test assertion, not by exhausting every Rust emit path — I trusted the `#35` invariant + that test rather than re-deriving the indexer. Kept the `default` branch so an unexpected source still renders (raw label, generic style) instead of vanishing.
- The duplication escalation is judgment, not forced — the two copies work fine as-is; I flagged rather than reached across the boundary to dedupe.

## Out-of-scope observations

- **Redundant tier-1 load (efficiency, core region).** `BrowseView.onMount` calls `listSessions()` directly, then calls `initSearch()` which calls `listSessions()` again — two identical stat-only IPC round-trips per browse mount. Not a correctness bug; the store needs its own list for project chips. A fix would let BrowseView hand its stubs to the store (touches `search.svelte.ts`), so it's core's call.
- `openSession` threads a full decoded path as `meta.project` while `openHit` threads the `~/…` home-relative label — the viewer subtitle shows different project strings depending on entry point. Cosmetic only.
- `exitSaveCopy` (SessionEditor) awaits `saveAsCopy()` then `onExit()` immediately — the "Saved a copy" toast fires against a component about to unmount. Pre-existing, harmless (existing pattern across the editor's exit flows).
