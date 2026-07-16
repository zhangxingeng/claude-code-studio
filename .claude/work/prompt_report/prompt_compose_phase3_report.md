# Prompt Compose Phase 3 — final result

**Branch:** `phase-3-compose` (off `main @ 5f31d23`). **Commits (5f31d23 → HEAD):**

| SHA | Summary |
|---|---|
| `bd7a566` | feat(compose): replace chip atoms with editable tinted text |
| `1cd73de` | feat(match): drop hits below a relevance floor under a query |
| `3d67ca9` | refactor(css): prune dead ccdeck-inherited styles |
| `7813934` | docs(contracts): rewrite chip model as tinted text; document the floor |

## Diffs touched

| File | Summary |
|---|---|
| `compose/doc.ts` | Doc = flat `text`\|`tint` nodes (both editable text). Deleted ChipNode/cid/ZWSP/chip transforms/`toRenderNodes`. New `insertSnippet` (returns doc+caret), `caretAtGlobalOffset`, tint-aware `fromRawNodes`. |
| `ComposeBox.svelte` | Renders tint spans (editable); reads back by `.tint` class; caret placed after the span to prevent tint-bleed. Deleted chip element, click→popup, chip-aware `oncopy`/`selectionText`. |
| `prompts.svelte.ts` | `composeInsertSnippet(content)`; `pendingCaret: Caret`. Deleted use-once/save/dissolve transforms + the now-unreachable store `deleteSnippet`. |
| `PromptsView.svelte` | Dropped `openChip`/`onOpenChip`; `+` create flow kept. |
| `SnippetModal.svelte` | Reduced to create-only (Save-as-snippet): Name/Content/vars, Save/Cancel. Deleted chip-edit/Use-once/Delete/dirty. |
| `VariableFillList.svelte` | Comment-only (chip → flattened text). |
| `state.rs` | `MATCH_MIN_SCORE=0.2` floor in `fuse` (query-path only, exact-exempt) + 3 tests. |
| `app.css` | Pruned viewer/session/tool/print CSS + orphaned tokens (grep-verified). |
| `prompts_smoke.mjs`, `prompts-ux.md`, `prompts-design.md` | Rewrote node-model/round-trip tests and chip prose; documented the floor. |

## Tests run

`pnpm check` 0 errors · `pnpm test:smoke` all pass · `cargo test --lib` 48 pass · `pnpm build` OK. (CI matched: `.github/workflows/ci.yml` runs exactly these.)

## Compromises

- **Runtime not driven.** The contenteditable behavior (tint-span editing, caret placement, tint-bleed avoidance) is unit-tested only at the pure-data seam (`doc → render-sim → readback → doc` identity). The live browser/Tauri interaction was **not** exercised — the four required gates don't cover it. Recommend a manual pass on insert/edit/caret before integration.
- **Edit/delete gap (approved).** No in-app way to edit or delete an existing snippet; it's a filesystem action now. Founder feel-check item — a library-row edit affordance is the add-back if it hurts.
- **Tint-bleed is best-effort.** Post-insert caret is dropped after the span to keep continuation text untinted, but typing *into* a tint boundary can still extend it. Text is always preserved (round-trip invariant); only the tint flag can drift. Accepted as "simple for now."
- **Removed store `deleteSnippet`** (unreachable after the popup delete was cut). The api.ts mirror + Rust `delete_snippet` command remain.

## Pre-existing doc staleness — listed for the doc-maintainer sweep (not chased, per decision 4)

- **`prompts-design.md` §"Copy output — the per-variable as-variable toggle" (~L160–199)** describes the **cut** as-var toggle, including a wrong signature `copyText(text, fills, asVars)` (actual: `copyText(text, fills)`) and ON/OFF modes. Reality: always-hoist. This is the biggest remaining item — a whole section + wrong signature. I left it because it sits outside the sections I rewrote; it needs a full rewrite.
- I *did* opportunistically fix the smaller as-var / Ctrl+S / "both copy modes" staleness where it sat inside sections I was already rewriting (ux S7/S8/surface/hotkeys, design rule 5).

## Open questions

None blocking. Awaiting your diff review + integration (I did not merge or push).
