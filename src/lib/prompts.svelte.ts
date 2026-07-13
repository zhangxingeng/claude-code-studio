/**
 * Reactive Prompt Library store (Svelte 5 runes) — same idiom as
 * search.svelte.ts: one exported $state object + setter functions, a light
 * debounce on the live matcher, and a monotonic id so superseded match runs
 * are ignored.
 *
 * The compose doc, the variable fills, and the active tab live here (not in
 * components) so a draft prompt survives switching views — leaving Prompts
 * to check a session and coming back must not eat your composition.
 */
import type { Snippet, MatchHit, SnippetInput, Project, ProjectInput } from './prompts/types';
import {
  listSnippets,
  saveSnippet as apiSaveSnippet,
  deleteSnippet as apiDeleteSnippet,
  listProjects,
  saveProject as apiSaveProject,
  deleteProject as apiDeleteProject,
  matchSnippets,
} from './api';
import {
  type Doc,
  type SpanLink,
  type Span,
  emptyDoc,
  applyEdit,
  insertSnippetOverRange,
  replaceSpan,
  linkRange,
  caretQuery,
  spanStarts,
} from './compose/doc';
import { copyText } from './compose/variables';

/** Light debounce so we don't hit the matcher on every literal keystroke. */
const DEBOUNCE_MS = 110;
/** Match panel size — small on purpose; it's a suggestion strip, not a browser. */
const MATCH_LIMIT = 8;

export interface ResolvedHit {
  snippet: Snippet;
  score: number;
  source: MatchHit['source'];
}

export const prompts = $state({
  // library
  snippets: [] as Snippet[],
  loadError: null as string | null,
  // project roster + active tab (null = the Global tab)
  projects: [] as Project[],
  activeProjectId: null as string | null,
  // compose surface
  doc: emptyDoc() as Doc,
  caret: 0,
  selStart: 0,
  selEnd: 0,
  /** Bumped when the doc changes from OUTSIDE the textarea (panel insert,
   *  modal apply) — the compose box watches it to restore focus + caret. */
  focusNonce: 0,
  /** Unified variable fill values, keyed by name (grammar rule 4: one name =
   *  one variable document-wide). Entries for names no longer in the doc are
   *  kept — retyping a name recalls its value; copy only reads live names. */
  fills: {} as Record<string, string>,
  /** Per-variable as-variable state (contract §Copy output), keyed by name. A
   *  name absent here is ON — the founder's safe default (as-var never breaks;
   *  in-place substitution of unexpected data can bloat the prompt). Session-
   *  only, never persisted to the snippet ([JC-9]). */
  asVars: {} as Record<string, boolean>,
  // live matching
  matchQuery: '',
  hits: [] as ResolvedHit[],
  matching: false,
});

let matchId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

// ── lifecycle ────────────────────────────────────────────────────────────────

/** Load snippets and the project roster. Idempotent per session — re-entering
 *  the view refreshes the library but keeps the compose doc and fills. */
export async function initPrompts(): Promise<void> {
  try {
    prompts.snippets = await listSnippets();
    prompts.loadError = null;
  } catch (e) {
    prompts.loadError = e instanceof Error ? e.message : String(e);
  }
  try {
    prompts.projects = await listProjects();
    if (
      prompts.activeProjectId !== null &&
      !prompts.projects.some((p) => p.id === prompts.activeProjectId)
    ) {
      prompts.activeProjectId = null; // the active project vanished — fall back to Global
    }
  } catch (e) {
    // Tabs degrade to Global-only, but say why rather than rendering a
    // mysteriously bare tab row.
    prompts.loadError ??= e instanceof Error ? e.message : String(e);
  }
}

/** Stop timers when leaving the view (the doc itself is kept — see header). */
export function disposePrompts(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  matchId++; // ignore any in-flight match
}

// ── projects / tabs ──────────────────────────────────────────────────────────

/** Switch the active tab (null = Global). Drives the match pool, the save
 *  scope for new snippets, and the view tint. */
export function setActiveProject(id: string | null): void {
  prompts.activeProjectId = id;
  scheduleMatch();
}

/** The active tab's project record (null on the Global tab). Reactive when
 *  read inside a $derived. */
export function activeProject(): Project | null {
  return prompts.projects.find((p) => p.id === prompts.activeProjectId) ?? null;
}

/** Create or update a project and sync the roster. Returns the stored record. */
export async function saveProject(input: ProjectInput): Promise<Project> {
  const saved = await apiSaveProject(input);
  const i = prompts.projects.findIndex((p) => p.id === saved.id);
  if (i >= 0) prompts.projects[i] = saved;
  else prompts.projects.push(saved);
  return saved;
}

/** Delete a project. Its snippets rescope to GLOBAL (contract semantics — the
 *  writing never vanishes), so the snippet list is re-fetched; an active tab
 *  pointing at it falls back to Global. */
export async function deleteProject(id: string): Promise<void> {
  await apiDeleteProject(id);
  prompts.projects = prompts.projects.filter((p) => p.id !== id);
  if (prompts.activeProjectId === id) prompts.activeProjectId = null;
  try {
    prompts.snippets = await listSnippets();
  } catch (e) {
    prompts.loadError = e instanceof Error ? e.message : String(e);
  }
  scheduleMatch();
}

// ── live matching ────────────────────────────────────────────────────────────

function scheduleMatch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runMatch, DEBOUNCE_MS);
}

