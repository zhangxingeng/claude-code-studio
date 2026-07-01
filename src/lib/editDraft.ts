/**
 * editDraft.ts — Pure TypeScript edit model for JSONL sessions.
 * No DOM, no Svelte, no Tauri imports.
 *
 * Implements the Draft model: version-tracked rows, serialization, field
 * editing, reorder, delete/restore, preview helpers, and session info extraction.
 */

// ── Enum catalogs ──────────────────────────────────────────────────────────────

export const KNOWN_MODELS = ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', '<synthetic>'];
export const ENTRY_TYPES = ['user', 'assistant', 'system', 'attachment', 'ai-title', 'custom-title', 'agent-name', 'agent-setting', 'mode', 'permission-mode', 'last-prompt', 'bridge-session', 'queue-operation', 'file-history-snapshot'];
export const PERMISSION_MODES = ['default', 'plan', 'acceptEdits', 'bypassPermissions'];
export const MESSAGE_ROLES = ['user', 'assistant'];

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DraftRow {
  key: string;           // uuid if the line parses & has a string uuid, else `idx:<originalIndex>`
  originalIndex: number; // 0-based position in the original file
  type: string;          // entry `type` ('' if unparseable)
  uuid: string | null;
  versions: string[];    // versions[0] = exact original line text; edits appended
  active: number;        // index into versions
  deleted: boolean;
}

export interface Draft {
  sessionPath: string;
  order: string[];       // row keys in display order
  rows: Record<string, DraftRow>;
  createdAt: number;     // unix secs, passed in (do NOT call Date.now in this module)
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseVersion(text: string): Record<string, unknown> | null {
  try {
    const obj = JSON.parse(text);
    if (typeof obj === 'object' && obj !== null) return obj as Record<string, unknown>;
    return null;
  } catch {
    return null;
  }
}

function parseActive(row: DraftRow): Record<string, unknown> | null {
  return parseVersion(row.versions[row.active]);
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val)) as T;
}

/**
 * Append `newVersion` as a new active version of `row` — UNLESS it is byte-identical
 * to the row's current active version, in which case the edit is a no-op and the
 * draft is returned unchanged (so "double-click a cell and immediately save without
 * changing anything" never manufactures a phantom version). `extra` merges extra
 * DraftRow fields (uuid/type) that the caller derived from the new content.
 */
function commitVersion(
  d: Draft,
  row: DraftRow,
  key: string,
  newVersion: string,
  extra: Partial<DraftRow> = {}
): Draft {
  if (newVersion === row.versions[row.active]) return d; // no-op: nothing actually changed
  const newVersions = [...row.versions, newVersion];
  const newRow: DraftRow = {
    ...row,
    ...extra,
    versions: newVersions,
    active: newVersions.length - 1,
  };
  return { ...d, rows: { ...d.rows, [key]: newRow } };
}

/**
 * Extract the human-readable text of a raw JSONL line: the message.content string,
 * or all {type:'text'} blocks of an array joined by blank lines. Non-text content
 * (tool calls, thinking) is ignored. Used for version diffing. Returns '' if the
 * line is unparseable or carries no text.
 */
export function extractText(line: string): string {
  const obj = parseVersion(line);
  if (obj === null) return '';
  const msg = obj['message'] as Record<string, unknown> | undefined;
  const content = msg?.['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type: string; text?: string }>)
      .filter(b => b && b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n\n');
  }
  return '';
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

    let obj: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      obj = null;
    }

    const uuid = obj !== null && typeof obj['uuid'] === 'string' ? obj['uuid'] : null;
    const type = obj !== null && typeof obj['type'] === 'string' ? (obj['type'] as string) : '';
    // Key rule: use uuid if present and parses, else `idx:<originalIndex>`
    const key = uuid !== null ? uuid : `idx:${originalIndex}`;

    const row: DraftRow = {
      key,
      originalIndex,
      type,
      uuid,
      versions: [line],
      active: 0,
      deleted: false,
    };

    rows[key] = row;
    order.push(key);
  }

  return { sessionPath, order, rows, createdAt };
}

