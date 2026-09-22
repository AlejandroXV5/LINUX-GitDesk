// Every user action — buttons, menus, shortcuts and info-bar links end up here.
import { closeWindow, openExternal } from '../backend/tauri';
import { R, ancestors, curBranch, hasRepo, headSha } from '../core/model';
import { S, saveSettings, t } from '../core/settings';
import { $, webUrl } from '../core/util';
import { signIn } from './account';
import { appLog, busy, confirmDlg, isNarrow, log, notice, run, setNoticeActionRunner, toast } from './core';
import { dlgNewBranch, shutdown } from './dialogs';
import { renderAll, renderDock, renderLayout } from './render';
import { B, P, applyResult, doOp, isDemo, refresh } from './session';

const ta = () => $('#commitMsg') as HTMLTextAreaElement;
const amendCb = () => $('#amendCb') as HTMLInputElement;
const w = (n: number) => t(n === 1 ? 'w.change' : 'w.changes');

export const act = {
  fetch: () => doOp('st.fetching', () => B().fetch(P(), S.prune)),
  pull: () => doOp('st.pulling', () => B().pull(P())),
  push: () => doOp('st.pushing', () => B().push(P())),
  pushBranch: (b: string) => doOp('st.pushing', () => B().push(P(), b)),
  sync: () => doOp('st.syncing', () => B().sync(P())),

  commit(mode?: 'push' | 'sync'){
    if (busy || !hasRepo()) return;
    const msg = ta().value.trim(), amend = amendCb().checked;
    if (!msg){ const el = ta(); el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake'); el.focus(); return; }
    if (!R.work.length && !amend){ notice('info', 'n.nothingToCommit'); renderDock(); return; }
    const all = !R.work.some(f => f.staged);
    return doOp('st.committing', () => B().commit(P(), { message: msg, amend, all }), async r => {
      if (!r.ok) return;
      ta().value = ''; R.msg = ''; R.related = []; amendCb().checked = false;
      R.selected = headSha();
      if (mode === 'push' || (!mode && S.pushAfterCommit)){ applyResult(await B().push(P())); await refresh(); }
      else if (mode === 'sync'){ applyResult(await B().sync(P())); await refresh(); }
    });
  },
  stash: () => doOp('st.working', () => B().stashPush(P())),
  newBranch: () => dlgNewBranch(curBranch() || headSha()),
  refresh: () => run('st.loading', async () => { await refresh(); appLog('refresh'); }),
  toggleAll: () => { R.showAll = !R.showAll; renderAll(); },
  toggleTags: () => { R.showTags = !R.showTags; renderAll(); },
  toggleSidebar(){ if (isNarrow()){ $('#app').classList.toggle('drawer-sidebar'); $('#app').classList.remove('drawer-dock'); } else { S.showSidebar = !S.showSidebar; saveSettings(); } renderLayout(); },
  toggleDock(){ if (isNarrow()){ $('#app').classList.toggle('drawer-dock'); $('#app').classList.remove('drawer-sidebar'); } else { S.showDock = !S.showDock; saveSettings(); } renderLayout(); renderDock(); },
  toggleOutput(){ if (isNarrow()) $('#app').classList.toggle('drawer-output'); else { S.showOutput = !S.showOutput; saveSettings(); } renderLayout(); },
  showDock(){ if (isNarrow()){ $('#app').classList.add('drawer-dock'); $('#app').classList.remove('drawer-sidebar'); } else { S.showDock = true; saveSettings(); } renderLayout(); renderDock(); },
  viewAll(){ R.historyRef = null; R.showAll = false; if (isNarrow()) $('#app').classList.remove('drawer-dock'); renderAll(); $('#graphBody').focus(); },
  stageAll: () => doOp('st.working', () => B().stage(P(), [...new Set(R.work.filter(f => !f.staged).map(f => f.path))])),
  unstageAll: () => doOp('st.working', () => B().unstage(P(), [...new Set(R.work.filter(f => f.staged).map(f => f.path))])),
  discardAll(){
    const n = R.work.filter(f => !f.staged).length; if (!n) return;
    confirmDlg(t('dl.discardAll', { n, ch: w(n) }), t('dl.discardBody'), t('dl.discard'), true, () => { doOp('st.working', () => B().discardAll(P())); });
  },
  undoCommit(){
    const h = R.commits[headSha()]; if (!h || h.parents.length !== 1) return;
    const b = curBranch(), up = b ? R.branches[b].upstream : null;
    if (up && R.remotes[up] && ancestors(R.remotes[up]).has(h.sha)){ notice('warn', 'n.undoPushed'); renderDock(); return; }
    doOp('st.working', () => B().reset(P(), 'HEAD~1', 'soft'), r => { if (r.ok){ ta().value = h.msg; R.msg = h.msg; renderDock(); } });
  },
  simEdit(){ const be = B(); if (!be.simulateEdit) return; const p = be.simulateEdit(P()); toast(t('n.edited', { f: p })); refresh(); },
  simTeammate(){ const be = B(); if (!be.simulateTeammate) return; const r = be.simulateTeammate(P()); if (r) toast(t('n.teammate', r), { label: 'Fetch', fn: () => act.fetch() }); },
  focusFilter(){ const f = $('#historyFilter') as HTMLInputElement; f.focus(); f.select(); },
  async openBrowser(ref?: string | null){
    const base = webUrl(R.url);
    if (!base){ notice('info', 'n.noRemote'); renderDock(); return; }
    const name = ref && R.remotes[ref] ? ref.slice(ref.indexOf('/') + 1) : ref;
    const u = base + (ref ? (R.commits[ref] ? '/commit/' + ref : '/tree/' + name) : '');
    log(`xdg-open ${u}`, [], false, 'app');
    if (isDemo() || !(await openExternal(u))) toast(t('n.openBrowser', { url: u }));
  },
  abort: (op: string) => doOp('st.working', () => B().abort(P(), op)),
  async exit(){
    if (await closeWindow()) return;
    shutdown(t('closed.title'), t('closed.text'), t('closed.reopen'));
  },
  setLang(l: 'en' | 'es'){ S.lang = l; saveSettings(); appLog('language = ' + l); renderAll(); },
  setTheme(th: 'auto' | 'light' | 'dark'){ S.theme = th; saveSettings(); appLog('theme = ' + th); renderAll(); }
};

// Links in the Git Changes info bar ("Push", "Abort merge"…)
setNoticeActionRunner(name => {
  const map: Record<string, () => unknown> = {
    push: act.push, pull: act.pull, sync: act.sync, fetch: act.fetch, stash: act.stash, signIn,
    newBranch: () => dlgNewBranch(headSha()),
    mergeAbort: () => act.abort('merge'), rebaseAbort: () => act.abort('rebase'),
    cherryAbort: () => act.abort('cherry-pick'), revertAbort: () => act.abort('revert')
  };
  map[name]?.();
});

/** Close the window: warn when there are uncommitted changes. */
export function winClose(){
  const n = hasRepo() ? R.work.length : 0;
  if (!n){ act.exit(); return; }
  confirmDlg(t('close.title'), t('close.body', { n, ch: w(n) }), t('close.btn'), false, () => act.exit());
}
