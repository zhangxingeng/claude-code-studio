/**
 * Round-trip corruption hunt for editDraft.ts (issue TBD — "editing a chat
 * corrupts the session file / Claude Code no longer recognizes it").
 *
 * Two properties any edit pipeline over someone else's file format must hold:
 *
 *   1. IDENTITY: buildDraft(raw) -> serializeDraft(...) with NO edits applied
 *      must reproduce `raw` byte-for-byte. Any drift here is a bug in the
 *      draft's own bookkeeping (key collisions, dropped/duplicated lines),
 *      independent of JSON semantics.
 *   2. EDIT FIDELITY: editing ONE field of a line must leave every OTHER
 *      field byte-for-value identical to the original parse. Any drift here
 *      is a bug in the JSON.parse -> mutate -> JSON.stringify round trip
 *      itself (e.g. numeric precision loss), not in our bookkeeping.
 *
 * Fixtures are deliberately adversarial (duplicate uuids, huge integers,
 * unicode/surrogates, numeric-looking object keys) — real Claude Code
 * session files can and do contain any of these, and a smoke fixture that
 * only has "nice" data would never have caught this class of bug.
 *
 * Run with: npx tsx tests/edit_roundtrip_smoke.mjs   (from repo root)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const { buildDraft, serializeDraft, applyBlockTextEdit } = await import(
  join(root, 'src/lib/editDraft.ts')
);

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

// ── Property 1: identity round trip on the real fixture ──────────────────────
console.log('\n[identity round trip — tests/mock_data/session.jsonl]');
{
  const raw = readFileSync(join(root, 'tests/mock_data/session.jsonl'), 'utf-8');
  const draft = buildDraft(raw, '/fake/path.jsonl', 0);
  const out = serializeDraft(draft);
  assert(out === raw, 'buildDraft -> serializeDraft reproduces the real fixture byte-for-byte');
  if (out !== raw) {
    const rawLines = raw.split('\n');
    const outLines = out.split('\n');
    console.error(`    raw has ${rawLines.length} lines, output has ${outLines.length} lines`);
    for (let i = 0; i < Math.max(rawLines.length, outLines.length); i++) {
      if (rawLines[i] !== outLines[i]) {
        console.error(`    first divergent line ${i}:`);
        console.error(`      raw: ${rawLines[i]}`);
        console.error(`      out: ${outLines[i]}`);
        break;
      }
    }
  }
}

// ── Adversarial fixtures ──────────────────────────────────────────────────────

const BIG_INT_UNSAFE = '9223372036854775807'; // i64::MAX — a plausible real field width
const BIG_INT_2_53_PLUS_1 = '9007199254740993'; // first integer JS f64 cannot represent exactly
const LONE_SURROGATE_TEXT = 'before\\ud800after'; // unpaired UTF-16 surrogate, valid inside a JSON string
const EMOJI_TEXT = '😀 unicode 你好世界 مرحبا test';

function line(obj) {
  return JSON.stringify(obj);
}

// Two DIFFERENT lines sharing the same uuid — plausible if a session was
// forked/resumed/merged, or if any producer ever reuses an id.
const DUP_A = line({ type: 'user', uuid: 'dup-1', message: { role: 'user', content: 'first message' } });
const DUP_B = line({ type: 'assistant', uuid: 'dup-1', message: { role: 'assistant', content: 'second message, same uuid' } });

// A line carrying a huge integer alongside editable text (simulates a
// token-usage-style field sitting next to message content).
const BIGINT_LINE = `{"type":"assistant","uuid":"big-1","tokenCount":${BIG_INT_UNSAFE},"message":{"role":"assistant","content":[{"type":"text","text":"edit me"}]}}`;

const BIGINT_2_53_LINE = `{"type":"assistant","uuid":"big-2","tokenCount":${BIG_INT_2_53_PLUS_1},"message":{"role":"assistant","content":[{"type":"text","text":"edit me"}]}}`;

// A line whose text content already has an unpaired surrogate.
const SURROGATE_LINE = line({
  type: 'user',
  uuid: 'surrogate-1',
  message: { role: 'user', content: LONE_SURROGATE_TEXT },
});

// A line with emoji/CJK/RTL in an UNEDITED sibling field, to check the
// identity round trip preserves multi-byte text untouched.
const UNICODE_LINE = line({
  type: 'user',
  uuid: 'unicode-1',
  message: { role: 'user', content: EMOJI_TEXT },
});

// Numeric-looking object keys inside a tool_use input — JS engines reorder
// integer-index-like keys to numeric-ascending order on stringify,
// regardless of insertion order.
const NUMERIC_KEYS_LINE = line({
  type: 'assistant',
  uuid: 'numkeys-1',
  message: {
    role: 'assistant',
    content: [
      { type: 'tool_use', id: 't1', name: 'X', input: { z: 1, '1': 'b', '0': 'a' } },
      { type: 'text', text: 'edit me' },
    ],
  },
});

const TORTURE_LINES = [
  DUP_A, DUP_B, BIGINT_LINE, BIGINT_2_53_LINE, SURROGATE_LINE, UNICODE_LINE, NUMERIC_KEYS_LINE,
];
const TORTURE_RAW = TORTURE_LINES.join('\n') + '\n';

// ── Property 1 on the torture fixture ─────────────────────────────────────────
console.log('\n[identity round trip — adversarial fixture]');
{
  const draft = buildDraft(TORTURE_RAW, '/fake/torture.jsonl', 0);
  assert(
    draft.order.length === TORTURE_LINES.length,
    `order has ${TORTURE_LINES.length} entries (got ${draft.order.length}) — duplicate uuids must not collapse rows`
  );
  const out = serializeDraft(draft);
  assert(out === TORTURE_RAW, 'adversarial fixture round-trips byte-for-byte with no edits');
  if (out !== TORTURE_RAW) {
    console.error(`    raw lines: ${TORTURE_LINES.length}, order keys: ${JSON.stringify(draft.order)}`);
    console.error(`    duplicate uuid 'dup-1' rows in order: ${draft.order.filter((k) => k === 'dup-1').length}`);
    console.error(`    dup-1 row value: ${draft.rows['dup-1']?.value}`);
  }
}

// ── Property 2: editing one field must not disturb the rest of the line ──────
console.log('\n[edit fidelity — huge integer sibling field, i64::MAX]');
{
  let draft = buildDraft(BIGINT_LINE + '\n', '/p', 0);
  draft = applyBlockTextEdit(draft, 'big-1', 0, 'EDITED');
  const savedLine = draft.rows['big-1'].value;
  assert(
    savedLine.includes(`"tokenCount":${BIG_INT_UNSAFE}`),
    `i64::MAX tokenCount survives an unrelated text edit exactly (expected ...${BIG_INT_UNSAFE}...): ${savedLine}`
  );
}

console.log('\n[edit fidelity — integer just past 2^53 precision boundary]');
{
  let draft = buildDraft(BIGINT_2_53_LINE + '\n', '/p', 0);
  draft = applyBlockTextEdit(draft, 'big-2', 0, 'EDITED');
  const savedLine = draft.rows['big-2'].value;
  assert(
    savedLine.includes(`"tokenCount":${BIG_INT_2_53_PLUS_1}`),
    `2^53+1 tokenCount survives an unrelated text edit exactly (expected ...${BIG_INT_2_53_PLUS_1}...): ${savedLine}`
  );
}

console.log('\n[edit fidelity — unpaired UTF-16 surrogate in an untouched sibling row]');
{
  const raw = SURROGATE_LINE + '\n' + BIGINT_LINE + '\n';
  let draft = buildDraft(raw, '/p', 0);
  // Edit an unrelated row; the surrogate-bearing row must stay byte-identical.
  draft = applyBlockTextEdit(draft, 'big-1', 0, 'EDITED');
  assert(
    draft.rows['surrogate-1'].value === draft.rows['surrogate-1'].original,
    'untouched surrogate-bearing row is byte-identical after an unrelated edit'
  );
}

console.log('\n[edit fidelity — numeric-looking object keys preserve their VALUES]');
{
  let draft = buildDraft(NUMERIC_KEYS_LINE + '\n', '/p', 0);
  draft = applyBlockTextEdit(draft, 'numkeys-1', 0, 'EDITED');
  const parsed = JSON.parse(draft.rows['numkeys-1'].value);
  const input = parsed.message.content.find((b) => b.type === 'tool_use').input;
  assert(input.z === 1 && input['1'] === 'b' && input['0'] === 'a', 'tool_use.input values survive regardless of any key reordering');
}

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
if (failed === 0) {
  console.log(`All ${passed} assertions passed.`);
  process.exit(0);
} else {
  console.error(`${failed} FAILED, ${passed} passed.`);
  process.exit(1);
}
