#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""Check that snippet JSON files comply with the ccdeck Prompt Library schema.

Usage:
    uv run --script project_docs/skills/prompt-import/validate_prompts.py <path>...
    uv run --script .../validate_prompts.py ~/.ccdeck/prompts

A <path> is a snippet .json file or a directory of them. Prints one line per
problem and exits 1 if any file fails; silent-ish and exits 0 when all pass.

The placeholder check ports src-tauri/src/prompts/grammar.rs::derive_placeholders
byte for byte. That port is the point of this script: the app DERIVES
`placeholders` from the body at save time, so a hand-authored array that
disagrees with the body is drift the app will silently overwrite. Any change to
the Rust grammar is a contract change and must land here in the same commit.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
PALETTE = {"red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "graphite"}

# Sanity window for unix-second timestamps: 2020-01-01 .. 2100-01-01. Catches the
# classic import bug of writing milliseconds into a seconds field.
TS_MIN, TS_MAX = 1_577_836_800, 4_102_444_800


def is_name_char(ch: str) -> bool:
    """Legal in a variable name: ASCII [A-Za-z0-9_-] only. Never unicode."""
    return ch.isascii() and (ch.isalnum() or ch in "_-")


def parse_variable(body: str, start: int) -> tuple[dict, int] | None:
    """Read `{name}` / `{name:default}` at `start`. None means the run is prose."""
    name_start = start + 1
    i = name_start
    while i < len(body) and is_name_char(body[i]):
        i += 1
    if i == name_start:
        return None  # empty name: `{:x}`, `{"a"...`, `{ ...`
    name = body[name_start:i]
    if i >= len(body):
        return None  # unclosed
    if body[i] == "}":
        return {"name": name}, i + 1
    if body[i] == ":":
        default_start = i + 1
        j = default_start
        while j < len(body):
            if body[j] == "}":
                return {"name": name, "default": body[default_start:j]}, j + 1
            if body[j] == "{":
                return None  # a default may not contain braces
            j += 1
        return None  # unclosed — prose
    return None  # name interrupted by space, quote, unicode, EOF…


def derive_placeholders(body: str) -> list[dict]:
    """Every variable the grammar finds, deduped by name in first-appearance order,
    each carrying the FIRST occurrence's default (even when that default is absent)."""
    out: list[dict] = []
    seen: set[str] = set()
    i = 0
    while i < len(body):
        ch = body[i]
        nxt = body[i + 1] if i + 1 < len(body) else ""
        if ch == "{" and nxt == "{":
            i += 2  # escape consumes before variable parsing
        elif ch == "}" and nxt == "}":
            i += 2
        elif ch == "{":
            parsed = parse_variable(body, i)
            if parsed is None:
                i += 1  # verbatim prose brace; scanning resumes INSIDE the failed run
            else:
                placeholder, end = parsed
                if placeholder["name"] not in seen:
                    seen.add(placeholder["name"])
                    out.append(placeholder)
                i = end
        else:
            i += 1
    return out


def data_root() -> Path:
    override = os.environ.get("CCDECK_DATA_DIR")
    return Path(override) if override else Path.home() / ".ccdeck"


def known_project_ids() -> set[str] | None:
    """Ids in the roster. None means the roster is unreadable/absent — in which
    case a project-scoped snippet is unverifiable, not wrong, so we say so."""
    roster = data_root() / "projects.json"
    try:
        raw = json.loads(roster.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict) or not isinstance(raw.get("projects"), list):
        return None
    return {p["id"] for p in raw["projects"] if isinstance(p, dict) and isinstance(p.get("id"), str)}


def check_str(snippet: dict, key: str, errs: list[str], *, required: bool) -> None:
    if key not in snippet:
        if required:
            errs.append(f"missing required field `{key}`")
        return
    if not isinstance(snippet[key], str):
        errs.append(f"`{key}` must be a string, got {type(snippet[key]).__name__}")


def check_str_list(snippet: dict, key: str, errs: list[str]) -> None:
    if key not in snippet:
        return  # defaulted by the app
    value = snippet[key]
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        errs.append(f"`{key}` must be an array of strings")


def check_timestamp(snippet: dict, key: str, errs: list[str]) -> None:
    if key not in snippet:
        errs.append(f"missing required field `{key}`")
        return
    value = snippet[key]
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        errs.append(f"`{key}` must be a non-negative integer (unix SECONDS)")
    elif not (TS_MIN <= value <= TS_MAX):
        errs.append(f"`{key}` = {value} is outside 2020..2100 — milliseconds instead of seconds?")


def check_scope(snippet: dict, errs: list[str], projects: set[str] | None) -> None:
    if "scope" not in snippet:
        return  # defaults to global
    scope = snippet["scope"]
    if not isinstance(scope, dict) or "kind" not in scope:
        errs.append('`scope` must be {"kind":"global"} or {"kind":"project","project_id":"…"}')
        return
    kind = scope["kind"]
    if kind == "global":
        if set(scope) != {"kind"}:
            errs.append('a global `scope` carries no other keys — got ' + ", ".join(sorted(set(scope) - {"kind"})))
    elif kind == "project":
        pid = scope.get("project_id")
        if not isinstance(pid, str) or not pid:
            errs.append('`scope.kind` is "project" but `project_id` is missing or not a string')
        elif projects is None:
            errs.append(f"scope references project {pid} — roster unreadable, could not verify it exists")
        elif pid not in projects:
            errs.append(
                f"scope references unknown project {pid} — the app would load this snippet as GLOBAL. "
                "Create the project first, or use its real id."
            )
    else:
        errs.append(f'unknown `scope.kind` "{kind}" — only "global" and "project" exist')


def check_versions(snippet: dict, errs: list[str]) -> None:
    if "versions" not in snippet:
        return
    versions = snippet["versions"]
    if not isinstance(versions, list):
        errs.append("`versions` must be an array")
        return
    for idx, version in enumerate(versions):
        if not isinstance(version, dict):
            errs.append(f"versions[{idx}] must be an object")
            continue
        if not isinstance(version.get("body"), str):
            errs.append(f"versions[{idx}] missing string `body`")
        check_timestamp(version, "saved_at", errs)


def check_placeholders(snippet: dict, errs: list[str]) -> None:
    body = snippet.get("body")
    if not isinstance(body, str):
        return  # already reported
    expected = derive_placeholders(body)
    if "placeholders" not in snippet:
        if expected:
            errs.append(
                f"`placeholders` missing but the body declares {len(expected)} variable(s): "
                + ", ".join(p["name"] for p in expected)
            )
        return
    actual = snippet["placeholders"]
    if not isinstance(actual, list):
        errs.append("`placeholders` must be an array")
        return
    if actual != expected:
        errs.append(
            "`placeholders` does not match what the body's grammar derives — the app derives this "
            "field at save time, so the mismatch is drift.\n"
            f"      body derives: {json.dumps(expected)}\n"
            f"      file says:    {json.dumps(actual)}"
        )


def validate_file(path: Path, projects: set[str] | None) -> tuple[list[str], str | None]:
    """Returns (errors, snippet_id)."""
    errs: list[str] = []
    try:
        raw = json.loads(path.read_text())
    except json.JSONDecodeError as exc:
        # The app would try to repair this and load it as `recovered`. Don't ship
        # a file that relies on the repair path.
        return [f"not valid JSON: {exc}"], None
    except OSError as exc:
        return [f"cannot read: {exc}"], None

    if not isinstance(raw, dict):
        return ["top level must be a JSON object"], None

    check_str(raw, "id", errs, required=True)
    check_str(raw, "title", errs, required=True)
    check_str(raw, "body", errs, required=True)
    if "category" in raw and raw["category"] is not None and not isinstance(raw["category"], str):
        errs.append("`category` must be a string or null")
    check_str_list(raw, "keywords", errs)
    check_str_list(raw, "tags", errs)
    check_timestamp(raw, "created_at", errs)
    check_timestamp(raw, "updated_at", errs)
    check_scope(raw, errs, projects)
    check_versions(raw, errs)
    check_placeholders(raw, errs)

    snippet_id = raw.get("id") if isinstance(raw.get("id"), str) else None
    if snippet_id:
        if not UUID_RE.match(snippet_id):
            errs.append(f"`id` should be a UUID v4, got {snippet_id!r}")
        if path.stem != snippet_id:
            errs.append(f"filename must be <id>.json — expected {snippet_id}.json, got {path.name}")
    if raw.get("recovered") is True:
        errs.append("`recovered` is app-owned (set when a corrupt file was repaired) — never author it")
    if isinstance(raw.get("title"), str) and not raw["title"].strip():
        errs.append("`title` is empty — it is the snippet's handle in the picker")
    if isinstance(raw.get("body"), str) and not raw["body"].strip():
        errs.append("`body` is empty")

    return errs, snippet_id


def collect(paths: list[str]) -> list[Path]:
    files: list[Path] = []
    for arg in paths:
        path = Path(arg).expanduser()
        if path.is_dir():
            files.extend(sorted(p for p in path.glob("*.json") if not p.name.startswith(".")))
        else:
            files.append(path)
    return files


def main() -> int:
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return 2

    files = collect(args)
    if not files:
        print("no .json files found in the given paths", file=sys.stderr)
        return 2

    projects = known_project_ids()
    ids: dict[str, Path] = {}
    failed = 0

    for path in files:
        errs, snippet_id = validate_file(path, projects)
        if snippet_id:
            if snippet_id in ids:
                errs.append(f"duplicate id — already used by {ids[snippet_id].name}")
            else:
                ids[snippet_id] = path
        if errs:
            failed += 1
            print(f"\n✗ {path}")
            for err in errs:
                print(f"    - {err}")

    checked = len(files)
    if failed:
        print(f"\n{failed} of {checked} file(s) FAILED — fix these before importing.")
        return 1
    print(f"✓ {checked} file(s) valid.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
