/**
 * editDraft.ts — Pure TypeScript edit model for JSONL sessions.
 * No DOM, no Svelte, no Tauri imports.
 *
 * Plain edit-in-place model: each row holds its original line and its current
 * (possibly edited) value. There is no version history and no reorder —
 * "edit a message, Save writes to disk" is (mostly) the whole surface.
 *
 * The one addition (issue #14) is DELETE, at content-block granularity:
 * `Draft.deletedBlocks` is a set of block keys `"<originalIndex>:<blockIndex>"`.
 * This is deliberately NOT a revival of the old row-level `versions[]`/`active`
 * stack (dead, stays dead) — deletion is a soft, reversible mark until Save;
 * `serializeDraft` is where it actually takes effect (dropping/rebuilding
 * lines), same as the old design, just re-derived from a plain Set instead of
 * a version history.
 *
 * Uses `lossless-json` instead of native `JSON.parse`/`JSON.stringify` for
 * every read/mutate/write of a line. Native JSON silently rounds any integer
 * past 2^53 to the nearest representable double — parsing a line, editing an
 * unrelated field, and re-stringifying it would silently corrupt any large
 * numeric field elsewhere on that same line (confirmed empirically by
 * `tests/edit_roundtrip_smoke.mjs`, which is exactly how this was found).
 * `lossless-json` keeps every untouched number byte-for-byte as originally
 * written; only fields we explicitly set go through normal JS serialization.
 */

import { parse as losslessParse, stringify as losslessStringify, isLosslessNumber } from 'lossless-json';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DraftRow {
  originalIndex: number; // 0-based position in the original file
  type: string;          // entry `type` ('' if unparseable)
  uuid: string | null;
  original: string;      // exact original line text — never mutated, used for isDirty
  value: string;         // current line text (equals `original` until edited)
}

