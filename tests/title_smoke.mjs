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
const userLine = JSON.stringify({ type: 'user', uuid: 'abc', message: { content: 'hello' } });
const SID = 'a601b511-56ce-4b92-a3f0-7092553de44d';

// ── Test 1: appends custom-title + agent-name, leaves existing content untouched ──
console.log('\n[applyTitleToJsonl — appends real rename entries]');
{
  const input = `${userLine}\n`;
  const result = applyTitleToJsonl(input, 'New Title', SID);
  const lines = result.split('\n').filter((l) => l.trim());

  assert(lines.length === 3, 'one line grew to three (user + custom-title + agent-name)');
  assert(lines[0] === userLine, 'original user line is byte-identical');

  const p1 = JSON.parse(lines[1]);
  assert(p1.type === 'custom-title', 'second line is custom-title');
  assert(p1.customTitle === 'New Title', 'customTitle is the new title');
  assert(p1.sessionId === SID, 'sessionId is threaded through');

  const p2 = JSON.parse(lines[2]);
  assert(p2.type === 'agent-name', 'third line is agent-name');
  assert(p2.agentName === 'New Title', 'agentName is the new title');
  assert(p2.sessionId === SID, 'sessionId is threaded through');
}

// ── Test 2: renaming twice appends again (last-wins on read, not edited in place) ──
console.log('\n[applyTitleToJsonl — repeated rename appends again]');
{
  const once = applyTitleToJsonl(`${userLine}\n`, 'First', SID);
  const twice = applyTitleToJsonl(once, 'Second', SID);
  const lines = twice.split('\n').filter((l) => l.trim());

  assert(lines.length === 5, 'user + 2x(custom-title, agent-name) = 5 lines');
  assert(JSON.parse(lines[1]).customTitle === 'First', 'first rename entry untouched');
  assert(JSON.parse(lines[3]).customTitle === 'Second', 'second rename appended after it');
}

// ── Test 3: output ends with a trailing newline ───────────────────────────────
console.log('\n[applyTitleToJsonl — trailing newline]');
{
  const result = applyTitleToJsonl(`${userLine}\n`, 'Title', SID);
  assert(result.endsWith('\n'), 'output ends with trailing newline');
}

// ── Test 4: works even if input is missing its trailing newline ───────────────
console.log('\n[applyTitleToJsonl — tolerates missing trailing newline on input]');
{
  const result = applyTitleToJsonl(userLine, 'Title', SID);
  const lines = result.split('\n').filter((l) => l.trim());
  assert(lines.length === 3, 'still appends cleanly without a dangling newline');
  assert(lines[0] === userLine, 'original content preserved');
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
