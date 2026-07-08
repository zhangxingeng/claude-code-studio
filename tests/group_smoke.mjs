/**
 * Smoke test for displayModel.ts (grouping).
 * Run with: npx tsx tests/group_smoke.mjs   (from repo root)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const { groupDisplayItems } = await import(join(root, 'src/lib/displayModel.ts'));

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { console.log(`  ok  ${msg}`); passed++; }
  else { console.error(`  FAIL ${msg}`); failed++; }
}

// ── displayModel: groupDisplayItems ──────────────────────────────────────────
// Rows carrying text (a user/assistant message) are their own bubble. A
// maximal run of consecutive rows with NO text (tool calls, tool results,
// standalone thinking) collapses into ONE toolgroup, deletable as a unit AND
// member-by-member (issue #14).
console.log('\n[groupDisplayItems]');
{
  // Empty input.
  assert(groupDisplayItems([]).length === 0, 'empty rows → no items');

  // All-text rows: every row is its own message, order preserved.
  const items = groupDisplayItems([
    { key: 'u1', hasText: true },
    { key: 'a1', hasText: true },
    { key: 'u2', hasText: true },
  ]);
  assert(items.length === 3, `3 display items (got ${items.length})`);
  assert(items[0].kind === 'message' && items[0].key === 'u1', 'item0 message u1');
  assert(items[1].kind === 'message' && items[1].key === 'a1', 'item1 message a1');
  assert(items[2].kind === 'message' && items[2].key === 'u2', 'item2 message u2');
}

{
  // A run of thinking/tool_use/tool_result rows between two text rows
  // collapses into a single toolgroup.
  const rows = [
    { key: 'u1', hasText: true },
    { key: 'think1', hasText: false },
    { key: 'tool1', hasText: false },
    { key: 'result1', hasText: false },
    { key: 'a1', hasText: true },
  ];
  const items = groupDisplayItems(rows);
  assert(items.length === 3, `text, toolgroup, text (got ${items.length} items)`);
  assert(items[0].kind === 'message' && items[0].key === 'u1', 'item0 message u1');
  assert(items[1].kind === 'toolgroup', 'item1 is a toolgroup');
  assert(
    JSON.stringify(items[1].keys) === JSON.stringify(['think1', 'tool1', 'result1']),
    `toolgroup keys in order: ${JSON.stringify(items[1].keys)}`
  );
  assert(items[2].kind === 'message' && items[2].key === 'a1', 'item2 message a1');
}

{
  // Leading and trailing no-text runs (no bounding message on one side) still
  // flush into their own groups.
  const rows = [
    { key: 'think0', hasText: false },
    { key: 'u1', hasText: true },
    { key: 'tool9', hasText: false },
  ];
  const items = groupDisplayItems(rows);
  assert(items.length === 3, `leading/trailing groups flush (got ${items.length})`);
  assert(items[0].kind === 'toolgroup' && items[0].keys.length === 1 && items[0].keys[0] === 'think0', 'leading toolgroup');
  assert(items[1].kind === 'message' && items[1].key === 'u1', 'middle message');
  assert(items[2].kind === 'toolgroup' && items[2].keys.length === 1 && items[2].keys[0] === 'tool9', 'trailing toolgroup');
}

{
  // Two separate no-text runs, split by a text row, stay two separate groups
  // (not merged across the boundary).
  const rows = [
    { key: 'tool1', hasText: false },
    { key: 'tool2', hasText: false },
    { key: 'u1', hasText: true },
    { key: 'tool3', hasText: false },
  ];
  const items = groupDisplayItems(rows);
  assert(items.length === 3, `two separate groups, not merged (got ${items.length})`);
  assert(items[0].kind === 'toolgroup' && items[0].keys.length === 2, 'first group has 2 members');
  assert(items[2].kind === 'toolgroup' && items[2].keys.length === 1, 'second group has 1 member');
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
