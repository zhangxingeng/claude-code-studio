# CC Deck — Architecture & Contracts

Desktop app (Tauri v2 + SvelteKit static SPA, Svelte 5 + TS) for Claude Code. Fully offline.
Reads Claude Code chat history from `~/.claude/projects/`, renders it, allows
editing with a single-slot pre-save backup. No data ever leaves the machine.

## Layers

```
src-tauri/ (Rust)   native file access ONLY — the browser can't reach the FS
src/lib/   (TS)     pure logic: parse JSONL, build session model (no DOM, no Tauri)
src/lib/api.ts      thin wrapper over Tauri `invoke` + a browser-dev fallback
src/routes/ (Svelte) UI: browse / view / edit
```

## Rust <-> JS command contract (Tauri `invoke`)

All commands are async from JS. Paths are absolute strings. snake_case names.

```
find_projects_dir() -> string | null
    // Absolute path to the Claude projects dir, or null if not found.
    // Resolution order: env CLAUDE_CONFIG_DIR + "/projects",
    //   then <home>/.claude/projects. <home> per-OS (dirs crate).

// Browse loading is two-tier so a large history never blocks first paint
// (issue #37). Tier 1 is a cheap stat-only list; tier 2 streams the
// content-derived fields in the background AND folds in the junk-cleanup pass.

list_sessions() -> SessionStub[]
    // TIER 1 — one directory walk + a single stat per file, NO content read.
    // Walk each immediate subdir of the projects dir (each = one project),
    // skip dirs named "subagents"/"tool-results", and for every *.jsonl NOT
    // named "agent-*.jsonl" emit one stub. Returned in filesystem order; the
    // frontend sorts by mtime (recency) and paints immediately.
    SessionStub {
      id: string,          // stable id = relative path from projects dir
      path: string,        // absolute path to the .jsonl
      project_raw: string, // the encoded project dir name
      mtime: number,       // unix seconds (file modified time) — the recency sort key
      size: number,        // bytes
    }

enrich_sessions(enrichId: number, onMeta: Channel<SessionEnrichment>) -> EnrichSummary
    // TIER 2 — a background streaming scan (Tauri v2 Channel, same house
    // pattern as `search`). Walks the SAME session files newest-first (mtime
    // desc, so the cards in view fill in first), reads + scans each once, and
    // pushes one SessionEnrichment per file. `enrichId` lets a newer call (a
    // remount) supersede an in-flight walk; navigating away does not cancel it,
    // so a normal session still completes one full pass.
    //
    // This walk also does the junk-cleanup pass (see below), so there is no
    // separate `cleanup_empty_sessions` command — the old one re-walked and
    // full-read the whole corpus a SECOND time before the list even loaded.
    SessionEnrichment {
      path: string,            // key: which stub this patches
      cleaned: boolean,        // true = file was empty/untitled/stale and was just
                               //   deleted; every field below is then meaningless and
                               //   the frontend drops the stub instead of patching it.
      preview: string[],       // first up to 50 lines (for JS metadata extraction)
      line_count: number,      // non-empty lines in the file
      user_count: number,      // lines whose "type" == "user"
      assistant_count: number, // lines whose "type" == "assistant"
      subagent_count: number,  // count of subagents/agent-*.jsonl next to the session file
      models: string[],        // distinct message.model values, first-seen order
      first_ts: string,        // first "timestamp" value seen ("" if none)
      last_ts: string,         // last "timestamp" value seen ("" if none)
      cwd: string,             // first-seen "cwd" value ("" if none) — the real project path
      custom_title: string,    // last-seen "customTitle" (whole-file scan; "" if none)
    }
    EnrichSummary { enriched: number, cleaned: number, cancelled: boolean }
    // Cleanup rule (unchanged from the old command): a file is auto-deleted
    // only if it has zero user AND zero assistant lines, no custom title, and
    // is stale (mtime older than a 15-min recency window — the guard that keeps
    // a live CLI's freshly-opened session from being deleted out from under it).
    // A file whose mtime can't be read is never deleted.
    //
    // The frontend (api.ts) inflates each stub into a `SessionMeta` row with
    // empty content fields, then patches those fields from the stream. Browse
    // renders newest-first and windowed (100 at a time, "Load more").

read_session(path) -> string
    // Raw UTF-8 contents of the .jsonl file.

write_session(path, content) -> null
    // Overwrite the original .jsonl. By convention the caller calls
    // snapshot(path) first when overwriting existing content; not enforced
    // inside write_session itself.

snapshot(path) -> BackupVersion
    // Copy current on-disk file into the backup store BEFORE an override.
    // Single backup slot per session: any existing backup file(s) for the
    // session are deleted first, so exactly one file exists after the call.
    // Store: <projects-dir>/../.ccstudio-backups/<sanitized session id>/v001-<unixsecs>.jsonl
    //   (i.e. ~/.claude/.ccstudio-backups/...). gzip optional; plain .jsonl is fine for v1.
    BackupVersion { version: number, timestamp: number, path: string, size: number }

list_backups(session_path) -> BackupVersion[]
    // The session's backup, if any — 0 or 1 entries (single-slot backup).

restore_backup(backup_path) -> string
    // Return the raw contents of the backup (frontend decides what to do:
    // it will snapshot current state, then write this content back).
```