export interface Draft {
  sessionPath: string;
  order: string[];       // row keys in file order (fixed — no reordering)
  rows: Record<string, DraftRow>;
  createdAt: number;     // unix secs, passed in (do NOT call Date.now in this module)
  /** Soft-deleted content blocks, keyed `"<originalIndex>:<blockIndex>"` (see
   *  `blockKey`). Reversible until Save — nothing leaves the file until
   *  `serializeDraft` runs. */
  deletedBlocks: Set<string>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Parses one line losslessly; `null` for anything that isn't a JSON object
 * (invalid JSON, a bare scalar, or a bare top-level number/array). Rejects
 * duplicate keys (lossless-json's parser errors on them) rather than
 * silently taking the last one, same as native JSON would. */
function parseLine(text: string): Record<string, unknown> | null {
  try {
    const obj = losslessParse(text);
    if (typeof obj === 'object' && obj !== null && !isLosslessNumber(obj) && !Array.isArray(obj)) {
      return obj as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** `losslessStringify` types its return as `string | undefined` (mirroring
 * native `JSON.stringify`, which returns `undefined` for `undefined`/
 * functions/symbols) — never happens for the plain object/array line values
 * this module stringifies, so this narrows that away at one call site. */
function stringifyLine(value: unknown): string {
  const out = losslessStringify(value);
  if (out === undefined) throw new Error('unstringifiable line value');
  return out;
}

function deepClone<T>(val: T): T {
  return losslessParse(stringifyLine(val)) as T;
}

// ── buildDraft ─────────────────────────────────────────────────────────────────

export function buildDraft(rawText: string, sessionPath: string, createdAt: number): Draft {
  const lines = rawText.split('\n');
  // Drop trailing empty line produced by the final \n
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  const rows: Record<string, DraftRow> = {};
  const order: string[] = [];

  for (let originalIndex = 0; originalIndex < lines.length; originalIndex++) {
    const line = lines[originalIndex];
    if (line.trim() === '') continue;

    const obj = parseLine(line);
    const uuid = obj !== null && typeof obj['uuid'] === 'string' ? (obj['uuid'] as string) : null;
    const type = obj !== null && typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
    // Key rule: use uuid if present, parses, AND hasn't already been claimed
    // by an earlier line — else `idx:<originalIndex>`. Real session files are
    // expected to have unique uuids, but this draft's bookkeeping must stay
    // injective (exactly one row per line, never merged) even if that
    // assumption is ever violated by a duplicate/forked/corrupt file — a
    // naive `uuid ?? idx` key rule silently collapses two lines into one row
    // keyed by uuid, dropping the earlier line's content on save.
    const key = uuid !== null && !(uuid in rows) ? uuid : `idx:${originalIndex}`;

    rows[key] = { originalIndex, type, uuid, original: line, value: line };
    order.push(key);
  }

  return { sessionPath, order, rows, createdAt, deletedBlocks: new Set() };
}

// ── Block keys ─────────────────────────────────────────────────────────────────

/**
 * Addressable key for one content block: `"<originalIndex>:<blockIndex>"`.
 * `originalIndex` is the row's fixed 0-based position in the original file
 * (stable regardless of the row's uuid-vs-`idx:N` draft key); `blockIndex` is
 * the block's position in `message.content` (or `0` for string content,
 * which is a single implicit block).
 */
export function blockKey(row: DraftRow, blockIndex: number): string {
  return `${row.originalIndex}:${blockIndex}`;
}

export function isBlockDeleted(d: Draft, row: DraftRow, blockIndex: number): boolean {
  return d.deletedBlocks.has(blockKey(row, blockIndex));
}

/** Number of content blocks a row's CURRENT value carries (string content = 1
 *  implicit block; array content = its length; unparseable/no message = 0). */
function blockCount(obj: Record<string, unknown> | null): number {
  if (!obj) return 0;
  const msg = obj['message'] as Record<string, unknown> | undefined;
  if (!msg) return 0;
  const content = msg['content'];
  if (typeof content === 'string') return 1;
  if (Array.isArray(content)) return content.length;
  return 0;
}

// ── serializeDraft ─────────────────────────────────────────────────────────────

/**
 * Emit the current value of each row in `order`, joined '\n' + trailing '\n',
 * honoring soft-deleted blocks:
 *   - a row with NO deleted blocks passes through verbatim (byte-identical);
 *   - a row with ALL its blocks deleted is dropped entirely;
 *   - a row with SOME blocks deleted is rebuilt (via the same lossless-json
 *     path `applyBlockTextEdit` uses) minus those blocks, preserving every
 *     surviving block and every sibling scalar field byte-exact.
 * Zero deletions anywhere ⇒ identical to the pre-#14 behavior (and to `raw`,
 * for a freshly-built draft).
 */
export function serializeDraft(d: Draft): string {
  if (d.deletedBlocks.size === 0) {
    return d.order.map((key) => d.rows[key].value).join('\n') + '\n';
  }

  const lines: string[] = [];
  for (const key of d.order) {
    const row = d.rows[key];
    const obj = parseLine(row.value);
    const count = blockCount(obj);
    if (count === 0) {
      lines.push(row.value);
      continue;
    }

    const deletedIdx: number[] = [];
    for (let i = 0; i < count; i++) {
      if (d.deletedBlocks.has(blockKey(row, i))) deletedIdx.push(i);
    }
    if (deletedIdx.length === 0) {
      lines.push(row.value);
    } else if (deletedIdx.length === count) {
      // All blocks gone — drop the whole line.
      continue;
    } else {
      const cloned = deepClone(obj!);
      const clonedMsg = cloned['message'] as Record<string, unknown>;
      const content = clonedMsg['content'] as unknown[];
      clonedMsg['content'] = content.filter((_, i) => !deletedIdx.includes(i));
      lines.push(stringifyLine(cloned));
    }
  }
  return lines.join('\n') + '\n';
}

// ── isDirty ────────────────────────────────────────────────────────────────────

export function isDirty(d: Draft): boolean {
  if (d.deletedBlocks.size > 0) return true;
  for (const key of d.order) {
    if (d.rows[key].value !== d.rows[key].original) return true;
  }
  return false;
}

// ── applyBlockTextEdit ─────────────────────────────────────────────────────────

/**
 * Edit ONE text block of a message, addressed by its ordinal among text blocks
 * (0 = first text block, 1 = second, …) — a single message bubble may hold
 * several text blocks and each is independently editable. Only the target
 * {type:'text'} block's `.text` is touched, so the surrounding structure (tool
 * calls, thinking, ordering) is preserved.
 *
 * - message.content is a string → only ordinal 0 is valid (the whole string).
 * - message.content is an array → the ordinal-th text block is replaced.
 * No-op if the row is unparseable, has no message, the ordinal is out of
 * range, or the resulting line is unchanged.
 */
export function applyBlockTextEdit(
  d: Draft,
  key: string,
  textOrdinal: number,
  newText: string
): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const obj = parseLine(row.value);
  if (obj === null) return d;

  const msg = obj['message'] as Record<string, unknown> | undefined;
  if (!msg) return d;

  const cloned = deepClone(obj);
  const clonedMsg = cloned['message'] as Record<string, unknown>;
  const content = clonedMsg['content'];

  if (typeof content === 'string') {
    if (textOrdinal !== 0) return d;
    clonedMsg['content'] = newText;
  } else if (Array.isArray(content)) {
    const arr = content as Array<{ type: string; text?: string }>;
    let seen = -1;
    let target = -1;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].type === 'text') {
        seen++;
        if (seen === textOrdinal) { target = i; break; }
      }
    }
    if (target < 0) return d;
    arr[target] = { ...arr[target], text: newText };
  } else {
    return d;
  }

  const newValue = stringifyLine(cloned);
  if (newValue === row.value) return d;
  return { ...d, rows: { ...d.rows, [key]: { ...row, value: newValue } } };
}

// ── Soft delete ──────────────────────────────────────────────────────────────
//
// Deletion granularity is the content block, addressed by `blockKey` (see
// above). The real Claude Code CLI rejects a session where a `tool_use` has
// no matching `tool_result` (or vice versa) — the exact corruption class
// issue #13/Phase 11 fought — so deleting either half of a tool_use/
// tool_result pair MUST also delete (or restore) its partner. `expandWithToolPairs`
// is that cascade; every wrapper below except `deleteMessage`/`deleteThinking`
// (whose block types are never paired) routes through it, in both directions.

interface ToolBlockRef {
  key: string;                        // blockKey of this block
  kind: 'tool_use' | 'tool_result';
  toolId: string;                     // tool_use.id / tool_result.tool_use_id
}

/** Scan every row's CURRENT value for tool_use/tool_result blocks, so pairs
 *  can be found across rows (a tool_use on an assistant line pairs with a
 *  tool_result on the following user line). */
function indexToolBlocks(d: Draft): ToolBlockRef[] {
  const out: ToolBlockRef[] = [];
  for (const key of d.order) {
    const row = d.rows[key];
    const obj = parseLine(row.value);
    if (!obj) continue;
    const msg = obj['message'] as Record<string, unknown> | undefined;
    const content = msg?.['content'];
    if (!Array.isArray(content)) continue;
    (content as Record<string, unknown>[]).forEach((b, i) => {
      if (!b || typeof b !== 'object') return;
      if (b['type'] === 'tool_use' && typeof b['id'] === 'string') {
        out.push({ key: blockKey(row, i), kind: 'tool_use', toolId: b['id'] as string });
      } else if (b['type'] === 'tool_result' && typeof b['tool_use_id'] === 'string') {
        out.push({ key: blockKey(row, i), kind: 'tool_result', toolId: b['tool_use_id'] as string });
      }
    });
  }
  return out;
}

/** Expand `keys` to include each tool_use/tool_result block's paired partner
 *  (by `toolId`), so no (un)delete op can ever produce an orphan. Non-tool
 *  keys (text, thinking) pass through unchanged. */
function expandWithToolPairs(d: Draft, keys: string[]): string[] {
  const toolBlocks = indexToolBlocks(d);
  const byKey = new Map(toolBlocks.map((b) => [b.key, b]));
  const result = new Set(keys);
  for (const k of keys) {
    const info = byKey.get(k);
    if (!info) continue;
    for (const other of toolBlocks) {
      if (other.toolId === info.toolId && other.kind !== info.kind) {
        result.add(other.key);
      }
    }
  }
  return [...result];
}

/** Generic primitive: mark/unmark a set of block keys as deleted. No cascade
 *  — callers that need the tool_use/tool_result pairing guarantee go through
 *  `expandWithToolPairs` first (see the wrappers below). */
export function setDeleted(d: Draft, keys: string[], deleted: boolean): Draft {
  const next = new Set(d.deletedBlocks);
  for (const k of keys) {
    if (deleted) next.add(k);
    else next.delete(k);
  }
  return { ...d, deletedBlocks: next };
}

/** Delete one user/assistant text block. Text is never paired, so no cascade. */
export function deleteMessage(d: Draft, key: string): Draft {
  return setDeleted(d, [key], true);
}

/** Delete one thinking block. Thinking is never paired, so no cascade. */
export function deleteThinking(d: Draft, key: string): Draft {
  return setDeleted(d, [key], true);
}

/** Delete a tool group — one or all of its member block keys (thinking +
 *  tool_use + tool_result). Cascade-aware: deleting a tool_use or
 *  tool_result also deletes its paired partner, even if that partner isn't
 *  in `keys` (e.g. a single member-by-member delete of just the tool_use). */
export function deleteToolGroup(d: Draft, keys: string[]): Draft {
  return setDeleted(d, expandWithToolPairs(d, keys), true);
}

/** Delete an arbitrary selection of block keys (bulk multi-select). Same
 *  cascade guarantee as `deleteToolGroup`. */
export function deleteBulk(d: Draft, keys: string[]): Draft {
  return setDeleted(d, expandWithToolPairs(d, keys), true);
}

/** Undelete (restore) a set of block keys. Cascade-aware in the SAME
 *  direction as delete — restoring a tool_use also restores its paired
 *  tool_result (and vice versa), so undelete can never leave an orphan
 *  half-restored either. */
export function undelete(d: Draft, keys: string[]): Draft {
  return setDeleted(d, expandWithToolPairs(d, keys), false);
}

// ── SessionInfo + extractSessionInfo ──────────────────────────────────────────

export interface SessionInfo {
  cwd: string;
  gitBranch: string;
  versions: string[];      // distinct CLI version values, first-seen order
  models: string[];        // distinct message.model values, first-seen order
  permissionMode: string;  // last 'permission-mode' line's permissionMode
  firstTs: string;
  lastTs: string;
  userCount: number;
  assistantCount: number;
  lineCount: number;
}

/** Scan all lines and extract session-level metadata. */
export function extractSessionInfo(rawText: string): SessionInfo {
  const lines = rawText.split('\n').filter(l => l.trim() !== '');

  let cwd = '';
  let gitBranch = '';
  const versions: string[] = [];
  const models: string[] = [];
  let permissionMode = '';
  let firstTs = '';
  let lastTs = '';
  let userCount = 0;
  let assistantCount = 0;
  const lineCount = lines.length;

  for (const line of lines) {
    const obj = parseLine(line);
    if (obj === null) continue;

    const type = typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
    const msg = obj['message'] as Record<string, unknown> | undefined;

    // Extract cwd and gitBranch (first seen)
    if (!cwd && typeof obj['cwd'] === 'string') cwd = obj['cwd'] as string;
    if (!gitBranch && typeof obj['gitBranch'] === 'string') gitBranch = obj['gitBranch'] as string;

    // Extract CLI version (distinct first-seen)
    if (typeof obj['version'] === 'string' && (obj['version'] as string) && !versions.includes(obj['version'] as string)) {
      versions.push(obj['version'] as string);
    }

    // Extract model (distinct first-seen)
    if (msg && typeof msg['model'] === 'string' && (msg['model'] as string) && !models.includes(msg['model'] as string)) {
      models.push(msg['model'] as string);
    }

    // permissionMode: last 'permission-mode' line's permissionMode field
    if (type === 'permission-mode' && typeof obj['permissionMode'] === 'string') {
      permissionMode = obj['permissionMode'] as string;
    }

    // Timestamps: first and last non-empty
    if (typeof obj['timestamp'] === 'string' && (obj['timestamp'] as string)) {
      if (!firstTs) firstTs = obj['timestamp'] as string;
      lastTs = obj['timestamp'] as string;
    }

    // Counts
    if (type === 'user') userCount++;
    if (type === 'assistant') assistantCount++;
  }

  return {
    cwd,
    gitBranch,
    versions,
    models,
    permissionMode,
    firstTs,
    lastTs,
    userCount,
    assistantCount,
    lineCount,
  };
}
