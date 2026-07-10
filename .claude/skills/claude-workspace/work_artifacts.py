#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Classify and retire prompt/report pairs under .claude/work/prompt_report/.

The lifecycle these pairs are supposed to follow is "commit, remove, commit
again" (canon: generic_docs/orchestration/worker_usage_principles.mdx §5): the
files enter git history so the audit trail survives, then leave the working
tree so the next agent isn't misled about what work is still active. The only
hard ordering is commit-before-remove -- `git rm` a pair that never landed in
history and the trail is gone for good.

That ordering is exactly the kind of thing a tired agent gets backwards at 2am,
so `retire` does it as one command. What this script deliberately does NOT do is
decide *when* a slice is done -- that is not machine-decidable, and several
agents share this checkout, so any automated sweep would retire someone else's
in-flight pair. A human or the owning agent names the task; the script handles
the ordering.

`status` classifies every pair into the three states that matter:

    in flight   not in history          -- slice open, leave alone
    residue     in history AND in tree  -- committed but never removed; retire it
    retired     in history, not in tree -- the correct end state

Usage:
    ./work_artifacts.py status
    ./work_artifacts.py retire <task_name>
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

# Derive the repo root from this file's location, never a literal or an env var
# (ai-first-docs/stack/claude-code/setup_protocol.mdx "MCP Server Registration"
# carries the why). .claude/skills/claude-workspace/x.py -> parents[3].
REPO_ROOT = Path(__file__).resolve().parents[3]
PAIR_DIR = REPO_ROOT / ".claude" / "work" / "prompt_report"
SUFFIXES = ("_prompt.md", "_report.md")


def _git(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(REPO_ROOT), *args],
        capture_output=True,
        text=True,
        check=check,
    )


def _in_history(rel: str) -> bool:
    """True if any commit reachable from any ref ever touched this path."""
    out = _git("log", "--all", "--max-count=1", "--format=%H", "--", rel).stdout
    return bool(out.strip())


def _tasks() -> dict[str, list[Path]]:
    """Map task_name -> its existing pair files. Templates (_foo.md) excluded."""
    tasks: dict[str, list[Path]] = {}
    if not PAIR_DIR.is_dir():
        return tasks
    for path in sorted(PAIR_DIR.glob("*.md")):
        if path.name.startswith("_"):
            continue
        for suffix in SUFFIXES:
            if path.name.endswith(suffix):
                tasks.setdefault(path.name[: -len(suffix)], []).append(path)
                break
    return tasks


def _rel(path: Path) -> str:
    return str(path.relative_to(REPO_ROOT))


def cmd_status() -> int:
    tasks = _tasks()
    if not tasks:
        print("No prompt/report pairs on disk. Nothing to retire.")
        return 0

    rows: list[tuple[str, str, str]] = []
    for task, paths in tasks.items():
        historied = [p for p in paths if _in_history(_rel(p))]
        if not historied:
            state = "in flight"
            note = "slice open — leave alone"
        else:
            state = "RESIDUE"
            note = f"in history and in tree — `retire {task}`"
        have = ", ".join(sorted(p.name.split("_")[-1].removesuffix(".md") for p in paths))
        rows.append((task, f"{state} ({have})", note))

    task_w = max(len(r[0]) for r in rows)
    state_w = max(len(r[1]) for r in rows)
    for task, state, note in rows:
        print(f"{task:<{task_w}}  {state:<{state_w}}  {note}")

    residue = sum(1 for r in rows if r[1].startswith("RESIDUE"))
    print(f"\n{len(rows)} pair(s); {residue} residue.")
    return 0


def cmd_retire(task: str) -> int:
    paths = _tasks().get(task)
    if not paths:
        print(f"error: no prompt/report files for task {task!r} in {_rel(PAIR_DIR)}", file=sys.stderr)
        return 1

    rels = [_rel(p) for p in paths]
    names = {p.name.split("_")[-1].removesuffix(".md") for p in paths}
    if "report" not in names:
        print(f"warning: {task} has no report — the worker may still be running.", file=sys.stderr)

    # Step 1: get the pair into history. Skipped when it is already there and
    # unmodified, so retiring an already-committed pair is a single commit.
    _git("add", "--", *rels)
    if _git("diff", "--cached", "--quiet", "--", *rels, check=False).returncode != 0:
        _git("commit", "--quiet", "-m", f"docs(work): archive {task} prompt/report pair")
        print(f"committed {len(rels)} file(s) to history")
    else:
        print("already in history, unmodified — skipping archive commit")

    # Step 2 -- and only now. Removing before step 1 loses the audit trail.
    missing = [r for r in rels if not _in_history(r)]
    if missing:
        print(f"error: refusing to remove, not in history: {missing}", file=sys.stderr)
        return 1

    _git("rm", "--quiet", "--", *rels)
    _git("commit", "--quiet", "-m", f"chore(work): retire {task} pair (preserved in history)")
    print(f"retired {task} — in history forever, out of the working tree")
    return 0


def main() -> int:
    argv = sys.argv[1:]
    if not argv or argv[0] in {"-h", "--help"}:
        print(__doc__)
        return 0
    if argv[0] == "status":
        return cmd_status()
    if argv[0] == "retire":
        if len(argv) != 2:
            print("usage: work_artifacts.py retire <task_name>", file=sys.stderr)
            return 2
        return cmd_retire(argv[1])
    print(f"unknown command {argv[0]!r}; try status or retire", file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
