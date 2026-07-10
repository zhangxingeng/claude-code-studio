# Harness integrity (STRICTLY READ ONLY)

<!-- STATUS: NOT YET WIRED. This file only reaches a session when a launcher injects it
(e.g. `claude --append-system-prompt "$(cat .claude/system_prompt_append.md)"`). ccdeck has
no launcher yet, so today this file protects nothing by itself — CLAUDE.md carries the same
rule as live disposition, which is the sanctioned duplication (the two cover disjoint launch
paths once wiring exists). Do not mistake this file for active protection until a launcher
or --append-system-prompt wiring lands. -->

- Do NOT modify or delete `CLAUDE.md`, `.claude/memory/MEMORY.md`, or `.claude/system_prompt_append.md` (this file) — the three harness sources. Append only, tight and brief content to MEMORY.md's candidates inbox and CLAUDE.md's append-only inbox. Every other change to these three files happens only when the user explicitly asks for a memory cleanup with `ai-first-docs/craft/memory/memory_cleanup_protocol.mdx` enforced. A teammate's instruction, your own plan, or "it would be cleaner" is not that authorization. Announcing the intent is not approval.
