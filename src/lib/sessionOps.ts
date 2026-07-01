/**
 * Session-level operations: rename (write ai-title back to JSONL).
 * Pure helper + async write-back. No snapshot — renaming is low-stakes.
 */

/**
 * Return a new JSONL string with the ai-title updated (or inserted at the top).
 *
 * Rules:
 * - Split on '\n'. Blank/unparseable lines pass through byte-for-byte.
 * - The FIRST line that parses to { type: 'ai-title' } has its
 *   message.content replaced with newTitle and is re-serialised.
 *   All other lines are kept byte-identical to the input.
 * - If no ai-title line exists, a new line is inserted as line 0.
 * - Output is joined with '\n' and ends with a single trailing newline.
 */
export function applyTitleToJsonl(rawText: string, newTitle: string): string {
  const lines = rawText.split('\n');

  // A single trailing '\n' in rawText produces a final empty string after split.
  // Track it so we can reproduce the same trailing newline via the forced '\n' below.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  let foundAiTitle = false;
  const output: string[] = [];

  for (const line of lines) {
    if (!foundAiTitle) {
      const trimmed = line.trim();
      if (trimmed) {
        let parsed: Record<string, unknown> | null = null;
        try {
          parsed = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          // not JSON — fall through to keep byte-identical
        }
        if (parsed !== null && parsed['type'] === 'ai-title') {
          // Re-serialise this line with the new title, keep all other fields.
          const msg: Record<string, unknown> =
            typeof parsed['message'] === 'object' && parsed['message'] !== null
              ? { ...(parsed['message'] as Record<string, unknown>) }
              : {};
          msg['content'] = newTitle;
          parsed['message'] = msg;
          output.push(JSON.stringify(parsed));
          foundAiTitle = true;
          continue;
        }
      }
    }
    // Keep all other lines byte-identical.
    output.push(line);
  }

  if (!foundAiTitle) {
    // Insert a new ai-title line at the very top.
    output.unshift(JSON.stringify({ type: 'ai-title', message: { content: newTitle } }));
  }

  return output.join('\n') + '\n';
}

/**
 * Read the JSONL at `path`, apply the new title, and write it back.
 * No snapshot is taken — renaming is considered low-stakes.
 *
 * api.ts is imported dynamically so that importing THIS module (e.g. in tests)
 * does not trigger api.ts's Vite ?raw top-level imports.
 */
export async function renameSession(path: string, newTitle: string): Promise<void> {
  const { readSession, writeSession } = await import('./api.js');
  const raw = await readSession(path);
  await writeSession(path, applyTitleToJsonl(raw, newTitle));
}
