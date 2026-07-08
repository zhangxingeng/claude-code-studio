<script lang="ts">
  /**
   * ToolGroup.svelte — a collapsed strip standing in for a contiguous run of
   * non-chat rows (tool calls, tool results, standalone thinking) that sit
   * between two chat messages (see displayModel.ts's DisplayToolGroup).
   * Collapsed by default so the transcript reads as "just the chat"; expand
   * to see each member's read-only brief (Block.svelte — never raw JSON),
   * deletable as a unit (the whole group) AND member-by-member. Soft delete:
   * deleted members fade in place with an Undelete affordance; nothing
   * leaves the file until Save.
   *
   * This is a fresh component, NOT the old (deleted) editor ToolGroup and NOT
   * Turn.svelte (which is the separate export-only HTML-build path — see
   * builder.ts).
   */
  import type { Entry } from '$lib/types';
  import type { DraftRow } from '$lib/editDraft';
  import { blockKey } from '$lib/editDraft';
  import Block from './Block.svelte';

  export interface GroupItem {
    key: string;
    row: DraftRow;
    entry: Entry;
  }

  let {
    items,
    deletedBlocks,
    onDeleteBlock,
    onUndeleteBlock,
    onDeleteGroup,
    onUndeleteGroup,
  }: {
    items: GroupItem[];
    deletedBlocks: Set<string>;
    onDeleteBlock: (rowKey: string, blockIndex: number) => void;
    onUndeleteBlock: (rowKey: string, blockIndex: number) => void;
    onDeleteGroup: () => void;
    onUndeleteGroup: () => void;
  } = $props();

  let open = $state(false);

  function isDeleted(it: GroupItem, bi: number): boolean {
    return deletedBlocks.has(blockKey(it.row, bi));
  }

  // Summarize what's inside so the collapsed header is informative, e.g.
  // "2 tool calls · 1 result · 1 thinking".
  let summary = $derived.by(() => {
    let tools = 0, results = 0, thinking = 0;
    for (const it of items) {
      for (const b of it.entry.blocks) {
        if (b.blockType === 'tool_use') tools++;
        else if (b.blockType === 'tool_result') results++;
        else if (b.blockType === 'thinking') thinking++;
      }
    }
    const parts: string[] = [];
    if (tools) parts.push(`${tools} tool call${tools === 1 ? '' : 's'}`);
    if (results) parts.push(`${results} result${results === 1 ? '' : 's'}`);
    if (thinking) parts.push(`${thinking} thinking`);
    return parts.length ? parts.join(' · ') : `${items.length} item${items.length === 1 ? '' : 's'}`;
  });

  // Every block across every member deleted → the whole group reads as
  // deleted (drives the collapsed bar's fade + "Restore group" label).
  let allDeleted = $derived(
    items.length > 0 && items.every((it) => it.entry.blocks.every((_, bi) => isDeleted(it, bi)))
  );
</script>

<div class="tool-group" class:tool-group--deleted={allDeleted}>
  <div class="tool-group__bar">
    <button
      class="tool-group__toggle"
      class:open
      onclick={() => (open = !open)}
      type="button"
    >
      <span class="toggle-icon">&#9654;</span>
      <span class="tool-group__gear">⚙</span>
      <span class="tool-group__summary">{summary}</span>
      <span class="tool-group__hint">{open ? 'hide' : 'show'}</span>
    </button>
    {#if allDeleted}
      <button class="tool-group__act" onclick={onUndeleteGroup} type="button">Restore group</button>
    {:else}
      <button class="tool-group__act tool-group__act--danger" onclick={onDeleteGroup} type="button">Delete group</button>
    {/if}
  </div>

  {#if open}
    <div class="tool-group__body">
      {#each items as it (it.key)}
        {#each it.entry.blocks as block, bi (bi)}
          {@const deleted = isDeleted(it, bi)}
          <div class="tool-line" class:tool-line--deleted={deleted}>
            <div class="tool-line__tools">
              {#if deleted}
                <button class="msg-tools__btn" onclick={() => onUndeleteBlock(it.key, bi)} type="button">Undelete</button>
              {:else}
                <button class="msg-tools__btn msg-tools__btn--danger" onclick={() => onDeleteBlock(it.key, bi)} title="Delete" type="button">✕</button>
              {/if}
            </div>
            <Block {block} role={it.entry.type === 'user' ? 'user' : 'assistant'} />
          </div>
        {/each}
      {/each}
    </div>
  {/if}
</div>

<style>
  .tool-group {
    margin: 0.15rem 0; border: 1px dashed var(--border); border-radius: 0.45rem;
    background: color-mix(in srgb, var(--bg-subtle) 55%, transparent);
  }
  .tool-group--deleted { opacity: 0.5; }
  .tool-group__bar { display: flex; align-items: center; gap: 0.5rem; padding: 0.3rem 0.5rem; }
  .tool-group__toggle {
    flex: 1; display: inline-flex; align-items: center; gap: 0.45rem;
    background: none; border: 0; cursor: pointer; font-family: inherit; text-align: left;
    color: var(--text-muted); font-size: 0.75rem; padding: 0.1rem 0.15rem;
  }
  .tool-group__toggle .toggle-icon {
    display: inline-block; transition: transform 0.12s; font-size: 0.6rem; color: var(--text-faint);
  }
  .tool-group__toggle.open .toggle-icon { transform: rotate(90deg); }
  .tool-group__gear { opacity: 0.7; }
  .tool-group__summary { font-weight: 500; }
  .tool-group__hint { color: var(--text-faint); font-size: 0.68rem; }
  .tool-group__act {
    background: none; border: 1px solid var(--border); border-radius: 0.3rem; cursor: pointer;
    font-size: 0.66rem; padding: 0.15rem 0.45rem; color: var(--text-muted); font-family: inherit;
    opacity: 0; transition: opacity 0.1s;
  }
  .tool-group:hover .tool-group__act { opacity: 0.85; }
  .tool-group__act:hover { opacity: 1; color: var(--text); }
  .tool-group__act--danger:hover {
    color: var(--accent-result-err); border-color: color-mix(in srgb, var(--accent-result-err) 40%, transparent);
  }
  .tool-group__body {
    padding: 0.25rem 0.6rem 0.5rem; display: flex; flex-direction: column; gap: 0.3rem;
    border-top: 1px dashed var(--border);
  }
  .tool-line { position: relative; }
  .tool-line--deleted { opacity: 0.45; }
  .tool-line--deleted :global(.msg__body) { text-decoration: line-through; }
  .tool-line__tools {
    position: absolute; top: 0.1rem; right: 0.1rem; z-index: 2;
    display: flex; gap: 0.2rem; opacity: 0; transition: opacity 0.1s;
  }
  .tool-line:hover .tool-line__tools, .tool-line--deleted .tool-line__tools { opacity: 1; }
  .msg-tools__btn {
    background: color-mix(in srgb, var(--bg-card) 90%, transparent); border: 1px solid var(--border);
    cursor: pointer; color: var(--text-muted); font-size: 0.72rem; line-height: 1;
    padding: 0.15rem 0.3rem; border-radius: 0.25rem; font-family: inherit;
  }
  .msg-tools__btn:hover { background: var(--bg-subtle); color: var(--text); }
  .msg-tools__btn--danger:hover {
    color: var(--accent-result-err); background: color-mix(in srgb, var(--accent-result-err) 12%, transparent);
  }
</style>
