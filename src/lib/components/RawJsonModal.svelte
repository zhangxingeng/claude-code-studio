<script lang="ts">
  /**
   * RawJsonModal.svelte — the power-user escape hatch for editing a line's
   * underlying JSON directly. Owns its own textarea + validation-error state; the
   * parent supplies the initial (pretty-printed) text and a validator that throws
   * on invalid JSON. On success the parent closes the modal.
   */
  import { untrack } from 'svelte';

  let {
    initial,
    onCancel,
    onApply,
  }: {
    initial: string;
    // Returns an error message to display, or null on success (parent closes).
    onApply: (text: string) => string | null;
    onCancel: () => void;
  } = $props();

  // Seed the editable buffer once from the initial (the modal is remounted fresh
  // each time it opens, so a one-time snapshot is exactly right).
  let text = $state(untrack(() => initial));
  let error = $state<string | null>(null);

  function apply() {
    error = onApply(text);
  }
</script>

<div class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="raw-title">
  <div class="modal" style="max-width:680px;">
    <h3 id="raw-title">Edit raw JSON</h3>
    <p>Advanced: edit the underlying line directly. It's re-validated as JSON on save — invalid JSON is rejected so your history never breaks.</p>
    <textarea class="raw-textarea" bind:value={text} rows={16} spellcheck="false"></textarea>
    {#if error}<p class="raw-error">⚠ {error}</p>{/if}
    <div class="modal__actions">
      <button class="btn btn--sm btn--ghost" onclick={onCancel} type="button">Cancel</button>
      <button class="btn btn--sm btn--primary" onclick={apply} type="button">Validate &amp; apply</button>
    </div>
  </div>
</div>

<style>
  .raw-textarea {
    width: 100%; box-sizing: border-box; font-family: var(--font-mono); font-size: 0.75rem;
    line-height: 1.5; padding: 0.6rem 0.7rem; border-radius: 0.4rem;
    border: 1px solid var(--border-strong); background: var(--bg); color: var(--text);
    resize: vertical; margin: 0.5rem 0;
  }
  .raw-error { color: var(--accent-result-err); font-size: 0.78rem; margin: 0 0 0.5rem; }
</style>
