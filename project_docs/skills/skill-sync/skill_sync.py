# /// script
# requires-python = ">=3.12"
# dependencies = []
# ///
"""Sync Claude Code skill symlinks from the docs-tree skill sources.

Convention-driven (no manifest): every child of a SOURCE root that contains a
SKILL.md is a skill declaration; this script ensures a RELATIVE symlink
`.claude/skills/<name>` -> that folder, and prunes only symlinks it owns
(links resolving into a source root) whose source has vanished. It never
touches real directories or symlinks pointing elsewhere, so hand-made harness
skills living physically in .claude/skills are invisible to it by construction.

Modes:
    --dry-run   print the create/fix/prune/conflict plan, change nothing
    (default)   apply; print one line per change; silent when nothing to do
    --hook      apply, but never fail the caller (SessionStart wires this):
                any unexpected error prints one stdout line and exits 0

Contract doc: ai-first-docs/stack/claude-code/skill_protocol.mdx
"""

import argparse
import os
import sys
from pathlib import Path


def find_project_root(start: Path) -> Path:
    """Walk up from the script's real location to the directory holding .claude."""
    for parent in [start, *start.parents]:
        if (parent / ".claude").is_dir():
            return parent
    raise RuntimeError(f"no .claude directory above {start}")


PROJECT_ROOT = find_project_root(Path(__file__).resolve().parent)
SKILLS_DIR = PROJECT_ROOT / ".claude" / "skills"
# N-root ready: append future roots (each scanned identically). Project-only —
# the generic corpus (ai-first-docs/) spans multiple projects and ships no skills.
SOURCE_ROOTS = [PROJECT_ROOT / "project_docs" / "skills"]


def desired_links() -> dict[str, Path]:
    """Map skill name -> real source dir, for every source folder holding a SKILL.md."""
    links: dict[str, Path] = {}
    for root in SOURCE_ROOTS:
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir()):
            if child.is_dir() and (child / "SKILL.md").is_file():
                if child.name in links:
                    raise RuntimeError(f"duplicate skill name across roots: {child.name}")
                links[child.name] = child.resolve()
    return links


def owned_by_sync(link: Path) -> bool:
    """A symlink is ours iff its target path points into a source root (even if dangling)."""
    raw_target = link.readlink()
    absolute = (link.parent / raw_target).resolve() if not raw_target.is_absolute() else raw_target
    return any(absolute.is_relative_to(root) for root in SOURCE_ROOTS)


def plan() -> tuple[list[tuple[str, Path, Path]], list[Path], list[str]]:
    """Compute (creates_or_fixes, prunes, conflicts) without touching anything."""
    wanted = desired_links()
    actions: list[tuple[str, Path, Path]] = []
    prunes: list[Path] = []
    conflicts: list[str] = []

    for name, source in wanted.items():
        link = SKILLS_DIR / name
        if link.is_symlink():
            current = (link.parent / link.readlink()).resolve()
            if current != source:
                actions.append(("fix", link, source))
        elif link.exists():
            conflicts.append(f"{link} is a real file/dir, not a symlink — refusing to touch it")
        else:
            actions.append(("create", link, source))

    if SKILLS_DIR.is_dir():
        for entry in sorted(SKILLS_DIR.iterdir()):
            if entry.is_symlink() and entry.name not in wanted and owned_by_sync(entry):
                prunes.append(entry)

    return actions, prunes, conflicts


def apply(dry_run: bool) -> int:
    actions, prunes, conflicts = plan()
    for verb, link, source in actions:
        rel = Path(os.path.relpath(source, link.parent))
        print(f"skill-sync {verb}: {link.relative_to(PROJECT_ROOT)} -> {rel}")
        if not dry_run:
            link.unlink(missing_ok=True)
            link.symlink_to(rel, target_is_directory=True)
    for link in prunes:
        print(f"skill-sync prune (source gone): {link.relative_to(PROJECT_ROOT)}")
        if not dry_run:
            link.unlink()
    for problem in conflicts:
        print(f"skill-sync CONFLICT: {problem}")
    return 1 if conflicts else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="plan only, change nothing")
    parser.add_argument("--hook", action="store_true", help="SessionStart mode: never exit non-zero")
    args = parser.parse_args()

    if not args.hook:
        return apply(dry_run=args.dry_run)
    # Hook mode is fail-open (a broken sync must never wedge session start) but not
    # fail-silent — one line surfaces the failure instead of hiding it as "no changes".
    try:
        apply(dry_run=False)
    except Exception as error:  # noqa: BLE001 — fail-open boundary, error surfaced on stdout
        print(f"skill-sync failed ({error}) — run skill_sync.py --dry-run to inspect")
    return 0


if __name__ == "__main__":
    sys.exit(main())
