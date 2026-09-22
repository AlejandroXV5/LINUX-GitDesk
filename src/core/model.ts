// The repository as the UI sees it: a snapshot from a backend (real git or the
// demo) plus UI-only state that survives refreshes (selection, open folders…).
import { S, locale } from './settings';
import { esc } from './util';

export interface FileChange { st: string; path: string; from?: string | null }
export interface Commit {
  sha: string; msg: string; author: string; email?: string;
  parents: string[];
  /** milliseconds since epoch */
  t: number;
  /** topo-order index from `git log` (real backend); the demo sorts by time */
  o?: number;
  files?: FileChange[] | null;
}
export interface Branch { tip: string; upstream: string | null; ahead?: number | null; behind?: number | null; gone?: boolean }
export interface WorkFile { path: string; st: string; from?: string | null; staged: boolean }
export interface Stash { id: string; msg: string; t: number }
export interface Snapshot {
  name: string; path: string; url: string;
  head: { branch?: string | null; detached?: string | null };
  branches: Record<string, Branch>;
  remotes: Record<string, string>;
  tags: Record<string, string>;
  commits: Record<string, Commit>;
  work: WorkFile[];
  stashes: Stash[];
  worktrees: { path: string; branch: string }[];
  submodules: { path: string; url: string }[];
  inProgress?: string | null;
  truncated?: boolean;
}
export interface PullRequest { id: number; title: string; desc: string; source: string; target: string; status: string; t: number }
/** An open GitHub issue, for the "#" picker in Git Changes. */
export interface Issue { number: number; title: string }
export interface Notice { kind: string; key: string; vars: Record<string, string>; actions: string[] }
export interface LogEntry { cmd: string; lines: string[]; err: boolean }
export interface OpResult { ok: boolean; notice?: Notice | null; log: LogEntry[] }

export interface UiState {
  extra: Set<string>;
  historyRef: string | null;
  showAll: boolean;
  showTags: boolean;
  selected: string | null;
  selRef: string | null;
  openFolders: Set<string>;
  secClosed: Set<string>;
  dockClosed: Set<string>;
  incOpen: boolean;
  notice: Notice | null;
  related: number[];
  msg: string;
  prs: PullRequest[];
  prError: string | null;
  /** Open issues of the GitHub repository; null until loaded (or when origin isn't on GitHub). */
  issues: Issue[] | null;
  issuesError: string | null;
  filesCache: Map<string, FileChange[]>;
}
export type RepoView = Snapshot & UiState;

export let R: RepoView = null as unknown as RepoView;
export const hasRepo = () => R != null;

function freshUi(): UiState {
  return {
    extra: new Set(), historyRef: null, showAll: false, showTags: true, selected: null, selRef: null,
    openFolders: new Set(['remotes', 'tags']), secClosed: new Set(['sub']), dockClosed: new Set(),
    incOpen: true, notice: null, related: [], msg: '', prs: [], prError: null, issues: null, issuesError: null, filesCache: new Map()
  };
}
/** Replace the repository data; UI state is kept when it's the same repository. */
export function setRepo(snap: Snapshot | null) {
  if (!snap){ R = null as unknown as RepoView; return; }
  const ui: UiState = R && R.path === snap.path ? pickUi(R) : freshUi();
  if (!(R && R.path === snap.path)){
    // start with local branch folders expanded (feature/, hotfix/…)
    Object.keys(snap.branches).forEach(b => { const parts = b.split('/'); for (let i = 1; i < parts.length; i++) ui.openFolders.add('local:' + parts.slice(0, i).join('/')); });
  }
  R = Object.assign(snap, ui);
  // drop selections that no longer exist
  if (R.selected && !R.commits[R.selected]) R.selected = null;
  if (R.historyRef && !resolve(R.historyRef)) R.historyRef = null;
  R.extra.forEach(x => { if (!resolve(x)) R.extra.delete(x); });
}
function pickUi(v: RepoView): UiState {
  const { extra, historyRef, showAll, showTags, selected, selRef, openFolders, secClosed, dockClosed, incOpen, notice, related, msg, prs, prError, issues, issuesError, filesCache } = v;
  return { extra, historyRef, showAll, showTags, selected, selRef, openFolders, secClosed, dockClosed, incOpen, notice, related, msg, prs, prError, issues, issuesError, filesCache };
}

