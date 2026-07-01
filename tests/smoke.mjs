/**
 * Smoke test for parser.ts + builder.ts.
 * Run with: npx tsx tests/smoke.mjs   (from repo root)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const root = join(__dir, '..');

// Use tsx to import TS modules
const { parseJsonl, extractMeta, decodeProject, cleanTitle } = await import(join(root, 'src/lib/parser.ts'));
const { buildSession, linkSubagents } = await import(join(root, 'src/lib/builder.ts'));

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

// ── Load mock data ────────────────────────────────────────────────────────────
const sessionText = readFileSync(join(__dir, 'mock_data/session.jsonl'), 'utf8');
const subagentJsonl = readFileSync(join(__dir, 'mock_data/subagents/agent-audit-secret.jsonl'), 'utf8');
const subagentMeta  = readFileSync(join(__dir, 'mock_data/subagents/agent-audit-secret.meta.json'), 'utf8');

// ── Test parseJsonl ───────────────────────────────────────────────────────────
console.log('\n[parseJsonl]');
const entries = parseJsonl(sessionText);
assert(entries.length > 0, `parsed ${entries.length} entries`);

// ai-title and mode should be filtered
const hasMetaType = entries.some(e => e.type === 'mode' || e.type === 'ai-title');
assert(!hasMetaType, 'meta types filtered out');

// Internal echo check — no system-reminder blocks in user turns
const hasEcho = entries.some(e =>
  e.type === 'user' &&
  e.blocks.some(b => b.blockType === 'text' && b.text?.startsWith('<system-reminder>'))
);
assert(!hasEcho, 'internal echoes filtered');

// task-notification detected
const taskNotif = entries.find(e => e.taskNotification);
assert(!!taskNotif, 'task-notification entry detected');

// Interruption detected
const interruption = entries.find(e => e.isInterruption);
assert(!!interruption, 'interruption entry detected');

// ── Test buildSession ─────────────────────────────────────────────────────────
console.log('\n[buildSession]');
const session = buildSession(entries, { project: 'test', sourcePath: 'tests/mock_data/session.jsonl' });

assert(session.turns.length > 0, `built ${session.turns.length} turns`);

const assistantTurns = session.turns.filter(t => t.role === 'assistant');
const userTurns = session.turns.filter(t => t.role === 'user');
assert(assistantTurns.length > 0, `${assistantTurns.length} assistant turns`);
assert(userTurns.length > 0, `${userTurns.length} user turns`);

// Key: tool results matched GLOBALLY across turns
const allBlocks = session.turns.flatMap(t => t.blocks);
const toolUseBlocks = allBlocks.filter(b => b.blockType === 'tool_use');
assert(toolUseBlocks.length > 0, `${toolUseBlocks.length} tool_use blocks total`);

const matchedWithResult = toolUseBlocks.filter(b => b.toolOutput !== undefined);
assert(matchedWithResult.length > 0, `${matchedWithResult.length} tool_use blocks have matched tool_result`);

const noErrorMatch = matchedWithResult.find(b => !b.isError);
assert(!!noErrorMatch, 'at least one matched tool_result has isError=false');

// Verify the bash-test block has isError=false (from mock data explicit is_error:false)
const bashBlock = toolUseBlocks.find(b => b.toolId === 'toolu_bash_test');
assert(!!bashBlock, 'toolu_bash_test block found');
assert(bashBlock && !bashBlock.isError, 'toolu_bash_test isError=false');

// Agent tool_use block should have agentId set
const agentBlock = toolUseBlocks.find(b => b.toolName === 'Agent');
assert(!!agentBlock, 'Agent tool_use block found');
assert(agentBlock?.agentId === 'agent-audit-secret', `Agent block agentId="${agentBlock?.agentId}"`);

// Interrupted turn
const interruptedTurn = session.turns.find(t => t.isInterrupted);
assert(!!interruptedTurn, 'interrupted turn marked');

// Meta
assert(session.meta.title.length > 0, `session title: "${session.meta.title}"`);
assert(session.meta.model.length > 0, `session model: "${session.meta.model}"`);

// ── Test extractMeta ──────────────────────────────────────────────────────────
console.log('\n[extractMeta]');
const rawLines = sessionText.split('\n').slice(0, 50);
const meta1 = extractMeta(rawLines);
assert(meta1.date.length > 0, `extractMeta from raw lines: date="${meta1.date}"`);

const meta2 = extractMeta(entries);
assert(meta2.date.length > 0, `extractMeta from entries: date="${meta2.date}"`);

// ── Test decodeProject ────────────────────────────────────────────────────────
console.log('\n[decodeProject]');
const decoded = decodeProject('-home-user-myproject');
assert(decoded.length > 0, `decodeProject: "${decoded}"`);
assert(!decoded.startsWith('-'), 'no leading dash');

// ── Test cleanTitle ───────────────────────────────────────────────────────────
console.log('\n[cleanTitle]');
assert(
  cleanTitle('# My Session Title') === 'My Session Title',
  'cleanTitle: strips leading "# "'
);
assert(
  cleanTitle('Hello\n\nWorld') === 'Hello World',
  'cleanTitle: collapses newlines to single space'
);

// ── Test linkSubagents ────────────────────────────────────────────────────────
console.log('\n[linkSubagents]');
const subagentFiles = [
  { name: 'agent-audit-secret.jsonl', content: subagentJsonl, is_meta: false },
  { name: 'agent-audit-secret.meta.json', content: subagentMeta,  is_meta: true  },
];
linkSubagents(session, subagentFiles);

// Find the Agent block (may not yet have subagent if agentId didn't match)
const agentBlockAfterLink = session.turns
  .flatMap(t => t.blocks)
  .find(b => b.toolName === 'Agent');

assert(!!agentBlockAfterLink?.subagent, 'Agent tool_use block has linked subagent Session');

if (agentBlockAfterLink?.subagent) {
  const sub = agentBlockAfterLink.subagent;
  assert(sub.turns.length > 0, `subagent has ${sub.turns.length} turns`);
  const subToolUse = sub.turns.flatMap(t => t.blocks).filter(b => b.blockType === 'tool_use');
  assert(subToolUse.length > 0, `subagent has ${subToolUse.length} tool_use blocks`);
  const subMatched = subToolUse.filter(b => b.toolOutput !== undefined);
  assert(subMatched.length > 0, `${subMatched.length} subagent tool_use have matched results`);
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