async function runMatch(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const id = ++matchId;
  const query = prompts.matchQuery;
  if (!query.trim()) {
    prompts.hits = [];
    prompts.matching = false;
    return;
  }
  prompts.matching = true;
  try {
    const hits = await matchSnippets(query, prompts.activeProjectId, MATCH_LIMIT);
    if (id !== matchId) return; // superseded
    const byId = new Map(prompts.snippets.map((p) => [p.id, p]));
    prompts.hits = hits.flatMap((h) => {
      const snippet = byId.get(h.id);
      return snippet ? [{ snippet, score: h.score, source: h.source }] : [];
    });
    prompts.matching = false;
  } catch (e) {
    if (id !== matchId) return;
    prompts.matching = false;
    prompts.hits = [];
    // The one failure we expect here is a transient backend/IPC error — Tauri's
    // Result<_, String> rejects with a *string*. The match panel is a
    // suggestion strip, not a save path, so that degrades quietly to "no
    // suggestions" (store errors surface on the save path, which is guarded).
    if (typeof e === 'string') return;
    // Anything else is a programming error wearing a "No matching snippets."
    // costume — a user reads that as "nothing matched," not "matching is
    // broken." Don't let it hide: log and re-throw so it surfaces as a failure.
    console.error('Prompt match failed unexpectedly:', e);
    throw e;
  }
}

// ── compose surface ──────────────────────────────────────────────────────────

/** Track the caret/selection (from the textarea) without triggering a match. */
export function setSelection(start: number, end: number): void {
  prompts.selStart = start;
  prompts.selEnd = end;
  prompts.caret = end;
}

/** One inline edit (any input event, translated by the compose box into a
 *  single replacement). Drives both the provenance state machine and the
 *  live matcher. */
export function composeEdit(start: number, end: number, inserted: string): void {
  prompts.doc = applyEdit(prompts.doc, start, end, inserted);
  const caret = start + inserted.length;
  setSelection(caret, caret);
  prompts.matchQuery = caretQuery(prompts.doc.text, caret);
  scheduleMatch();
}

/** Insert a snippet's RAW body as a linked span, REPLACING the query line the
 *  user typed to find it (line start → caret) — the single insert path behind
 *  both triggers, mouse click and ↓-into-panel + Enter (contract §S2/S3). The
 *  query was scaffolding; leaving it in front of the body is litter. {var}
 *  tokens land verbatim and merge into the unified fill list (variables resolve
 *  at copy time). */
export function composeInsertSnippet(snippet: Snippet): Doc {
  const link: SpanLink = { snippetId: snippet.id, title: snippet.title, scope: snippet.scope };
  const caret = prompts.caret;
  const lineStart = prompts.doc.text.lastIndexOf('\n', caret - 1) + 1;
  prompts.doc = insertSnippetOverRange(prompts.doc, lineStart, caret, snippet.body, link);
  const end = lineStart + snippet.body.length;
  setSelection(end, end);
  prompts.matchQuery = ''; // the query line was consumed by the insert
  scheduleMatch(); // clears the now-stale suggestions
  prompts.focusNonce++;
  return prompts.doc;
}

/** Replace one span's text + metadata (snippet-modal save refreshing the
 *  span's link metadata / provenance state — never the composed text). */
export function composeReplaceSpan(index: number, newText: string, span: Omit<Span, 'length'>): void {
  const start = spanStarts(prompts.doc)[index];
  prompts.doc = replaceSpan(prompts.doc, index, newText, span);
  setSelection(start + newText.length, start + newText.length);
  prompts.focusNonce++;
}

/** After save-selection-as-snippet: the saved selection becomes a linked span
 *  pointing at the new snippet (linked-modified when the saved body was edited
 *  away from the selection before saving). */
export function composeLinkRange(
  start: number,
  end: number,
  link: SpanLink,
  state: 'linked' | 'linked-modified' = 'linked'
): void {
  prompts.doc = linkRange(prompts.doc, start, end, link, state);
  prompts.focusNonce++;
}

/** One fill input changed (the unified variable list under the box). */
export function setFill(name: string, value: string): void {
  prompts.fills[name] = value;
}

/** The Copy Prompt deliverable: the doc's raw text through the copy pipeline
 *  (escapes resolved; per-variable XML dedup or substitute-in-place). */
export function copyOutput(): string {
  return copyText(prompts.doc.text, prompts.fills, prompts.asVars);
}

/** Set one variable's as-variable mode (contract §Copy output). Absent = ON, so
 *  an explicit `false` is how OFF is recorded. Session-only — never persisted to
 *  the snippet ([JC-9]). */
export function setAsVar(name: string, on: boolean): void {
  prompts.asVars[name] = on;
}

// ── snippet store ──────────────────────────────────────────────────────────────

/** Save (create or update) and sync the local list. Returns the stored snippet. */
export async function saveSnippet(input: SnippetInput): Promise<Snippet> {
  const saved = await apiSaveSnippet(input);
  const i = prompts.snippets.findIndex((p) => p.id === saved.id);
  if (i >= 0) prompts.snippets[i] = saved;
  else prompts.snippets.push(saved);
  scheduleMatch(); // the library changed under the current query
  return saved;
}

export async function deleteSnippet(id: string): Promise<void> {
  await apiDeleteSnippet(id);
  const i = prompts.snippets.findIndex((p) => p.id === id);
  if (i >= 0) prompts.snippets.splice(i, 1);
  scheduleMatch();
}
