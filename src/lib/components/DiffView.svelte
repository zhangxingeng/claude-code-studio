<script lang="ts">
  /**
   * DiffView.svelte — render a word-level diff (old → new) with additions in
   * green and removals struck-through in red. Pure presentation; the spans are
   * computed by diff.ts.
   */
  import { wordDiff } from '$lib/diff';

  let { oldText, newText }: { oldText: string; newText: string } = $props();

  let spans = $derived(wordDiff(oldText, newText));
  let identical = $derived(oldText === newText);
</script>

<div class="diff">
  {#if identical}
    <span class="diff__same-note">No text change between these versions.</span>
  {:else}
    {#each spans as s, i (i)}
      {#if s.added}<ins class="diff__add">{s.value}</ins>
      {:else if s.removed}<del class="diff__del">{s.value}</del>
      {:else}<span>{s.value}</span>{/if}
    {/each}
  {/if}
</div>

<style>
  .diff {
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 0.85rem;
    line-height: 1.55;
    padding: 0.55rem 0.7rem;
    border-radius: 0.4rem;
    background: var(--bg-subtle);
    border: 1px solid var(--border);
  }
  .diff__add {
    background: color-mix(in srgb, var(--accent-result-ok) 22%, transparent);
    color: var(--text);
    text-decoration: none;
    border-radius: 0.15rem;
  }
  .diff__del {
    background: color-mix(in srgb, var(--accent-result-err) 20%, transparent);
    color: var(--text-muted);
    text-decoration: line-through;
    border-radius: 0.15rem;
  }
  .diff__same-note { color: var(--text-faint); font-style: italic; font-size: 0.78rem; }
</style>
