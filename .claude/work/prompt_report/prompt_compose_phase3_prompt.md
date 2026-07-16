# Prompt Compose — Phase 3: compose-model rework + similarity threshold

## Why this work exists

Prompt Compose (repo: `/home/shane/workspace/prompt-compose`, github.com/zhangxingeng/prompt-compose)
just split out of ccdeck as its own product. Phases 1–2 moved the code; phase 3 is the founder's one
functional change plus the de-ccdeck cleanup. Two founder decisions drive the functional work — they
are settled, do not relitigate them:

1. **Compose model becomes editable tinted text.** Today an inserted snippet appears in the compose
   box as a chip (an atom with popup machinery). The founder wants inserted snippets to render as
   the snippet's *whole text*, freely editable in place, with a highlight/tint color indicating
   template provenance — "for now, this simple solution is what we want." Crucially there is **no
   link back to the library file**: once inserted, the text is just text with a tint. The reason is
   a defect class we're deleting — linked state between composed text and library files created
   divergence bugs; with no linked state the defect can't return. The library is written only via an
   explicit Save-as-snippet action, never as a side effect of editing composed text. The chip/popup
   machinery this replaces gets deleted, not hidden.
2. **Similarity threshold on the semantic match panel.** Founder verbatim: "we might want a
   threshold where we don't show the prompts that are below that similarity threshold. Otherwise,
   it's just always going to show all the prompts reordered, regardless of low similarity score."
   Under a non-empty query, hits below a similarity floor drop out instead of the whole library
   reappearing reordered. How the floor is chosen (fixed constant, score-gap heuristic, tunable) and
   what an all-filtered-out panel shows are your judgment calls — bring a recommendation to the plan
   gate.

## Your cast — steerable teammate, gated pipeline

You are a teammate under the iterative teammate protocol, not a one-shot worker. Read these two
docs before your first code-touching action (prompt-compose has no docs harness of its own, so the
paths point into ccdeck's corpus):

- `/home/shane/workspace/ccdeck/ai-first-docs/craft/workflow/teammate_execution_protocol.mdx` —
  your execution contract (deliver by explicit message, surface lane edges, hold gates as dialogue).
- `/home/shane/workspace/ccdeck/ai-first-docs/craft/workflow/git_protocol.mdx` — commit discipline
  (cohesive commits, Conventional Commits with a why-body, no session trailers).

The pipeline: **INVESTIGATE → STOP** (report a short plan: root-cause read of the current compose
model, chosen approach + why, files you'll touch, any decision you need) → lead approves or nudges →
**IMPLEMENT + COMMIT → STOP** (diff summary + commit refs + branch) → lead reviews the actual diff →
lead integrates. Label every stop: `working checkpoint` / `blocked on X` / `final result`. Do not
start implementing before the plan is approved — a bad plan caught at the gate costs one message;
caught after the build it costs a redo.

## Repo ground truth

- Work in `/home/shane/workspace/prompt-compose` — verify with `git rev-parse --show-toplevel`
  before any git operation (it's a sibling repo; your session starts in ccdeck).
- Expected base: `main` @ `5f31d23`, clean, in sync with origin. If reality differs, stop and say so.
- Create a branch `phase-3-compose` off that base and commit there, **append-only**: commit before
  every stop (even WIP), never amend/reset/rebase away a commit — your channel can be severed
  silently and committed work is the only artifact that survives. Never merge to main, never push;
  the lead owns integration, the push, and the post-push CI check.
- Tauri v2 + SvelteKit/Svelte 5 (runes) + a Rust backend with an embedding chain (semantic match is
  a kept feature — offline means user data never uploads, not no model).

## Scope

- **(a)** The editable-tinted-text compose model, replacing the chip/popup machinery (delete it).
- **(b)** The similarity threshold in the match panel.
- **(c)** Prune dead ccdeck-inherited CSS in `src/app.css` — rules orphaned by the split. Verify a
  selector is truly unreferenced before cutting it; the check suite won't catch a wrongly-deleted
  style.
- **(d)** The two contract docs — `project_docs/prompts-ux.md` and `project_docs/prompts-design.md`
  — still describe the chip model throughout (prompts-ux S5 and the insert/edit-chip flows;
  prompts-design's "why chips are atoms" section) and say nothing about a similarity floor. These
  docs are the product's behavioral contract, and the discipline is doc-first: amend the owning
  contract prose as part of this change, not as a later cleanup — a behavior change whose contract
  doc still describes the old design ships a doc that rationalizes drift. Titles were already
  renamed in `5f31d23`; don't redo that. Write your intended contract amendments at the plan gate —
  they double as the design spec the lead approves.

Out of scope: everything else. If you hit a defect outside this slice, fix it in-pass only if it's
small and single-file; otherwise flag it in your report (this repo's own GitHub issues via
`gh api repos/zhangxingeng/prompt-compose/...` REST — plain `gh issue` hits a broken-GraphQL 401 on
this machine).

## Verify before every stop

Run locally (Bash timeouts mandatory — an un-estimated command isn't well-written enough to run):

- `pnpm check` (timeout 120s)
- `cargo test --lib --manifest-path src-tauri/Cargo.toml` (timeout 300s)
- `pnpm run test:smoke` (timeout 120s)
- `pnpm build` (timeout 180s)

Also read `.github/workflows/ci.yml` once so your local suite matches what CI will run on push.

## Report

Write your final report to
`/home/shane/workspace/ccdeck/.claude/work/prompt_report/prompt_compose_phase3_report.md` (cap ~500
words): diffs touched (file | summary), tests run + results, **Compromises** (mandatory — every
shortcut, uncertain call made anyway, deferred item; "None — clean" only if truly clean), open
questions. Gate messages during the pipeline stay in-channel and short.
