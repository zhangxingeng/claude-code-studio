# Quality/slop scan wave — v0.14 round (shared wave brief)

## [BOTH] Why this work exists

The founder ordered a full quality review of ccdeck and its new sibling prompt-compose after the
v0.14 refocus: "there's a lot of slop in our code." The round just deleted ~7k lines of features
(settings editor, provider profiles, terminal launcher, sort/source filters, the whole prompts tree
moved out) and rebuilt loading and search — deliberate subtraction that predictably leaves orphans.
The founder also deliberately did NOT name the bugs he knows exist: the bet is that on a clean
codebase they become obvious. So this scan has two products: a cleaner tree (local fixes applied),
and a fix-ready backlog of wide findings — including any real bugs you spot.

Ground rules that shape every call:

- **Best practices are the north star.** Community-standard Svelte 5 (runes), TypeScript, Rust, and
  Tauri v2 idiom outrank local precedent — if existing code disagrees with the standard, the code is
  the slop.
- **Both apps have shipped users** (ccdeck releases; prompt-compose is public). A behavior change is
  a migration, not a free rewrite — quality fixes preserve behavior unless the behavior is a genuine
  bug, and then the bug is the finding, stated as one.
- **Never go green by hiding a failure.** A blanket catch or fail-open-to-empty ships silent data
  loss that reads as "no results." Swallowed errors ARE slop; flag or fix them, never add one.
- **Lean beats impressive-and-idle.** Unused exports, dead branches, config for features that no
  longer exist — cut them (verify unreferenced first; grep is cheap, a wrong cut isn't).

## [BOTH] What "slop" means here (the scan lens, not a checklist)

Orphans of the cuts (code/CSS/comments/deps/commands referencing deleted features); duplicated
machinery (two functions 90% alike because refactoring was harder than copying); monkey-patches
(a code path whose only reason is "the existing thing didn't quite work" — the existing thing's
bug); error swallowing; stale or lying comments; dead config keys and unused dependencies;
un-idiomatic patterns (Svelte 4 idioms in runes code, `any` leaks, needless `clone()`s, stringly
typing); layering inversions (a primitive reaching back up into its caller's layer); and genuine
bugs — logic that reads plausible but computes wrong. Judge by whether a future agent reading the
file would learn the right pattern.

## [BOTH] Escalation boundary — fix local, escalate wide

Fix **local** findings inline: the fix stays entirely within your assigned file set. Escalate
**wide** findings: the fix would touch another region's files, a shared contract (types.ts, api
seams, Tauri command signatures, the Rust↔JS boundary), or needs a design decision. Escalating is
not failure — applying a wide fix inline is exactly the cross-region write collision this wave
structure exists to prevent. Every escalation must arrive **fix-ready**: file(s) + the concrete
change + why it crosses your boundary. "The api layer looks off" forces a re-investigation and
defeats the wave; "api.ts:120 `listProfiles` wrapper survives the provider cut, delete it and its
`ProfileInfo` type in types.ts:88 (type is region-shared, hence escalated)" seeds a dispatch.

## [WORKER] Your workflow

1. Read your region's files cold, completely — this is a read-everything scan, not a grep pass.
   Consult files outside your region read-only whenever call sites or contracts need checking.
2. Apply local fixes as you go. Do NOT create branches, do NOT commit, do NOT push — the lead
   reviews the region diffs and commits at the wave barrier (uncommitted edits in the shared tree
   are the handoff; the pre-commit hook stash makes mid-wave commits race sibling writers).
3. Before reporting, run the checks relevant to what you changed (commands + timeouts in your
   dispatch message). Concurrent cargo runs from sibling workers just queue on the target-dir
   lock — be patient, don't kill them.
4. Write your report to the path in your dispatch message. Cap ~600 words:
   - **Local fixes applied** — file | one-line what+why, grouped
   - **Wide escalations** — fix-ready, per the bar above
   - **Suspected bugs** — anything that computes wrong or could (the founder's unnamed-bugs bet
     lives here; reason about runtime behavior, not just style)
   - **Compromises** — mandatory; every uncertain call made anyway, every "verified only by grep"
   - **Out-of-scope observations** — one-liners welcome
5. Constraints: never touch `CLAUDE.md`, `.claude/memory/`, `.claude/system_prompt_append.md`, or
   anything under `ai-first-docs/`. Don't add features or "improve" UX — this is subtraction and
   correctness only. Don't reformat files wholesale (diff noise buries the review); fix what you
   touch.

## [BOTH] Region map (write-authority boundaries)

| Region | Files (write access) |
|---|---|
| ccdeck-ui | `src/lib/components/**`, `src/routes/**` |
| ccdeck-core | `src/lib/*.ts`, `src/lib/*.svelte.ts` (top level), `src/lib/mocks/**`, `tests/**` |
| ccdeck-rust | `src-tauri/src/**`, `src-tauri/Cargo.toml` |
| prompt-compose | the entire `/home/shane/workspace/prompt-compose` repo |

ccdeck regions work in `/home/shane/workspace/ccdeck` on the checked-out `v0.14-core-refocus`
branch. The prompt-compose worker works in that repo's checkout on `main` (verify with
`git rev-parse --show-toplevel`; expected HEAD `d08ff93`). If a test file needs updating to match a
fix and `tests/**` isn't yours, that's a wide escalation, not a reach.
