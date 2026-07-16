# Quality scan — prompt-compose region

Repo: `/home/shane/workspace/prompt-compose` @ `d08ff93` (verified). Read every source file
cold: frontend (`src/**`), Rust (`src-tauri/src/**`), config, tests, `app.css`, `app.html`.

**Verdict up front:** this is an unusually clean, heavily-tested codebase. No dead Tauri commands,
no orphaned api.ts wrappers, no unused deps (every Cargo + npm dep traces to a live use), no
ccdeck-flavored appstate/store code. The split and the phase-3 compose rework left only stale
comments and one real bug. All four checks pass after my edits.

## Local fixes applied

- **`src/lib/theme.ts` — genuine bug.** `getTheme()` defaulted to `'light'` when no theme is
  stored, but `app.html`'s pre-paint bootstrap falls back to `prefers-color-scheme`. On a dark-OS
  user with no saved preference the page renders dark while the toggle label reads "Light" and the
  first click is *eaten* (sets dark-over-dark, no visible change; only the label flips). Fixed
  `getTheme()` to consult `prefers-color-scheme`, matching the bootstrap exactly. Behavior-preserving
  for anyone with a saved theme (the common case). Also now guards against a garbage stored value
  (previously `as Theme` cast it through unchecked).
- **`src/lib/prompts.svelte.ts` — split/rework leftovers in comments.** (1) Header cited
  "same idiom as **search.svelte.ts**" — that file is a ccdeck-only artifact, absent here; reworded
  to state the idiom directly. (2) `setFill` doc said a value shows "in every **chip's** popup" and
  (3) `copyOutput` said "typed text + every **chip's** BODY" — chips were deleted in phase 3;
  reworded to "the Save-as-snippet popup" and "the box's flattened text, typed and tinted runs alike".
- **`src/lib/components/prompts/MatchPanel.svelte`** — two stale chip references: "Hover-reveal is
  the rule everywhere (chip, row)" and CSS comment "same pattern as the compose box's **chip
  preview**". No chip surface exists post-phase-3; reworded to the library row.
- **`src/lib/components/prompts/ProjectTabs.svelte`** — `openMenu` called `e.stopPropagation()` with
  a comment guarding against "the app-wide **CopyContextMenu** (a `svelte:window` contextmenu
  listener)". That component and listener do not exist in this repo (grep-confirmed: the only
  contextmenu handler is the tab's own `oncontextmenu`) — a pure ccdeck leftover. Removed the
  orphaned call + comment; `e.preventDefault()` (native-menu suppression) is what actually matters
  and stays. Behavior-neutral: nothing upstream listens for `contextmenu`.

## Wide escalations

None. The whole repo is this region, so every fix stayed in-bounds. The Rust↔TS command seam
(`api.ts` ↔ `prompts/state.rs`) is consistent — same 10 commands, matching payload shapes.

## Suspected bugs

- The theme mismatch above (fixed) is the one concrete "reads plausible, behaves wrong" defect —
  a strong candidate for the founder's unnamed-bugs bet. No other logic bug found: the fusion floor,
  at-rest ordering, path-escape validation, per-project cache scoping, and the contenteditable
  round-trip are all directly test-covered and correct on read.

## Compromises

- `stopPropagation` removal verified by grep (no `contextmenu`/`svelte:window` listener anywhere in
  `src/`), not by running the desktop shell. High confidence — the handler simply isn't there.
- The theme fix's runtime path (dark-OS, no stored key) was reasoned through, not exercised in a real
  webview; `pnpm check` + `pnpm build` pass and the logic now mirrors app.html line-for-line.
- Comment-only edits otherwise; no behavior touched.

## Out-of-scope observations

- **Layout tension (pre-existing, not a cut orphan):** `.container-main` caps at `max-width:820px`,
  but with the library panel expanded AND a variables column present, the flex children's min-widths
  (`15.5rem + 22rem + 15.5rem` + gaps ≈ 880px) exceed it — can force horizontal overflow on a wide
  window. Design call, left alone per "no UX changes".
- `SnippetModal`'s `SnippetModalContext.name?` is a latent prefill capability with no caller (the
  only entrance, `createSnippet`, passes `{ content: '' }`). Harmless; not cut since it's one field
  and the modal genuinely supports naming.

## Checks (all pass)

`pnpm check` (0 err/0 warn) · `cargo test --lib` (exit 0) · `pnpm run test:smoke` (exit 0) ·
`pnpm build` (exit 0).
