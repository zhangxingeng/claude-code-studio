---
name: skill-sync
description: "Use after adding, renaming, or removing a skill folder under project_docs/skills/, or when a .claude/skills symlink looks stale, broken, or missing — idempotently syncs the symlinks from the docs-tree sources (dry-run first)."
---

# skill-sync

Skills' source of truth lives in the docs tree (`project_docs/skills/<name>/`, one folder per
skill, declared by containing a `SKILL.md`). Claude Code discovers them through relative symlinks
in `.claude/skills/`. This skill keeps those symlinks true.

```bash
# preview the delta — always safe
uv run --script project_docs/skills/skill-sync/skill_sync.py --dry-run

# apply (prints one line per change, silent when in sync)
uv run --script project_docs/skills/skill-sync/skill_sync.py
```

Safety contract — why hot-running is fine:

- Creates/fixes only symlinks named for source folders; **never overwrites a real file or
  directory** (reports a CONFLICT and exits 1 instead).
- Prunes only symlinks whose target path points into a source root and whose source vanished.
  Harness skills physically inside `.claude/skills/` (caveman, claude-settings,
  claude-workspace) are never touched.
- Relative link targets, so a fresh clone syncs correctly on any machine.

A `SessionStart` hook (matcher `startup`, registered in `.claude/settings.json`) runs this hot on
every new session — `--hook` mode, fail-open, silent on no-op — so after a clone or a pull that
adds skills, the symlinks self-heal without anyone remembering to run it. A new skill still needs
one session restart to register (the loader scans at startup).

Contract and design intent: `ai-first-docs/stack/claude-code/skill_protocol.mdx`.