// ── serializeDraft ─────────────────────────────────────────────────────────────

/**
 * Emit active version of each non-deleted row in `order`, joined '\n' + trailing '\n'.
 * Untouched rows (active===0, never edited) emit their exact original string.
 */
export function serializeDraft(d: Draft): string {
  return (
    d.order
      .filter(key => !d.rows[key].deleted)
      .map(key => {
        const row = d.rows[key];
        return row.versions[row.active];
      })
      .join('\n') + '\n'
  );
}

// ── isDirty ────────────────────────────────────────────────────────────────────

export function isDirty(d: Draft): boolean {
  // Any row deleted
  for (const key of Object.keys(d.rows)) {
    if (d.rows[key].deleted) return true;
  }

  // Any row has been edited (active !== 0)
  for (const key of Object.keys(d.rows)) {
    if (d.rows[key].active !== 0) return true;
  }

  // Order differs from original order (by originalIndex)
  const sortedByOriginal = [...d.order].sort(
    (a, b) => d.rows[a].originalIndex - d.rows[b].originalIndex
  );
  if (d.order.length !== sortedByOriginal.length) return true;
  for (let i = 0; i < d.order.length; i++) {
    if (d.order[i] !== sortedByOriginal[i]) return true;
  }

  return false;
}

// ── getEditableText ────────────────────────────────────────────────────────────

/**
 * Returns the editable text of the active version:
 * - message.content string → return as-is
 * - array → return first text block's .text
 * - else → null
 */
export function getEditableText(row: DraftRow): string | null {
  const obj = parseActive(row);
  if (obj === null) return null;
  const msg = obj['message'] as Record<string, unknown> | undefined;
  if (!msg) return null;
  const content = msg['content'];
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const block = (content as Array<{ type: string; text?: string }>).find(
      b => b.type === 'text'
    );
    return block?.text ?? null;
  }
  return null;
}

// ── applyTextEdit ──────────────────────────────────────────────────────────────

/**
 * Text-edit mapping:
 * - message.content is a string → replace
 * - message.content is an array → replace first {type:'text'} block's .text,
 *   else prepend a new text block
 * Deep-clones active obj, mutates, JSON.stringifies, pushes as new version.
 * No-op if row is unparseable or has no message.
 */
export function applyTextEdit(d: Draft, key: string, newText: string): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const obj = parseActive(row);
  if (obj === null) return d;

  const msg = obj['message'] as Record<string, unknown> | undefined;
  if (!msg) return d;

  const cloned = deepClone(obj);
  const clonedMsg = cloned['message'] as Record<string, unknown>;
  const content = clonedMsg['content'];

  if (typeof content === 'string') {
    clonedMsg['content'] = newText;
  } else if (Array.isArray(content)) {
    const arr = content as Array<{ type: string; text?: string }>;
    const idx = arr.findIndex(b => b.type === 'text');
    if (idx >= 0) {
      arr[idx] = { ...arr[idx], text: newText };
    } else {
      (content as Array<unknown>).unshift({ type: 'text', text: newText });
    }
  } else {
    return d;
  }

  return commitVersion(d, row, key, JSON.stringify(cloned));
}

// ── applyBlockTextEdit ─────────────────────────────────────────────────────────

/**
 * Edit ONE text block of a message, addressed by its ordinal among text blocks
 * (0 = first text block, 1 = second, …). This is the per-block generalization of
 * applyTextEdit: a single message bubble may hold several text blocks and each is
 * independently editable. Only the target {type:'text'} block's `.text` is touched,
 * so the surrounding structure (tool calls, thinking, ordering) is preserved.
 *
 * - message.content is a string → only ordinal 0 is valid (the whole string).
 * - message.content is an array → the ordinal-th text block is replaced.
 * No-op (via commitVersion) if the resulting line is unchanged, or if the row is
 * unparseable / has no message / the ordinal is out of range.
 */