// ---------- graph queries ----------
export const headSha = (): string => (R.head.branch && R.branches[R.head.branch] ? R.branches[R.head.branch].tip : R.head.detached || '');
export const curBranch = (): string | null => R.head.branch || null;
export function resolve(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (R.branches[ref]) return R.branches[ref].tip;
  if (R.remotes[ref]) return R.remotes[ref];
  if (R.tags[ref]) return R.tags[ref];
  if (R.commits[ref]) return ref;
  return null;
}
export type RefKind = 'local' | 'remote' | 'tag' | 'commit';
export const refKind = (ref: string): RefKind => (R.branches[ref] ? 'local' : R.remotes[ref] ? 'remote' : R.tags[ref] ? 'tag' : 'commit');

export function ancestors(s: string | null): Set<string> {
  const set = new Set<string>(), st: (string | null)[] = [s];
  while (st.length){
    const x = st.pop();
    if (!x || set.has(x)) continue;
    set.add(x);
    const c = R.commits[x];
    if (c) for (const p of c.parents) st.push(p);
  }
  return set;
}
/** Commits reachable from a but not from b, newest first. */
export function onlyIn(a: string | null, b: string | null): Commit[] {
  const A = ancestors(a), B = b ? ancestors(b) : new Set<string>();
  return [...A].filter(x => !B.has(x) && R.commits[x]).map(x => R.commits[x]).sort(byHistory);
}
export function byHistory(x: Commit, y: Commit): number {
  if (x.o != null && y.o != null) return x.o - y.o;
  return y.t - x.t;
}
export function tracking(b: string): { ahead: number; behind: number } | null {
  const br = R.branches[b];
  if (!br || !br.upstream) return null;
  if (br.ahead != null && br.behind != null) return { ahead: br.ahead, behind: br.behind };
  if (!R.remotes[br.upstream]) return null;
  return { ahead: onlyIn(br.tip, R.remotes[br.upstream]).length, behind: onlyIn(R.remotes[br.upstream], br.tip).length };
}
export function incomingList(): Commit[] {
  const b = curBranch(); if (!b) return [];
  const br = R.branches[b]; if (!br || !br.upstream || !R.remotes[br.upstream]) return [];
  return onlyIn(R.remotes[br.upstream], br.tip);
}
export function outgoingSet(): Set<string> {
  const b = curBranch(); if (!b || !R.branches[b]) return new Set();
  const br = R.branches[b];
  if (br.upstream && R.remotes[br.upstream]) return new Set(onlyIn(br.tip, R.remotes[br.upstream]).map(c => c.sha));
  const onRemote = new Set<string>();
  Object.values(R.remotes).forEach(s => ancestors(s).forEach(x => onRemote.add(x)));
  return new Set([...ancestors(br.tip)].filter(x => !onRemote.has(x)));
}

// ---------- presentation helpers ----------
export function initials(n: string): string {
  const parts = String(n).replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  return ((parts[0] || '?')[0] + ((parts[1] || '')[0] || '')).toUpperCase();
}
export function avClass(n: string): string {
  let h = 0;
  for (const ch of String(n)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return 'av' + ((h % 5) + 1);
}
export const avatar = (n: string) => (S.avatars ? `<span class="avatar ${avClass(n)}">${esc(initials(n))}</span>` : '');
export function fmtDate(tm: number): string {
  if (S.dateFmt === 'absolute') return new Date(tm).toLocaleString(locale(), { dateStyle: 'short', timeStyle: 'short' });
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const d = (tm - Date.now()) / 1000, a = Math.abs(d);
  if (a < 45) return rtf.format(0, 'second');
  if (a < 3600) return rtf.format(Math.round(d / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(d / 3600), 'hour');
  if (a < 86400 * 7) return rtf.format(Math.round(d / 86400), 'day');
  if (a < 86400 * 30) return rtf.format(Math.round(d / 604800), 'week');
  if (a < 86400 * 365) return rtf.format(Math.round(d / 2592000), 'month');
  return rtf.format(Math.round(d / 31536000), 'year');
}
export const absDate = (tm: number) => new Date(tm).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
