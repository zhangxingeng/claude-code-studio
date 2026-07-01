/**
 * Smoke test for sessionOps.ts — applyTitleToJsonl.
 * Run with: npx tsx tests/title_smoke.mjs  (from repo root)
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

const { applyTitleToJsonl } = await import(join(root, 'src/lib/sessionOps.ts'));

// ── helpers ──────────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✓ ${msg}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${msg}`);
    failed++;
  }
}

// ── fixtures ─────────────────────────────────────────────────────────────────
const aiTitleLine = JSON.stringify({ type: 'ai-title', message: { content: 'Old Title' } });
const userLine    = JSON.stringify({ type: 'user', uuid: 'abc', message: { content: 'hello' } });
const secondAiLine = JSON.stringify({ type: 'ai-title', message: { content: 'Second' } });

// ── Test 1: updates existing ai-title in place ────────────────────────────────
console.log('\n[applyTitleToJsonl — update existing]');
{
  const input = `${aiTitleLine}\n${userLine}\n`;
  const result = applyTitleToJsonl(input, 'New Title');
  const lines = result.split('\n').filter((l) => l.trim());

  assert(lines.length === 2, 'line count unchanged (2)');

  const p0 = JSON.parse(lines[0]);
  assert(p0.type === 'ai-title', 'first line is still ai-title');
  assert(p0.message.content === 'New Title', 'ai-title content updated to "New Title"');

  assert(lines[1] === userLine, 'user line is byte-identical to input');
}

// ── Test 2: inserts ai-title at top when absent ───────────────────────────────
console.log('\n[applyTitleToJsonl — insert when absent]');
{
  const input = `${userLine}\n`;
  const result = applyTitleToJsonl(input, 'Inserted Title');
  const lines = result.split('\n').filter((l) => l.trim());

  assert(lines.length === 2, 'one extra line inserted (now 2)');

  const p0 = JSON.parse(lines[0]);
  assert(p0.type === 'ai-title', 'inserted line is ai-title');
  assert(p0.message.content === 'Inserted Title', 'inserted ai-title content correct');

  assert(lines[1] === userLine, 'original user line byte-identical');
}

// ── Test 3: only FIRST ai-title is updated; second is left byte-identical ─────
console.log('\n[applyTitleToJsonl — only first ai-title updated]');
{
  const input = `${aiTitleLine}\n${userLine}\n${secondAiLine}\n`;
  const result = applyTitleToJsonl(input, 'Updated');
  const lines = result.split('\n').filter((l) => l.trim());

  assert(lines.length === 3, 'line count unchanged (3)');

  const p0 = JSON.parse(lines[0]);
  assert(p0.message.content === 'Updated', 'first ai-title updated to "Updated"');

  assert(lines[1] === userLine, 'middle user line byte-identical');

  assert(lines[2] === secondAiLine, 'second ai-title line byte-identical (untouched)');
}

// ── Test 4: output ends with a trailing newline ───────────────────────────────
console.log('\n[applyTitleToJsonl — trailing newline]');
{
  const input = `${userLine}\n`;
  const result = applyTitleToJsonl(input, 'Title');
  assert(result.endsWith('\n'), 'output ends with trailing newline');
}

// ── Test 5: changed line is valid JSON with correct structure ─────────────────
console.log('\n[applyTitleToJsonl — valid JSON on changed line]');
{
  const input = `${aiTitleLine}\n`;
  const result = applyTitleToJsonl(input, 'Valid JSON Check');
  const lines = result.split('\n').filter((l) => l.trim());
  let ok = false;
  try {
    const p = JSON.parse(lines[0]);
    ok = p.type === 'ai-title' && typeof p.message?.content === 'string';
  } catch {
    ok = false;
  }
  assert(ok, 'changed line is valid JSON with type+message.content');
}

// ── Test 6: blank and non-JSON lines pass through unchanged ──────────────────
console.log('\n[applyTitleToJsonl — blank/non-JSON lines pass through]');
{
  const blankLine = '';
  const garbageLine = 'not-json-at-all';
  const input = `${blankLine}\n${garbageLine}\n${userLine}\n`;
  const result = applyTitleToJsonl(input, 'Any Title');
  const lines = result.split('\n');
  // Remove the final empty string from the trailing newline
  if (lines[lines.length - 1] === '') lines.pop();

  // A new ai-title was inserted at top (no existing one found)
  // so output is: [ai-title, blank, garbage, user]
  assert(lines.length === 4, 'blank + garbage + user + new ai-title = 4 lines');
  assert(lines[1] === blankLine, 'blank line preserved');
  assert(lines[2] === garbageLine, 'garbage line preserved');
  assert(lines[3] === userLine, 'user line preserved');
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
