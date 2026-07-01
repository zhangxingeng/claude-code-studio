/**
 * Smoke test for editDraft.ts.
 * Run with: npx tsx tests/edit_smoke.mjs   (from repo root)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const {
  buildDraft,
  serializeDraft,
  isDirty,
  getEditableText,
  applyTextEdit,
  applyBlockTextEdit,
  applyFieldEdit,
  applyRoleEdit,
  applyRawEdit,
  extractText,
  setActiveVersion,
  deleteRow,
  restoreRow,
  moveUp,
  moveDown,
  getPreview,
  getRowFields,
  extractSessionInfo,
  KNOWN_MODELS,
  ENTRY_TYPES,
  PERMISSION_MODES,
  MESSAGE_ROLES,
} = await import(join(root, 'src/lib/editDraft.ts'));

// ── Test helpers ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ok  ${msg}`);
    passed++;
  } else {
    console.error(`  FAIL ${msg}`);
    failed++;
  }
}

// ── Mock JSONL fixtures ───────────────────────────────────────────────────────

// uuid-bearing user line (string content)
const LINE_USER = JSON.stringify({
  type: 'user',
  uuid: 'user-uuid-001',
  timestamp: '2024-01-01T10:00:00Z',
  cwd: '/home/user/project',
  gitBranch: 'main',
  version: '1.0.0',
  message: { role: 'user', content: 'Hello, world!' },
});

// assistant line with tool_use + thinking + text blocks
const LINE_ASSISTANT = JSON.stringify({
  type: 'assistant',
  uuid: 'asst-uuid-001',
  timestamp: '2024-01-01T10:00:01Z',
  message: {
    role: 'assistant',
    model: 'claude-opus-4-8',
    content: [
      { type: 'thinking', thinking: 'I am thinking...' },
      { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
      { type: 'text', text: 'Here is my answer.' },
    ],
  },
});

// uuid-less ai-title line (fallback to idx key)
const LINE_AI_TITLE = JSON.stringify({
  type: 'ai-title',
  timestamp: '2024-01-01T10:00:02Z',
  message: { content: 'My Session Title' },
});

// permission-mode line (no uuid, no timestamp)
const LINE_PERM = JSON.stringify({
  type: 'permission-mode',
  permissionMode: 'bypassPermissions',
});

const RAW_TEXT = [LINE_USER, LINE_ASSISTANT, LINE_AI_TITLE, LINE_PERM].join('\n') + '\n';

// ── Test: buildDraft keys ─────────────────────────────────────────────────────
console.log('\n[buildDraft — keys]');
const draft0 = buildDraft(RAW_TEXT, '/fake/path.jsonl', 1700000000);
const keys = draft0.order;
assert(keys.length === 4, `order has 4 keys (got ${keys.length})`);
assert(keys[0] === 'user-uuid-001', `user key is uuid: "${keys[0]}"`);
assert(keys[1] === 'asst-uuid-001', `assistant key is uuid: "${keys[1]}"`);
assert(keys[2] === 'idx:2', `ai-title key is idx fallback: "${keys[2]}"`);
assert(keys[3] === 'idx:3', `permission-mode key is idx fallback: "${keys[3]}"`);
assert(draft0.rows['user-uuid-001'].uuid === 'user-uuid-001', 'user row uuid set');
assert(draft0.rows['idx:2'].uuid === null, 'ai-title row uuid is null');
assert(draft0.rows['idx:2'].type === 'ai-title', 'ai-title row type correct');
assert(draft0.createdAt === 1700000000, 'createdAt passed through');

// ── Test: versions[0] = exact original ────────────────────────────────────────
console.log('\n[buildDraft — versions byte-faithful]');
assert(draft0.rows['user-uuid-001'].versions[0] === LINE_USER, 'user row versions[0] exact');
assert(draft0.rows['user-uuid-001'].versions.length === 1, 'user row has 1 version initially');
assert(draft0.rows['user-uuid-001'].active === 0, 'user row active=0');

// ── Test: isDirty false on fresh draft ────────────────────────────────────────
console.log('\n[isDirty]');
assert(!isDirty(draft0), 'isDirty false on fresh draft');

// ── Test: serializeDraft byte-preserves untouched lines ──────────────────────
console.log('\n[serializeDraft — untouched]');
const serialized0 = serializeDraft(draft0);
const sLines0 = serialized0.split('\n');
assert(sLines0[sLines0.length - 1] === '', 'trailing newline');
const sLines = sLines0.slice(0, -1);
assert(sLines[0] === LINE_USER, 'user line byte-identical');
assert(sLines[1] === LINE_ASSISTANT, 'assistant line byte-identical');
assert(sLines[2] === LINE_AI_TITLE, 'ai-title line byte-identical');
assert(sLines[3] === LINE_PERM, 'permission-mode line byte-identical');

// ── Test: serializeDraft drops deleted rows ────────────────────────────────────
console.log('\n[serializeDraft — drops deleted]');
const draftDeleted = deleteRow(draft0, 'asst-uuid-001');
assert(draftDeleted.rows['asst-uuid-001'].deleted === true, 'assistant row deleted');
assert(isDirty(draftDeleted), 'isDirty true after delete');
const serializedDeleted = serializeDraft(draftDeleted);
const deletedLines = serializedDeleted.split('\n').slice(0, -1);
assert(deletedLines.length === 3, `deleted draft has 3 lines (got ${deletedLines.length})`);
assert(!deletedLines.includes(LINE_ASSISTANT), 'deleted line not in output');

// ── Test: restoreRow ──────────────────────────────────────────────────────────
console.log('\n[restoreRow]');
const draftRestored = restoreRow(draftDeleted, 'asst-uuid-001');
assert(!draftRestored.rows['asst-uuid-001'].deleted, 'assistant row restored');
const serializedRestored = serializeDraft(draftRestored);
assert(serializedRestored === serialized0, 'restored serialization identical to original');

// ── Test: applyTextEdit — string content ──────────────────────────────────────
console.log('\n[applyTextEdit — string content]');
const draft1 = applyTextEdit(draft0, 'user-uuid-001', 'Updated text');
assert(draft1.rows['user-uuid-001'].versions.length === 2, 'user row has 2 versions');
assert(draft1.rows['user-uuid-001'].active === 1, 'user row active=1');
const editedText = getEditableText(draft1.rows['user-uuid-001']);
assert(editedText === 'Updated text', `getEditableText returns new text: "${editedText}"`);
assert(isDirty(draft1), 'isDirty true after text edit');
// Serialized uses new text
const s1Lines = serializeDraft(draft1).split('\n').slice(0, -1);
const parsed1 = JSON.parse(s1Lines[0]);
assert(parsed1.message.content === 'Updated text', 'serialized string content matches');
// Other lines byte-identical
assert(s1Lines[1] === LINE_ASSISTANT, 'untouched assistant line unchanged');
assert(s1Lines[2] === LINE_AI_TITLE, 'untouched ai-title line unchanged');

// ── Test: setActiveVersion reverts to original ────────────────────────────────
console.log('\n[setActiveVersion — revert to 0]');
const draft1Rev = setActiveVersion(draft1, 'user-uuid-001', 0);
assert(draft1Rev.rows['user-uuid-001'].active === 0, 'active back to 0');
const s1RevLines = serializeDraft(draft1Rev).split('\n').slice(0, -1);
assert(s1RevLines[0] === LINE_USER, 'reverted line byte-identical to original');
// isDirty: active=0 again, but versions array still has 2 entries — is that dirty?
// No: the contract says "any active!==0" — here active===0, so NOT dirty
assert(!isDirty(draft1Rev), 'isDirty false after revert to v0');

// ── Test: setActiveVersion clamping ───────────────────────────────────────────
const draftClamped = setActiveVersion(draft1, 'user-uuid-001', 999);
assert(draftClamped.rows['user-uuid-001'].active === 1, 'clamped high to last index');
const draftClampedLow = setActiveVersion(draft1, 'user-uuid-001', -5);
assert(draftClampedLow.rows['user-uuid-001'].active === 0, 'clamped low to 0');

// ── Test: applyTextEdit — array with text block ───────────────────────────────
console.log('\n[applyTextEdit — array with text block]');
const draft2 = applyTextEdit(draft0, 'asst-uuid-001', 'New assistant text');
assert(draft2.rows['asst-uuid-001'].versions.length === 2, 'assistant row has 2 versions');
assert(draft2.rows['asst-uuid-001'].active === 1, 'assistant row active=1');
const editedAsstText = getEditableText(draft2.rows['asst-uuid-001']);
assert(editedAsstText === 'New assistant text', `assistant getEditableText: "${editedAsstText}"`);
// Verify thinking block preserved
const asstParsed = JSON.parse(draft2.rows['asst-uuid-001'].versions[1]);
const thinkingBlock = asstParsed.message.content.find(b => b.type === 'thinking');
assert(thinkingBlock?.thinking === 'I am thinking...', 'thinking block preserved after text edit');
const toolBlock = asstParsed.message.content.find(b => b.type === 'tool_use');
assert(toolBlock?.name === 'Bash', 'tool_use block preserved after text edit');

// ── Test: applyFieldEdit — message.model ─────────────────────────────────────
console.log('\n[applyFieldEdit — message.model]');
const draft3 = applyFieldEdit(draft0, 'asst-uuid-001', 'message.model', 'claude-sonnet-4-6');
assert(draft3.rows['asst-uuid-001'].versions.length === 2, 'assistant row has 2 versions after field edit');
assert(draft3.rows['asst-uuid-001'].active === 1, 'assistant active=1 after field edit');
const fieldEditedModel = JSON.parse(draft3.rows['asst-uuid-001'].versions[1]);
assert(fieldEditedModel.message.model === 'claude-sonnet-4-6', `model changed: "${fieldEditedModel.message.model}"`);
assert(isDirty(draft3), 'isDirty true after field edit');

// ── Test: applyFieldEdit — type ───────────────────────────────────────────────
const draft4 = applyFieldEdit(draft0, 'user-uuid-001', 'type', 'system');
const typeEdited = JSON.parse(draft4.rows['user-uuid-001'].versions[1]);
assert(typeEdited.type === 'system', `type changed: "${typeEdited.type}"`);

// ── Test: applyFieldEdit — message.role ──────────────────────────────────────
const draft5 = applyFieldEdit(draft0, 'user-uuid-001', 'message.role', 'assistant');
const roleEdited = JSON.parse(draft5.rows['user-uuid-001'].versions[1]);
assert(roleEdited.message.role === 'assistant', `role changed: "${roleEdited.message.role}"`);

// ── Test: moveUp / moveDown ───────────────────────────────────────────────────
console.log('\n[moveUp / moveDown]');
const draftMoved = moveDown(draft0, 'user-uuid-001');
assert(draftMoved.order[0] === 'asst-uuid-001', 'after moveDown, asst is at 0');
assert(draftMoved.order[1] === 'user-uuid-001', 'after moveDown, user is at 1');
assert(isDirty(draftMoved), 'isDirty true after reorder');

const draftMovedBack = moveUp(draftMoved, 'user-uuid-001');
assert(draftMovedBack.order[0] === 'user-uuid-001', 'after moveUp, user is at 0');
assert(draftMovedBack.order[1] === 'asst-uuid-001', 'after moveUp, asst is at 1');
assert(!isDirty(draftMovedBack), 'isDirty false after reorder back to original');

// Boundary: moveUp on first row is no-op
const noOpUp = moveUp(draft0, 'user-uuid-001');
assert(noOpUp.order[0] === 'user-uuid-001', 'moveUp on first row is no-op');

// Boundary: moveDown on last row is no-op
const lastKey = draft0.order[draft0.order.length - 1];
const noOpDown = moveDown(draft0, lastKey);
assert(noOpDown.order[noOpDown.order.length - 1] === lastKey, 'moveDown on last row is no-op');

// ── Test: getPreview — text kinds ─────────────────────────────────────────────
console.log('\n[getPreview — text kinds]');
const p0 = getPreview(draft0.rows['user-uuid-001']);
assert(p0.role === 'user', `user role: "${p0.role}"`);
assert(p0.kind === 'text', `user kind: "${p0.kind}"`);
assert(p0.isTextEditable === true, 'user (string content) is editable');
assert(p0.summaryText === 'Hello, world!', `user summaryText: "${p0.summaryText}"`);
assert(p0.msgClass === 'msg--user', `user msgClass: "${p0.msgClass}"`);

// Assistant has text block (plus thinking + tool_use) — text wins
const p1 = getPreview(draft0.rows['asst-uuid-001']);
assert(p1.role === 'assistant', `asst role: "${p1.role}"`);
assert(p1.kind === 'text', `asst kind (has text block): "${p1.kind}"`);
assert(p1.isTextEditable === true, 'asst (array with text block) editable');
assert(p1.summaryText === 'Here is my answer.', `asst summaryText: "${p1.summaryText}"`);
assert(p1.msgClass === 'msg--assistant', `asst msgClass: "${p1.msgClass}"`);

// ── Test: getPreview — tool-only ──────────────────────────────────────────────
console.log('\n[getPreview — tool kind]');
const LINE_TOOL = JSON.stringify({
  type: 'assistant',
  uuid: 'asst-tool-only',
  message: {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 'tu2', name: 'Read', input: {} }],
  },
});
const draftTool = buildDraft(LINE_TOOL + '\n', '/fake.jsonl', 1700000000);
const pTool = getPreview(draftTool.rows['asst-tool-only']);
assert(pTool.kind === 'tool', `tool kind: "${pTool.kind}"`);
assert(pTool.isTextEditable === false, 'tool-only not editable');
assert(pTool.msgClass === 'msg--tool', `tool msgClass: "${pTool.msgClass}"`);
assert(pTool.summaryText === 'Tool: Read', `tool summaryText: "${pTool.summaryText}"`);

// ── Test: getPreview — thinking-only ─────────────────────────────────────────
console.log('\n[getPreview — thinking kind]');
const LINE_THINKING = JSON.stringify({
  type: 'assistant',
  uuid: 'asst-thinking-only',
  message: {
    role: 'assistant',
    content: [{ type: 'thinking', thinking: 'Deep thoughts...' }],
  },
});
const draftThinking = buildDraft(LINE_THINKING + '\n', '/fake.jsonl', 1700000000);
const pThinking = getPreview(draftThinking.rows['asst-thinking-only']);
assert(pThinking.kind === 'thinking', `thinking kind: "${pThinking.kind}"`);
assert(pThinking.isTextEditable === false, 'thinking-only not editable');
assert(pThinking.msgClass === 'msg--thinking', `thinking msgClass: "${pThinking.msgClass}"`);

// ── Test: getPreview — raw (unparseable) ──────────────────────────────────────
console.log('\n[getPreview — raw kind]');
const LINE_RAW = 'not-valid-json at all {{{';
const draftRaw = buildDraft(LINE_RAW + '\n', '/fake.jsonl', 1700000000);
const firstRawKey = draftRaw.order[0];
const pRaw = getPreview(draftRaw.rows[firstRawKey]);
assert(pRaw.kind === 'raw', `raw kind: "${pRaw.kind}"`);
assert(pRaw.role === 'raw', `raw role: "${pRaw.role}"`);
assert(pRaw.isTextEditable === false, 'raw row not editable');
assert(pRaw.msgClass === '', `raw msgClass: "${pRaw.msgClass}"`);

// ── Test: getRowFields ────────────────────────────────────────────────────────
console.log('\n[getRowFields]');
const fields0 = getRowFields(draft0.rows['user-uuid-001']);
assert(fields0.type === 'user', `user type field: "${fields0.type}"`);
assert(fields0.role === 'user', `user role field: "${fields0.role}"`);
assert(fields0.model === null, 'user model field is null');

const fields1 = getRowFields(draft0.rows['asst-uuid-001']);
assert(fields1.type === 'assistant', `asst type field: "${fields1.type}"`);
assert(fields1.role === 'assistant', `asst role field: "${fields1.role}"`);
assert(fields1.model === 'claude-opus-4-8', `asst model field: "${fields1.model}"`);

// After field edit, getRowFields reads from active version
const fields3 = getRowFields(draft3.rows['asst-uuid-001']);
assert(fields3.model === 'claude-sonnet-4-6', `after applyFieldEdit, model: "${fields3.model}"`);

// ── Test: extractSessionInfo ──────────────────────────────────────────────────
console.log('\n[extractSessionInfo]');
const info = extractSessionInfo(RAW_TEXT);
assert(info.cwd === '/home/user/project', `cwd: "${info.cwd}"`);
assert(info.gitBranch === 'main', `gitBranch: "${info.gitBranch}"`);
assert(info.versions.includes('1.0.0'), `versions includes '1.0.0': ${JSON.stringify(info.versions)}`);
assert(info.models.includes('claude-opus-4-8'), `models includes 'claude-opus-4-8': ${JSON.stringify(info.models)}`);
assert(info.permissionMode === 'bypassPermissions', `permissionMode: "${info.permissionMode}"`);
assert(info.firstTs === '2024-01-01T10:00:00Z', `firstTs: "${info.firstTs}"`);
assert(info.lastTs === '2024-01-01T10:00:02Z', `lastTs: "${info.lastTs}"`);
assert(info.userCount === 1, `userCount: ${info.userCount}`);
assert(info.assistantCount === 1, `assistantCount: ${info.assistantCount}`);
assert(info.lineCount === 4, `lineCount: ${info.lineCount}`);

// ── Test: enum catalogs ───────────────────────────────────────────────────────
console.log('\n[enum catalogs]');
assert(Array.isArray(KNOWN_MODELS) && KNOWN_MODELS.includes('claude-opus-4-8'), 'KNOWN_MODELS has claude-opus-4-8');
assert(Array.isArray(KNOWN_MODELS) && KNOWN_MODELS.includes('<synthetic>'), 'KNOWN_MODELS has <synthetic>');
assert(Array.isArray(ENTRY_TYPES) && ENTRY_TYPES.includes('user'), 'ENTRY_TYPES has user');
assert(Array.isArray(ENTRY_TYPES) && ENTRY_TYPES.includes('ai-title'), 'ENTRY_TYPES has ai-title');
assert(Array.isArray(PERMISSION_MODES) && PERMISSION_MODES.includes('bypassPermissions'), 'PERMISSION_MODES has bypassPermissions');
assert(Array.isArray(PERMISSION_MODES) && PERMISSION_MODES.includes('default'), 'PERMISSION_MODES has default');
assert(Array.isArray(MESSAGE_ROLES) && MESSAGE_ROLES.includes('user'), 'MESSAGE_ROLES has user');
assert(Array.isArray(MESSAGE_ROLES) && MESSAGE_ROLES.includes('assistant'), 'MESSAGE_ROLES has assistant');

// ── Test: applyRoleEdit flips both type and message.role atomically ───────────
console.log('\n[applyRoleEdit]');
{
  const line = JSON.stringify({ type: 'assistant', uuid: 'r1', message: { role: 'assistant', content: 'hi' } });
  let d = buildDraft(line + '\n', '/p', 0);
  d = applyRoleEdit(d, 'r1', 'user');
  const obj = JSON.parse(serializeDraft(d).trim());
  assert(obj.type === 'user', `top-level type flipped: ${obj.type}`);
  assert(obj.message.role === 'user', `message.role flipped: ${obj.message.role}`);
  assert(d.rows['r1'].versions.length === 2, 'role edit appended one version');
  assert(d.rows['r1'].active === 1, 'role edit active points at new version');
  // version 1 (original) still intact for ◀ recovery
  assert(JSON.parse(d.rows['r1'].versions[0]).type === 'assistant', 'original version preserved');
}

// ── Test: applyRawEdit validates + normalizes; rejects invalid JSON ──────────
console.log('\n[applyRawEdit]');
{
  const line = JSON.stringify({ type: 'user', uuid: 'x1', message: { role: 'user', content: 'a' } });
  let d = buildDraft(line + '\n', '/p', 0);

  // Valid raw edit (pretty/multi-line input) is accepted and collapsed to one line
  const pretty = '{\n  "type": "user",\n  "uuid": "x1",\n  "message": { "role": "user", "content": "b" }\n}';
  d = applyRawEdit(d, 'x1', pretty);
  const out = serializeDraft(d).trim();
  assert(out.split('\n').length === 1, 'raw edit result is a single JSONL line');
  assert(JSON.parse(out).message.content === 'b', 'raw edit applied new content');
  assert(d.rows['x1'].key === 'x1', 'row key stays stable across raw edit');

  // Invalid JSON is rejected (throws), draft untouched by caller
  let threw = false;
  try { applyRawEdit(d, 'x1', '{ not valid json '); } catch { threw = true; }
  assert(threw, 'invalid JSON raw edit throws');

  // Non-object/array top-level is rejected
  let threw2 = false;
  try { applyRawEdit(d, 'x1', '42'); } catch { threw2 = true; }
  assert(threw2, 'bare scalar raw edit throws');
}

// ── Test: no-op edits do not manufacture a version ───────────────────────────
console.log('\n[no-op edit detection]');
{
  // Editing a cell to the SAME text must not append a version or mark dirty.
  const same = applyTextEdit(draft0, 'user-uuid-001', 'Hello, world!');
  assert(same.rows['user-uuid-001'].versions.length === 1, 'applyTextEdit same string: no new version');
  assert(same === draft0, 'applyTextEdit no-op returns the same draft object');
  assert(!isDirty(same), 'applyTextEdit no-op leaves draft clean');

  // Same via per-block edit on the array-content assistant text block.
  const sameBlock = applyBlockTextEdit(draft0, 'asst-uuid-001', 0, 'Here is my answer.');
  assert(sameBlock.rows['asst-uuid-001'].versions.length === 1, 'applyBlockTextEdit same text: no new version');
  assert(sameBlock === draft0, 'applyBlockTextEdit no-op returns same draft');

  // Role edit to the same role is a no-op.
  const sameRole = applyRoleEdit(draft0, 'user-uuid-001', 'user');
  assert(sameRole === draft0, 'applyRoleEdit to same role is a no-op');

  // Raw edit that re-stringifies to the identical line is a no-op.
  const sameRaw = applyRawEdit(draft0, 'user-uuid-001', draft0.rows['user-uuid-001'].versions[0]);
  assert(sameRaw === draft0, 'applyRawEdit to identical line is a no-op');

  // A genuine change still appends (guards against over-eager no-op).
  const changed = applyTextEdit(draft0, 'user-uuid-001', 'Different!');
  assert(changed.rows['user-uuid-001'].versions.length === 2, 'genuine edit still appends a version');
}

// ── Test: applyBlockTextEdit targets a specific text block by ordinal ─────────
console.log('\n[applyBlockTextEdit — ordinal targeting]');
{
  // Message with TWO text blocks around a tool_use — edit each independently.
  const line = JSON.stringify({
    type: 'assistant',
    uuid: 'multi-1',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'first' },
        { type: 'tool_use', id: 't', name: 'Bash', input: {} },
        { type: 'text', text: 'second' },
      ],
    },
  });
  let d = buildDraft(line + '\n', '/p', 0);

  // Edit ordinal 1 (the SECOND text block) — first must be untouched.
  d = applyBlockTextEdit(d, 'multi-1', 1, 'SECOND-EDITED');
  const c = JSON.parse(d.rows['multi-1'].versions[d.rows['multi-1'].active]).message.content;
  assert(c[0].text === 'first', 'ordinal edit left first text block untouched');
  assert(c[2].text === 'SECOND-EDITED', 'ordinal 1 edited the second text block');
  assert(c[1].type === 'tool_use' && c[1].name === 'Bash', 'tool_use between text blocks preserved');

  // Edit ordinal 0 (the FIRST text block) on the freshly-edited draft.
  d = applyBlockTextEdit(d, 'multi-1', 0, 'FIRST-EDITED');
  const c2 = JSON.parse(d.rows['multi-1'].versions[d.rows['multi-1'].active]).message.content;
  assert(c2[0].text === 'FIRST-EDITED', 'ordinal 0 edited the first text block');
  assert(c2[2].text === 'SECOND-EDITED', 'previous ordinal-1 edit retained');

  // Out-of-range ordinal is a no-op.
  const oor = applyBlockTextEdit(d, 'multi-1', 5, 'nope');
  assert(oor === d, 'out-of-range ordinal is a no-op');
}

// ── Test: extractText pulls human text for diffing ────────────────────────────
console.log('\n[extractText]');
{
  assert(extractText(LINE_USER) === 'Hello, world!', 'extractText from string content');
  assert(extractText(LINE_ASSISTANT) === 'Here is my answer.', 'extractText from array (text block only)');
  const two = JSON.stringify({ type: 'assistant', uuid: 'z', message: { role: 'assistant', content: [
    { type: 'text', text: 'a' }, { type: 'tool_use', id: 't', name: 'X', input: {} }, { type: 'text', text: 'b' },
  ] } });
  assert(extractText(two) === 'a\n\nb', 'extractText joins multiple text blocks with blank line');
  assert(extractText('not json') === '', 'extractText on unparseable line is empty');
  assert(extractText(LINE_PERM) === '', 'extractText on a line with no message is empty');
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} assertions passed.`);
  process.exit(0);
} else {
  console.error(`${failed} FAILED, ${passed} passed.`);
  process.exit(1);
}
