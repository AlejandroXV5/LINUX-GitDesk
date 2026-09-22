// Which repository is open, which backend serves it, and how results flow back
// into the UI (Output log + Git Changes info bar + refreshed snapshot).
import { DEMO_ISSUES, GitHub } from '../backend/github';
import { MockBackend } from '../backend/mock';
import { TauriBackend, inTauri } from '../backend/tauri';
import type { GitBackend } from '../backend/types';
import { R, hasRepo, setRepo, type OpResult } from '../core/model';
import { withPlurals } from '../core/settings';
import { $, githubRepo, store } from '../core/util';
import { appLog, log, notice, run, toast } from './core';
import { renderAll, renderDock, renderSidebar } from './render';
import { t } from '../core/settings';

export const DEMO = 'demo://gitdesk';
export const isDemo = (p?: string) => (p ?? (hasRepo() ? R.path : '')).startsWith('demo://');
/** The backend for a path: demo paths (and any path in a plain browser) use the in-memory mock. */
export const B = (p?: string): GitBackend => (isDemo(p) || !inTauri() ? MockBackend : TauriBackend);
export const P = () => R.path;

export interface Recent { name: string; path: string }
export const recent = (): Recent[] => store.get<Recent[]>('gitdesk-recent', []);
function addRecent(name: string, path: string){
  if (isDemo(path)) return;
  store.set('gitdesk-recent', [{ name, path }, ...recent().filter(r => r.path !== path)].slice(0, 12));
}
export function removeRecent(path: string){ store.set('gitdesk-recent', recent().filter(r => r.path !== path)); renderAll(); }

export async function openRepo(path: string, result?: OpResult){
  try {
    if (hasRepo()) R.msg = ($('#commitMsg') as HTMLTextAreaElement).value;
    const snap = await B(path).open(path);
    setRepo(snap);
    ($('#commitMsg') as HTMLTextAreaElement).value = R.msg || '';
    ($('#amendCb') as HTMLInputElement).checked = false;
    ($('#historyFilter') as HTMLInputElement).value = '';
    ($('#branchFilter') as HTMLInputElement).value = '';
    addRecent(snap.name, snap.path);
    store.set('gitdesk-last', snap.path);
    appLog(`open ${snap.path}`);
    if (result) applyResult(result);
    renderAll();
    loadPrs();
    loadIssues(true);
  } catch (e){
    toast(t('n.openFailed', { p: path, msg: String((e as Error)?.message ?? e) }));
    if (!inTauri() || isDemo(path)) return;
    removeRecent(path);
  }
}
export function closeRepo(){
  setRepo(null);
  store.set('gitdesk-last', null);
  renderAll();
}
export async function refresh(){
  if (!hasRepo()) return;
  try {
    setRepo(await B().snapshot(P()));
  } catch (e){
    toast(String((e as Error)?.message ?? e));
  }
  renderAll();
}
export function applyResult(r: OpResult){
  r.log.forEach(e => log(e.cmd, e.lines, e.err));
  if (r.notice) notice(r.notice.kind, r.notice.key, withPlurals(r.notice.vars), r.notice.actions);
}
/** Run one backend operation under a busy key, show its result, refresh, then `after`. */
export function doOp(busyKey: string, f: () => Promise<OpResult>, after?: (r: OpResult) => void | Promise<void>){
  return run(busyKey, async () => {
    const r = await f();
    applyResult(r);
    await refresh();
    if (after) await after(r);
  });
}
export function loadPrs(){
  if (!hasRepo()) return;
  const path = P();
  B().prList(path).then(p => {
    if (!hasRepo() || R.path !== path) return;
    R.prs = p; R.prError = null; renderSidebar();
  }).catch(e => {
    if (!hasRepo() || R.path !== path) return;
    R.prs = []; R.prError = String(e); renderSidebar();
  });
}

/** Issues can be linked (#) when origin is on github.com — or in the demo repository. */
export const canLinkIssues = () => hasRepo() && (isDemo() || githubRepo(R.url) != null);
let issuesAt = 0, issuesPath = '';
/** Load the open GitHub issues for the # picker; skipped when loaded less than 2 minutes ago. */
export async function loadIssues(force = false){
  if (!hasRepo()) return;
  const path = P(), repo = githubRepo(R.url);
  if (!canLinkIssues()){ R.issues = null; R.issuesError = null; return; }
  if (!force && path === issuesPath && R.issues && Date.now() - issuesAt < 120000) return;
  issuesPath = path; issuesAt = Date.now();
  try {
    const list = isDemo() || !repo ? DEMO_ISSUES : await GitHub.issues(repo);
    if (!hasRepo() || R.path !== path) return;
    R.issues = list; R.issuesError = null;
  } catch (e){
    if (!hasRepo() || R.path !== path) return;
    issuesAt = 0; R.issuesError = String((e as Error)?.message ?? e);
  }
  renderDock();
}
