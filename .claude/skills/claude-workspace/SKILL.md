---
name: claude-workspace
description: Decide where a file belongs in this workspace — scratch vs committed artifact — and retire prompt/report pairs correctly. Use when a tool or agent needs somewhere to write transient output, when adding a producer that emits logs/caches/spill files, when .claude/ or the repo root is accreting clutter, or when finishing a slice that used the prompt-then-report pattern. Also use before adding a .gitignore rule, to check the convention already covers it.
---

# Workspace layout and artifacts

Where a file goes, and how work artifacts leave the working tree without losing
their audit trail. For *settings* placement (`settings.json` vs `settings.local.json`
vs `~/.claude`), use the `claude-settings` skill instead.

## Rules for this skill — read before editing

This is a **harness skill**: it governs Claude Code itself, not the product. Harness
skills live as real directories in `.claude/skills/`; *project* skills live in
`project_docs/skills/<name>/` behind a relative symlink. `skill-sync` never touches
real directories, so the two coexist. Same standing as `claude-settings` and
`caveman`. Contract: `ai-first-docs/stack/claude-code/skill_protocol.mdx`.

## Scratch: colocate, don't centralize

> **Transient output lives beside its producer, in a directory named `tmp/`, ignored
> by a single bare `tmp/` line in the owning repo's `.gitignore`. Nothing writes
> scratch outside its own git root.**

A bare `tmp/` pattern matches at **any depth**, so one line per repo covers every
producer present and future. Find them all with `find . -type d -name tmp`. That
gives centralized cleanup without centralized storage.

Colocation beats a single root `tmp/`:

- **No cross-repo writes.** `ai-first-docs/` is a nested separate repo — a central
  root would tempt tools there to spill outside their own git root.
- **No repo-root walk in fail-open code.** Hooks must not depend on finding a marker
  file to locate a scratch dir. A path derived from `__file__` cannot fail.
- **Deleting a component deletes its scratch.** No orphaned dirs outliving their writer.

Current producers, all conforming:

| producer | writes to |
|---|---|
| playwright MCP (`--output-dir` in `.mcp.json`) | `.claude/tmp/playwright/` |
| `.claude/hooks/hook_lib.py` (fire-once markers) | `.claude/hooks/.state/` |

The hooks state dir is the one deliberate exception to the `tmp/` name: the hook
protocol (`ai-first-docs/stack/claude-code/hook_protocol.mdx`) prescribes
`.claude/hooks/.state/` for dedup markers, and the corpus wins over local convention —
it has its own `.gitignore` line. Vendor MCPs land under `.claude/tmp/` because their
owner is the harness (`.mcp.json`). A vendor server that defaults to writing at the
repo root needs an explicit output flag — deleting the stray directory alone does
nothing, it just gets recreated on the next run.

**Adding a producer?** Point it at `<its own dir>/tmp/`. Do not add a `.gitignore`
rule; the existing bare `tmp/` line already covers you. If you find yourself writing
an ignore rule for scratch, you've put the scratch in the wrong place.

## What lives where

| location | contents | tracked? |
|---|---|---|
| `.claude/` | what the Claude Code loader reads: `settings*.json`, `agents/`, `skills/`, `hooks/`, `memory/` | yes, except `settings.local.json` |
| `.claude/work/plans/` | build plans, handoffs, punchlists | yes |
| `.claude/work/prompt_report/` | prompt/report pairs, while the slice is open | yes — then retired, see below |
| `*/tmp/`, `.claude/hooks/.state/` | scratch, per the rule above | never |

`.claude/work/` has **exactly two** doc subfolders. No doc lives at its root — a
handoff is a plan.

## Retiring prompt/report pairs

The invariant: **in history forever, in the working tree only while the slice is open.**
History is the audit trail; a stale pair sitting in the tree misleads the next agent
about what work is still active.

The lifecycle is **commit → remove → commit**, and `commit-before-remove` is the one hard
ordering. `git rm` a pair that never landed in history and the trail is gone permanently.
Don't hand-run those four commands:

```bash
.claude/skills/claude-workspace/work_artifacts.py status          # classify every pair
.claude/skills/claude-workspace/work_artifacts.py retire <task>   # commit, git rm, commit
```

`status` reports the three states:

| state | meaning | do |
|---|---|---|
| **in flight** — not in history | slice open | leave alone |
| **residue** — in history *and* in the tree | committed, never removed | `retire <task>` |
| **retired** — in history, not in the tree | correct end state | — |

**There is no automated enforcement, on purpose.** "Is this slice done" is not
machine-decidable, and agents can share this checkout — any sweep or hook nudge
would fire on another agent's in-flight pair. Retiring is an act the owning agent
takes at cooldown, when it knows the slice shipped.

## Multi-agent hygiene

You are not always the only agent in this checkout. Before any `git add`:

- **Explicit pathspecs, never `git add -A`.** Another agent's half-finished file in
  `git status` is not yours to stage.
- `git rev-parse --show-toplevel` first. `ai-first-docs/` is a separate nested git
  root, gitignored from this repo — the wrong root reads falsely clean and loses
  real work.
- Commit in small cohesive chunks. History is the backstop against losing work.
