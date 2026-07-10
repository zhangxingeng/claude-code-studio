---
name: claude-settings
description: Decide where a Claude Code setting belongs (settings.json vs settings.local.json vs ~/.claude), and debug a setting that isn't taking effect. Use when adding or changing anything under .claude/settings*.json — MCP enable/disable, permissions, env, hooks — or when a config seems ignored, overridden, or mysteriously different from what the file says. Also use before committing any settings change, to check it won't break a teammate's clone.
---

# Maintaining Claude Code settings

Two questions this skill answers: **where does this setting belong**, and **why isn't it taking
effect**. For the mechanics of *how* to write a hook, a permission rule, or an env var, use the
built-in `update-config` skill instead — this one owns placement and precedence, not syntax.

## Rules for this skill — read before editing

This is a **harness skill**: it governs Claude Code itself, not the product. Harness skills live as
real directories in `.claude/skills/`; *project* skills live in `project_docs/skills/<name>/` behind
a relative symlink (`ai-first-docs/stack/claude-code/skill_protocol.mdx`). A fresh clone needs a
harness skill before any docs tree is guaranteed present, and a Claude Code skill belongs in the
Claude folder. `skill-sync` never touches real directories, so the two coexist. Siblings:
`claude-workspace`, `caveman`. For *where files go* (scratch, artifacts), use `claude-workspace`.

## The placement rule

**Default to `.claude/settings.json` (shared, committed). Move a key to `.claude/settings.local.json`
(personal, gitignored) only when it is genuinely local in nature.** Committing a personal value
breaks the next person's clone; hiding a shared decision in a gitignored file means nobody else ever
gets it. Both failures are silent.

Two things are local *by nature*:

| Local because | Examples here |
|---|---|
| **Machine-specific paths / host facts** | `autoMemoryDirectory` (absolute path — this repo's memory injection lives in `settings.local.json` for exactly this reason, and because the harness silently ignores the key in tracked project settings) |
| **A server or tool that isn't in this repo** — not in `.mcp.json` — so nobody else has it | a personal MCP you run only on your box |

Everything else — and specifically **policy**, meaning any decision the team should inherit —
belongs in the committed `settings.json`. Deny rules, disabled MCPs, enable lists, hooks, shared env.

### The trust gate — why an allow and a deny behave differently

**A *deny* restricts; an *allow* grants.** Claude Code treats them asymmetrically:

- `permissions.deny`, `permissions.ask`, and `disabledMcpjsonServers` are honored **from any scope,
  regardless of trust**. A committed deny bites on a teammate's fresh clone immediately.
- `permissions.allow`, `additionalDirectories`, `enabledMcpjsonServers`, and
  `enableAllProjectMcpServers` **grant capability**, so a committed project value stays inert until
  the teammate accepts the workspace-trust dialog. Until then `claude mcp list` shows the servers as
  `⏸ Pending approval`, and in non-interactive `-p` mode no dialog appears at all.

That dialog is **once per workspace**, keyed on the git repo root — not once per server. So an enable
list *does* belong in the committed `settings.json`: one teammate action unlocks the whole set.

Practical consequence for a fresh clone: **your disables work before trust; your enables work after.**
That asymmetry fails safe, which is why it's the right direction to lean.

### MCP servers specifically

A server **defined in `.mcp.json`** is a repo asset. Its enable/disable **policy** lives in the
committed `settings.json` — **both lists, explicitly**:

```jsonc
// .claude/settings.json — shared. Say what's on and what's off; never infer.
"enabledMcpjsonServers":  ["docs"],
"disabledMcpjsonServers": ["playwright"]
```

**Do not use `enableAllProjectMcpServers`.** It auto-approves every server in `.mcp.json`, and set at
user scope it does so for *every repo you open* — a supply-chain footgun, since cloning any repo then
silently trusts whatever `.mcp.json` it ships. Name the servers instead. The cost of explicitness is
one line per server; the benefit is that the effective set is readable from one committed file, and a
newly added server stays `⏸ Pending approval` until a human names it.

Corollary worth knowing: **adding a server to `.mcp.json` is not enough to make it connect.** It
must also be named in an enable list. If you add a server and it hangs at pending, that's why.

Never delete the `.mcp.json` definition to turn a server off. Keep the definition; flip the toggle.
Re-enabling is then a one-line revert with the wiring intact, and `git log` explains why it was off.

A disable is a real rejection, not a cosmetic hide: the server never connects, `tools/list` is never
called, and you pay **zero tokens** for it. That is the whole point of doing this (playwright is
disabled here for exactly this reason — enable on demand for visual-iteration work, per
`ai-first-docs/craft/workflow/visual_iteration_protocol.mdx`).

**A server that is not in `.mcp.json` is yours alone** — disable or enable it only in
`settings.local.json`, because committing a name that resolves to nothing on a teammate's machine is
just noise in their config.

## Precedence — highest wins

Read this before concluding a setting "doesn't work."

1. Managed / enterprise policy (cannot be overridden, not even by CLI flags)
2. Command-line `--settings`
3. `<repo>/.claude/settings.local.json`
4. `<repo>/.claude/settings.json`
5. `~/.claude/settings.json`

**Local beats project beats user.** The common surprise is the bottom of that list: a value in your
own `~/.claude/settings.json` is the *weakest*, yet it still applies to every project you open — so a
key set there (`model`, a `Stop` hook) will look like it "came from nowhere" when you're staring only
at the repo's two files. **Always read `~/.claude/settings.json` too.**

### How values combine

- **Arrays concatenate and deduplicate across every scope.** They do not replace. So a name in
  `disabledMcpjsonServers` in *any* file disables that server — you cannot re-enable it from a
  higher-precedence file by omitting it. Same for `permissions.allow` / `permissions.deny`.
  (Two documented exceptions: `fallbackModel` and `availableModels`.)
- **`deny` is evaluated before `allow`**, so a deny anywhere beats an allow anywhere.
- **Scalars** (`model`, `permissions.defaultMode`) — the highest-precedence file that sets it wins.
- **`env` merges key-by-key** across all three scopes; a project `env` block does *not* clobber the
  user's. **This is not in the docs** — verified empirically (upstream, in the reference project) by
  setting a distinct key in each of the three files and observing all three survive. If you depend on
  it, re-verify.

### Path and tool specifiers — three ways to get a deny wrong

- **A single leading slash is not absolute.** `Edit(/CLAUDE.md)` anchors to the *settings source*, so
  in project settings it means `<repo root>/CLAUDE.md`. Filesystem-absolute needs `//`, e.g.
  `Read(//etc/hosts)`.
- **Bare filenames follow gitignore semantics** — `Read(.env)` matches `.env` at *any* depth. The
  `./x` form anchors to the current working directory, which is not always the project root.
- **`Edit` is the umbrella; `Write` is not.** An `Edit(x)` rule covers every built-in file-modifying
  tool, including Write and NotebookEdit. A bare `Write(x)` rule covers only the Write tool. To
  protect a file, deny `Edit`.

### What permissions cannot do

**They cannot stop a file from being deleted.** `rm` is a Bash subprocess, not the Edit tool, so
Read/Edit rules never see it. And `Bash(...)` rules are *prefix-matched*: `cd dir && rm x`, `/bin/rm`,
`timeout rm x`, and quoting tricks all walk straight past them. A Bash deny here is decoration that
reads as protection — worse than none, because it stops people looking for real protection.

Real mechanisms, in order of strength: **sandboxing** (OS-level, applies to Bash and its children),
a **`PreToolUse` hook** (exit code 2 blocks the call before permissions are even evaluated — this
repo's `mask-secrets.py` is the worked example), and **prose** in the always-on harness files.

## Debugging "my setting isn't taking effect"

**There is no command that prints the merged, effective configuration.** `/config` is a toggle
editor, not a settings dump. So read the files yourself, in precedence order — this is cheap and it
is the only ground truth:

```bash
for f in .claude/settings.local.json .claude/settings.json ~/.claude/settings.json; do
  echo "───── $f"; cat "$f" 2>/dev/null || echo "(absent)"
done
# MCP server definitions live elsewhere again:
cat .mcp.json; cat ~/.claude.json 2>/dev/null | head -40
```

Per-surface effective views exist even though a whole-config dump doesn't, and they beat guessing:

| Command | Shows |
|---|---|
| `/status` | which settings *scopes* loaded (not which key came from where) |
| `/permissions` | the resolved allow/deny rules actually in force |
| `/doctor` | invalid keys and schema errors, with the offending file |
| `/mcp`, `/hooks`, `/skills`, `/context`, `/memory` | the effective view of that one surface |
| `claude mcp list` | every server's real connection state — the check after any MCP toggle |

## When a change takes effect

Most keys hot-reload into the running session — `permissions`, `hooks`, `apiKeyHelper` are
explicitly documented as doing so. `model` needs `/model`; `outputStyle` needs `/clear` or a
restart.

**MCP toggles: assume a session restart.** Establishing or tearing down a server connection is a
process-lifecycle action, and the docs do not promise it happens mid-session. Change the setting,
start a fresh session, then confirm with `claude mcp list` rather than trusting the edit.

## Before you commit a settings change

- Does this value contain an absolute path, a hostname, a UID, or a token? → `settings.local.json`.
- Does it name a server or tool that isn't in this repo? → `settings.local.json`.
- Is it a *deny*, a disabled server, an enable list, a hook, or shared env? → `settings.json`,
  committed. An allow or enable list is committable too — it just waits on the one trust dialog.
- Does `~/.claude/settings.json` already set this key? → the project entry may be redundant. Check
  before adding a second copy; two sources of one value drift.
- After committing an MCP toggle, restart and run `claude mcp list` to prove the intended servers
  are the connected ones. A server you disabled that still shows `✔ Connected` means the change did
  not land — go back to the precedence chain.
