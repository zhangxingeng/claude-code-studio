/**
 * Reactive search store (Svelte 5 runes). Owns the query, toggles, filters, and
 * the streamed `hits` array. Each query bumps a monotonic `searchId`; hits from
 * a superseded search are ignored, so results only ever append (no flicker).
 */
import type {
  SearchHit,
  SearchOpts,
  SearchFilters,
  SearchSummary,
  IndexStatus,
} from './types';
import { searchSessions, indexStatus, refreshIndex, listSessions, homeDir } from './api';
import { projectLabel } from './parser';

/** page size for "Load more" pagination — backend stops scanning at this many hits. */
const PAGE_SIZE = 100;

/** Light debounce so we don't launch a scan on every literal keystroke. */
const DEBOUNCE_MS = 110;

export interface ProjectOption {
  label: string;
  count: number;
}

export const search = $state({
  query: '',
  opts: { caseSensitive: false, wholeWord: false, regex: false } as SearchOpts,
  sources: ['user', 'assistant'] as string[], // "Messages" on by default
  from: null as number | null,
  to: null as number | null,
  projects: [] as string[], // selected project labels; empty = all
  toolName: '' as string, // restrict to tool_use blocks for this tool name; '' = no restriction
  sessionOnly: false, // when true + currentSessionPath is set, restrict to that one session
  currentSessionPath: null as string | null, // the session the search was opened from, if any
  hits: [] as SearchHit[],
  truncated: false,
  running: false,
  error: null as string | null,
  summary: null as SearchSummary | null,
  availableProjects: [] as ProjectOption[],
  status: null as IndexStatus | null,
  pageSize: PAGE_SIZE,
  limit: PAGE_SIZE,
  moreAvailable: false,
});

let searchId = 0;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let statusTimer: ReturnType<typeof setTimeout> | null = null;
let seen = new Set<string>();

function currentFilters(): SearchFilters {
  return {
    sources: search.sources,
    from: search.from,
    to: search.to,
    projects: search.projects,
    toolName: search.toolName.trim() || null,
    sessionPath: search.sessionOnly ? search.currentSessionPath : null,
  };
}

/** Debounced trigger — the normal entry point after any query/filter change. */
export function scheduleSearch(delay = DEBOUNCE_MS): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(runSearch, delay);
}

/** Run immediately (also used by the debounce timer). */
export async function runSearch(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  const id = ++searchId;
  search.hits = [];
  search.truncated = false;
  search.moreAvailable = false;
  search.error = null;
  search.summary = null;
  seen = new Set();
  if (!search.query) {
    search.running = false;
    return;
  }
  search.running = true;

  const opts = { ...search.opts };
  const filters = currentFilters();

  try {
    const summary = await searchSessions(search.query, opts, filters, id, search.limit, (hit) => {
      if (id !== searchId) return; // superseded by a newer search
      const key = `${hit.sessionPath}:${hit.lineNo}:${hit.blockNo}`;
      if (seen.has(key)) return; // warm + cold tiers can overlap briefly
      seen.add(key);
      search.hits.push(hit);
    });
    if (id === searchId) {
      search.summary = summary;
      search.truncated = summary.truncated;
      search.moreAvailable = summary.truncated;
      search.running = false;
    }
  } catch (e) {
    if (id === searchId) {
      search.error = e instanceof Error ? e.message : String(e);
      search.running = false;
    }
  }
}

// ── setters (all schedule a fresh search) ────────────────────────────────────

export function setQuery(q: string): void {
  search.query = q;
  search.limit = search.pageSize;
  scheduleSearch();
}

/** Bump the limit and re-run the search to load another page of results. */
export function loadMore(): void {
  search.limit += search.pageSize;
  scheduleSearch();
}

export function toggleOpt(k: keyof SearchOpts): void {
  search.opts[k] = !search.opts[k];
  search.limit = search.pageSize;
  scheduleSearch();
}

export function toggleSource(source: string): void {
  const i = search.sources.indexOf(source);
  if (i >= 0) search.sources.splice(i, 1);
  else search.sources.push(source);
  search.limit = search.pageSize;
  scheduleSearch();
}

export function toggleProject(label: string): void {
  const i = search.projects.indexOf(label);
  if (i >= 0) search.projects.splice(i, 1);
  else search.projects.push(label);
  search.limit = search.pageSize;
  scheduleSearch();
}

export function clearProjects(): void {
  search.projects = [];
  search.limit = search.pageSize;
  scheduleSearch();
}

/** Set the date range from `yyyy-mm-dd` inputs (or '' to clear a bound). */
export function setDateRange(fromISO: string, toISO: string): void {
  search.from = fromISO ? Date.parse(fromISO + 'T00:00:00') : null;
  // `to` is inclusive of the whole day.
  search.to = toISO ? Date.parse(toISO + 'T23:59:59.999') : null;
  search.limit = search.pageSize;
  scheduleSearch();
}

/** Restrict to tool_use blocks for this tool name ('' clears the restriction). */
export function setToolName(name: string): void {
  search.toolName = name;
  search.limit = search.pageSize;
  scheduleSearch();
}

// ── lifecycle ────────────────────────────────────────────────────────────────

/** Load the project list, kick a sweep, and start polling index status.
 *  `currentSessionPath` (if the search was opened from an open session) enables
 *  the "this session only" filter. */
export async function initSearch(currentSessionPath?: string): Promise<void> {
  search.currentSessionPath = currentSessionPath ?? null;
  if (!search.currentSessionPath) search.sessionOnly = false;
  try {
    const [sessions, home] = await Promise.all([listSessions(), homeDir()]);
    const counts = new Map<string, number>();
    for (const s of sessions) {
      const label = projectLabel(s.cwd, s.project_raw, home);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    search.availableProjects = [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch {
    // non-fatal; project filter just stays empty
  }

  // Catch external changes (CLI appends, edits outside the app) when opening.
  refreshIndex().catch(() => {});
  pollStatus();
}

async function pollStatus(): Promise<void> {
  search.status = await indexStatus();
  if (search.status?.building) {
    // Results grow as the cache warms — re-run so the view keeps up.
    if (search.query) scheduleSearch(400);
    statusTimer = setTimeout(pollStatus, 1000);
  } else {
    statusTimer = null;
  }
}

/** Stop timers when leaving the search view. */
export function disposeSearch(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (statusTimer) clearTimeout(statusTimer);
  debounceTimer = null;
  statusTimer = null;
  // Bump the id so any in-flight stream is ignored.
  searchId++;
}