export function applyBlockTextEdit(
  d: Draft,
  key: string,
  textOrdinal: number,
  newText: string
): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const obj = parseActive(row);
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

  return commitVersion(d, row, key, JSON.stringify(cloned));
}

// ── applyFieldEdit ─────────────────────────────────────────────────────────────

/**
 * path in {'type', 'message.model', 'message.role'}.
 * Deep-clones active obj, sets field, pushes new version.
 * No-op if row is unparseable or path requires message but none present.
 */
export function applyFieldEdit(d: Draft, key: string, path: string, value: unknown): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const obj = parseActive(row);
  if (obj === null) return d;

  const cloned = deepClone(obj);

  if (path === 'type') {
    cloned['type'] = value;
  } else if (path === 'message.model') {
    const msg = cloned['message'] as Record<string, unknown> | undefined;
    if (!msg) return d;
    msg['model'] = value;
  } else if (path === 'message.role') {
    const msg = cloned['message'] as Record<string, unknown> | undefined;
    if (!msg) return d;
    msg['role'] = value;
  } else {
    return d;
  }

  return commitVersion(d, row, key, JSON.stringify(cloned));
}

// ── applyRoleEdit ──────────────────────────────────────────────────────────────

/**
 * Flip a message's speaker. Sets BOTH the top-level `type` and `message.role`
 * (which normally mirror each other) in a single new version, so the saved file
 * stays internally consistent. No-op if the row is unparseable.
 */
export function applyRoleEdit(d: Draft, key: string, role: string): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const obj = parseActive(row);
  if (obj === null) return d;

  const cloned = deepClone(obj);
  cloned['type'] = role;
  const msg = cloned['message'] as Record<string, unknown> | undefined;
  if (msg) msg['role'] = role;

  return commitVersion(d, row, key, JSON.stringify(cloned), { type: role });
}

// ── applyRawEdit ─────────────────────────────────────────────────────────────

/**
 * Replace the entire active line with user-supplied raw JSON (power-user
 * escape hatch for tool blocks etc.). The input is parsed and re-stringified to
 * canonical single-line JSON, so the saved file is guaranteed to remain valid,
 * parseable JSONL. THROWS if the input is not a valid JSON object/array — the
 * caller must catch and surface the error (we reject rather than save garbage).
 * The row's stable `key` is preserved even if the uuid changes.
 */
export function applyRawEdit(d: Draft, key: string, newRawLine: string): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const parsed = JSON.parse(newRawLine); // throws on invalid JSON — caller catches
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Top-level JSON must be an object or array.');
  }

  const normalized = JSON.stringify(parsed);
  const obj = Array.isArray(parsed) ? null : (parsed as Record<string, unknown>);
  const newUuid = obj && typeof obj['uuid'] === 'string' ? (obj['uuid'] as string) : row.uuid;
  const newType = obj && typeof obj['type'] === 'string' ? (obj['type'] as string) : row.type;

  return commitVersion(d, row, key, normalized, { uuid: newUuid, type: newType });
}

// ── setActiveVersion ───────────────────────────────────────────────────────────

/** Clamp idx to [0, versions.length-1] and set as active. */
export function setActiveVersion(d: Draft, key: string, idx: number): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const clamped = Math.max(0, Math.min(idx, row.versions.length - 1));
  if (clamped === row.active) return d;

  const newRow: DraftRow = { ...row, active: clamped };

  return {
    ...d,
    rows: { ...d.rows, [key]: newRow },
  };
}

// ── deleteRow ──────────────────────────────────────────────────────────────────

export function deleteRow(d: Draft, key: string): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const newRow: DraftRow = { ...row, deleted: true };

  return {
    ...d,
    rows: { ...d.rows, [key]: newRow },
  };
}

// ── restoreRow ─────────────────────────────────────────────────────────────────