As of issue #6 (Phase B: plain edit surface), there is no crash-safe autosave
draft. Editing is plain edit-in-place -> Save: [`editDraft.ts`](src/lib/editDraft.ts)'s `Draft` holds
each row's original line plus its current (possibly edited) value entirely
in memory, and `write_session` is the only path that touches disk for an
edit. The editor's "Restore backup" affordance is a single button + confirm
(no version picker, no history list) backed by `list_backups`/`restore_backup`
above — there is only ever one backup file per session.

Rust crates to add: `dirs` (home dir), `serde`/`serde_json` (already present),
`walkdir` optional. Register all commands in `invoke_handler`. Capabilities:
the commands are custom (`#[tauri::command]`) so no extra ACL entries are needed
beyond `core:default` already in [`capabilities/default.json`](src-tauri/capabilities/default.json).

## JS data model ([`src/lib/types.ts`](src/lib/types.ts)) — ported from the old docs/app.js

Recover the reference implementation: `git show e47e27d:docs/app.js`
Also reference (Python source of truth, in git history e47e27d):
  `git show e47e27d:src/claude_code_display/builder.py`
  `git show e47e27d:src/claude_code_display/parser.py`
  `git show e47e27d:src/claude_code_display/models.py`

Core shapes (keep these names; UI depends on them):
```
ContentBlock {
  blockType: 'text',
  text?,
}
Entry  { type, role, uuid, parentUuid, requestId, timestamp, model, isSidechain,
         blocks: ContentBlock[], isInterruption?, taskNotification? }
Turn   { role: 'user'|'assistant', blocks: ContentBlock[], timestamp, model }
Session{ turns: Turn[], meta: { title, date, model, project, sourcePath } }
```

As of issue #6 (Phase A: render-trim), thinking/tool_use/tool_result blocks are
dropped during parsing — the display model only ever carries user/assistant
text. `ContentBlock` previously also carried `thinking`/`signature` (thinking
blocks) and `toolName`/`toolId`/`toolInput`/`toolOutput`/`isError`/`isAsync`/
`agentId`/`subagent` (tool_use/tool_result blocks, including the subagent
"Open →" navigation affordance); all were removed along with the rendering
that used them.

Functions to export:
```
parseJsonl(text: string): Entry[]          // filters meta types + internal echoes
buildSession(entries, opts): Session        // groups by requestId into turns
extractMeta(preview: string[]|Entry[]): {title,date,model}  // for the browse list
decodeProject(raw: string): string           // encoded dir name -> readable
```

Internal-echo prefixes to filter from user text / titles:
`<command-name>` `<local-command-stdout>` `<command-message>` `<command-args>`
`<local-command-caveat>` `<system-reminder>` `<teammate-message` `<task-notification>`

## Prompt Library — split out into its own product (v0.14)

The prompts view, its Markdown snippet store, the project model, the compose box, the variable
grammar, and the semantic-embedding matcher have all left CC Deck for a standalone product, **Prompt
Compose** ([github.com/zhangxingeng/prompt-compose](https://github.com/zhangxingeng/prompt-compose)) —
its own Tauri desktop app. Search and prompts now run in parallel, not one containing the other.
CC Deck keeps browse, search, view, edit/share, resume-copy, and app config.

**Data root `~/.ccdeck/`** (env `CCDECK_DATA_DIR` overrides; `src-tauri/src/datadir.rs`):
`backups/` (session-edit backups) and `index/` (search cache) — both still owned by CC Deck,
unaffected by the split. `prompts-state.json`, left behind by a pre-split install, is now an
orphaned, inert file — nothing reads it. On startup `migrate_legacy_state()` moves the pre-0.12
artifacts out of `~/.claude` (`.ccstudio-backups`, `.ccstudio-config.json`, `.ccstudio-index`) —
invariant since: nothing ccdeck-owned lives under `~/.claude`.
