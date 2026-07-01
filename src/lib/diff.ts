/**
 * diff.ts — version-diff helpers for the editor.
 * Pure TypeScript — no DOM, no Svelte, no Tauri.
 *
 * Wraps jsdiff (bundled offline) so the rest of the app depends on a small,
 * stable surface, and owns the "which earlier/later version do I compare against"
 * logic for a message's version timeline.
 */
import { diffWords } from 'diff';

/** One contiguous span of a word-level diff. */
export interface DiffSpan {
  value: string;
  added: boolean;   // present in the new text only
  removed: boolean; // present in the old text only
}

/**
 * Word-level diff of `oldStr` → `newStr`. Unchanged spans have added=removed=false.
 * Thin wrapper over jsdiff so callers never import it directly (single seam).
 */
export function wordDiff(oldStr: string, newStr: string): DiffSpan[] {
  return diffWords(oldStr, newStr).map(p => ({
    value: p.value,
    added: p.added ?? false,
    removed: p.removed ?? false,
  }));
}

/** True if the two strings differ at all (cheap short-circuit before diffing). */
export function hasTextChange(oldStr: string, newStr: string): boolean {
  return oldStr !== newStr;
}

// ── Version-timeline comparison targets ──────────────────────────────────────

export type DiffTarget = 'original' | 'previous' | 'next' | 'latest';

/**
 * Which comparison targets are meaningful for version `active` of a `total`-length
 * timeline (versions[0] = original, versions[total-1] = latest). Only targets that
 * point at a *different* existing version are offered, so the UI can render exactly
 * the buttons that make sense and hide the rest:
 *   - original: active is not already version 0
 *   - previous: active > 0
 *   - next:     active < total-1
 *   - latest:   active is not already the last version
 * `previous`/`next` are omitted when they'd coincide with `original`/`latest`
 * (e.g. on version 1 of 2, "previous" == "original"; we keep only "original").
 */
export function availableTargets(active: number, total: number): DiffTarget[] {
  const out: DiffTarget[] = [];
  if (total <= 1) return out;
  if (active > 0) out.push('original');
  if (active > 1) out.push('previous');
  if (active < total - 2) out.push('next');
  if (active < total - 1) out.push('latest');
  return out;
}

/** Resolve a target label to a concrete version index for `active`/`total`. */
export function targetIndex(target: DiffTarget, active: number, total: number): number {
  switch (target) {
    case 'original': return 0;
    case 'previous': return Math.max(0, active - 1);
    case 'next': return Math.min(total - 1, active + 1);
    case 'latest': return total - 1;
  }
}

/** Human label for a diff target chip. */
export function targetLabel(target: DiffTarget): string {
  switch (target) {
    case 'original': return 'Original';
    case 'previous': return 'Previous';
    case 'next': return 'Next';
    case 'latest': return 'Latest';
  }
}
