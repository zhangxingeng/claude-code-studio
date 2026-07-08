/**
 * displayModel.ts — turn a flat, ordered list of renderable rows into display
 * items for the editor: individual chat bubbles interleaved with collapsed
 * "tool activity" groups.
 *
 * Pure TypeScript — no DOM, no Svelte — so the grouping is unit-testable in
 * isolation.
 *
 * Rule: a row that carries human-readable text (a user/assistant message) is its
 * own bubble. Any maximal run of consecutive rows that carry NO text (tool calls,
 * tool results, standalone thinking — the "geek stuff" between two chat chunks)
 * collapses into a single group the user can expand or delete as a unit (and
 * member-by-member). This is what keeps the default view "just the chat."
 */

export interface RowFlag {
  key: string;
  hasText: boolean;
}

export interface DisplayMessage {
  kind: 'message';
  key: string;
}

export interface DisplayToolGroup {
  kind: 'toolgroup';
  keys: string[];
}

export type DisplayItem = DisplayMessage | DisplayToolGroup;

/**
 * Partition `rows` (already in display order) into messages and contiguous
 * tool-groups. Order is preserved; every input key appears exactly once in the
 * output.
 */
export function groupDisplayItems(rows: RowFlag[]): DisplayItem[] {
  const items: DisplayItem[] = [];
  let pending: string[] = [];

  const flush = () => {
    if (pending.length > 0) {
      items.push({ kind: 'toolgroup', keys: pending });
      pending = [];
    }
  };

  for (const r of rows) {
    if (r.hasText) {
      flush();
      items.push({ kind: 'message', key: r.key });
    } else {
      pending.push(r.key);
    }
  }
  flush();

  return items;
}