export function restoreRow(d: Draft, key: string): Draft {
  const row = d.rows[key];
  if (!row) return d;

  const newRow: DraftRow = { ...row, deleted: false };

  return {
    ...d,
    rows: { ...d.rows, [key]: newRow },
  };
}

// ── moveUp ─────────────────────────────────────────────────────────────────────

export function moveUp(d: Draft, key: string): Draft {
  const idx = d.order.indexOf(key);
  if (idx <= 0) return d;

  const newOrder = [...d.order];
  [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]];

  return { ...d, order: newOrder };
}

// ── moveDown ───────────────────────────────────────────────────────────────────

export function moveDown(d: Draft, key: string): Draft {
  const idx = d.order.indexOf(key);
  if (idx < 0 || idx >= d.order.length - 1) return d;

  const newOrder = [...d.order];
  [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]];

  return { ...d, order: newOrder };
}

// ── getPreview ─────────────────────────────────────────────────────────────────

export interface RowPreview {
  role: string;
  msgClass: string;
  summaryText: string | null;
  kind: 'text' | 'tool' | 'thinking' | 'raw';
  isTextEditable: boolean;
}

/** Produce a preview descriptor from the ACTIVE version of the row. */
export function getPreview(row: DraftRow): RowPreview {
  const obj = parseActive(row);

  if (obj === null) {
    return {
      role: 'raw',
      msgClass: '',
      summaryText: row.versions[row.active].slice(0, 200),
      kind: 'raw',
      isTextEditable: false,
    };
  }

  const msg = obj['message'] as Record<string, unknown> | undefined;
  const role =
    (msg?.['role'] as string | undefined) ??
    (obj['type'] as string | undefined) ??
    'unknown';

  let msgClass = '';
  if (role === 'user') msgClass = 'msg--user';
  else if (role === 'assistant') msgClass = 'msg--assistant';

  const content = msg?.['content'];
  let summaryText: string | null = null;
  let isTextEditable = false;
  let kind: 'text' | 'tool' | 'thinking' | 'raw' = 'raw';

  if (typeof content === 'string') {
    summaryText = content;
    isTextEditable = true;
    kind = 'text';
  } else if (Array.isArray(content)) {
    const blocks = content as Array<{
      type: string;
      text?: string;
      name?: string;
      thinking?: string;
    }>;
    const textBlock = blocks.find(b => b.type === 'text');
    const toolBlock = blocks.find(b => b.type === 'tool_use');
    const thinkingBlock = blocks.find(b => b.type === 'thinking');

    if (textBlock) {
      summaryText = textBlock.text ?? null;
      isTextEditable = true;
      kind = 'text';
    } else if (toolBlock) {
      summaryText = `Tool: ${toolBlock.name ?? 'unknown'}`;
      msgClass = 'msg--tool';
      kind = 'tool';
    } else if (thinkingBlock) {
      summaryText = 'Thinking';
      msgClass = 'msg--thinking';
      kind = 'thinking';
    }
  }

  return { role, msgClass, summaryText, kind, isTextEditable };
}

// ── getRowFields ───────────────────────────────────────────────────────────────

export interface RowFields {
  type: string | null;  // present enum fields of active version (null if absent)
  model: string | null;
  role: string | null;
}

export function getRowFields(row: DraftRow): RowFields {
  const obj = parseActive(row);
  if (obj === null) return { type: null, model: null, role: null };

  const type = typeof obj['type'] === 'string' ? (obj['type'] as string) : null;
  const msg = obj['message'] as Record<string, unknown> | undefined;
  const model = msg && typeof msg['model'] === 'string' ? (msg['model'] as string) : null;
  const role = msg && typeof msg['role'] === 'string' ? (msg['role'] as string) : null;

  return { type, model, role };
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
    let obj: Record<string, unknown> | null = null;
    try {
      const parsed = JSON.parse(line);
      if (typeof parsed === 'object' && parsed !== null) {
        obj = parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }

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
