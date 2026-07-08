<script lang="ts">
  /**
   * SaveRail.svelte — the floating right-edge save bar. Shows the unsaved-change
   * count and Save / Save-as-copy / Discard when dirty. Pure controls —
   * all side effects run in the parent's callbacks.
   */
  let {
    dirty,
    changeCount,
    saving,
    onSave,
    onSaveCopy,
    onDiscard,
  }: {
    dirty: boolean;
    changeCount: number;
    saving: boolean;
    onSave: () => void;
    onSaveCopy: () => void;
    onDiscard: () => void;
  } = $props();
</script>

<div class="save-rail">
  {#if dirty}
    <div class="save-rail__card">
      <span class="save-rail__count">{changeCount} unsaved {changeCount === 1 ? 'change' : 'changes'}</span>
      <button class="btn btn--sm btn--primary" onclick={onSave} disabled={saving} type="button">Save</button>
      <button class="btn btn--sm" onclick={onSaveCopy} disabled={saving} type="button">Save as copy</button>
      <button class="btn btn--sm btn--ghost" onclick={onDiscard} disabled={saving} type="button">Discard</button>
    </div>
  {/if}
</div>

<style>
  .save-rail {
    position: fixed; right: 1rem; top: 50%; transform: translateY(-50%); z-index: 20;
    display: flex; flex-direction: column; align-items: stretch; gap: 0.5rem; width: 9.5rem;
  }
  .save-rail__card {
    display: flex; flex-direction: column; gap: 0.4rem; padding: 0.7rem;
    background: var(--bg-card); border: 1px solid var(--border-strong);
    border-radius: 0.5rem; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18);
  }
  .save-rail__count {
    font-size: 0.68rem; font-weight: 600; color: var(--accent-user); text-align: center; margin-bottom: 0.1rem;
  }
  .save-rail__card .btn { width: 100%; justify-content: center; }
</style>
