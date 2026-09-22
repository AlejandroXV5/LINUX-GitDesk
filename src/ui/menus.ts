// Menu definitions: menu bar, branch/tag and commit context menus, pickers.
import { svg } from '../core/icons';
import { R, ancestors, curBranch, hasRepo, headSha, refKind, resolve } from '../core/model';
import { S, saveSettings, t } from '../core/settings';
import { $, esc } from '../core/util';
import { act, winClose } from './actions';
import { busy, closeMenus, confirmDlg, copyText, isNarrow, menuAnchor, popoverAt, type MenuItem } from './core';
import { dlgAbout, dlgClone, dlgCompare, dlgDelete, dlgDiff, dlgNewBranch, dlgNewPR, dlgNewRepo, dlgNewTag, dlgOpenRepo, dlgOptions, dlgShortcuts, dlgWorktree } from './dialogs';
import { renderAll, renderDock, renderLayout } from './render';
import { B, DEMO, P, canLinkIssues, closeRepo, doOp, isDemo, loadIssues, openRepo, recent } from './session';

export function repoMenuItems(): MenuItem[] {
  const items: MenuItem[] = recent().map(r => ({ label: r.name, checked: hasRepo() && R.path === r.path, icon: 'repo', action: () => openRepo(r.path) }));
  items.push({ label: t('f.demo'), checked: hasRepo() && R.path === DEMO, icon: 'branches', action: () => openRepo(DEMO) });
  return items.concat([{ divider: true }, { label: t('wl.open'), icon: 'folder', action: dlgOpenRepo }, { label: t('f.clone'), icon: 'clone', action: dlgClone }, { label: t('f.newRepo'), icon: 'plus', action: dlgNewRepo }]);
}
const canUndoCommit = () => hasRepo() && R.commits[headSha()]?.parents.length === 1;

export function mainMenu(name: string): MenuItem[] {
  const repo = hasRepo(), cb = repo ? curBranch() : null, unstaged = repo ? R.work.filter(f => !f.staged).length : 0;
  switch (name){
    case 'file': return [
      { label: t('wl.open'), icon: 'folder', shortcut: 'Ctrl+O', action: dlgOpenRepo },
      { label: t('f.clone'), icon: 'clone', action: dlgClone },
      { label: t('f.newRepo'), icon: 'plus', action: dlgNewRepo },
      { label: t('f.open'), icon: 'history', submenu: repoMenuItems() },
      { divider: true },
      { label: t('f.close'), icon: 'x', disabled: !repo, action: closeRepo },
      { label: t('f.exit'), icon: 'exit', shortcut: 'Ctrl+Q', action: winClose }];
    case 'edit': return [
      { label: t('e.undoCommit'), icon: 'undo', disabled: !canUndoCommit(), action: act.undoCommit },
      { divider: true },
      { label: t('e.stageAll'), icon: 'plus', disabled: !unstaged, action: act.stageAll },
      { label: t('e.discardAll'), icon: 'undo', disabled: !unstaged, action: act.discardAll },
      { divider: true },
      { label: t('e.findHistory'), icon: 'search', shortcut: 'Ctrl+F', disabled: !repo, action: act.focusFilter },
      { label: t('e.copyBranch'), icon: 'copy', disabled: !repo, action: () => copyText(cb || headSha()) }];
    case 'view': return [
      { label: t('v.sidebar'), checked: isNarrow() ? $('#app').classList.contains('drawer-sidebar') : S.showSidebar, shortcut: 'Ctrl+B', action: act.toggleSidebar },
      { label: t('v.dock'), checked: S.showDock, shortcut: 'Ctrl+Shift+G', action: act.toggleDock },
      { label: t('v.output'), checked: S.showOutput, shortcut: 'Ctrl+J', action: act.toggleOutput },
      { divider: true },
      { label: t('v.allBranches'), checked: repo && R.showAll, disabled: !repo, action: act.toggleAll },
      { label: t('v.tags'), checked: repo && R.showTags, disabled: !repo, action: act.toggleTags },
      { label: t('v.relDates'), checked: S.dateFmt === 'relative', action: () => { S.dateFmt = S.dateFmt === 'relative' ? 'absolute' : 'relative'; saveSettings(); renderAll(); } },
      { divider: true },
      { label: t('v.theme'), icon: 'auto', submenu: (['auto', 'light', 'dark'] as const).map(x => ({ label: t('th.' + x), checked: S.theme === x, action: () => act.setTheme(x) })) },
      { label: t('v.lang'), icon: 'globe', submenu: [{ label: 'English', checked: S.lang === 'en', action: () => act.setLang('en') }, { label: 'Español', checked: S.lang === 'es', action: () => act.setLang('es') }] }];
    case 'git': return [
      { label: t('g.fetch'), icon: 'fetch', shortcut: 'Ctrl+Shift+F', disabled: !!busy || !repo, action: act.fetch },
      { label: t('g.pull'), icon: 'pull', disabled: !!busy || !cb, action: act.pull },
      { label: t('g.push'), icon: 'push', disabled: !!busy || !cb, action: act.push },
      { label: t('g.sync'), icon: 'sync', disabled: !!busy || !cb, action: act.sync },
      { divider: true },
      { label: t('g.commit'), icon: 'commit', disabled: !repo, action: () => { act.showDock(); ($('#commitMsg') as HTMLTextAreaElement).focus(); } },
      { label: t('g.stashAll'), icon: 'stash', disabled: !repo || !R.work.length, action: act.stash },
      { divider: true },
      { label: t('g.newBranch'), icon: 'branchPlus', disabled: !repo, action: act.newBranch },
      { label: t('g.manage'), icon: 'branches', disabled: !repo, action: () => { if (isNarrow()) $('#app').classList.add('drawer-sidebar'); else { S.showSidebar = true; saveSettings(); } renderLayout(); ($('#branchFilter') as HTMLInputElement).focus(); } },
      { label: t('g.newPR'), icon: 'pr', disabled: !cb, action: () => dlgNewPR(cb!) },
      { divider: true },
      { label: t('g.openBrowser'), icon: 'ext', disabled: !repo, action: () => act.openBrowser(cb) },
      { label: t('g.settings'), icon: 'gear', action: () => dlgOptions('git') }];
    case 'tools': return [
      { label: t('t.options'), icon: 'gear', shortcut: 'Ctrl+,', action: () => dlgOptions() },
      ...(repo && isDemo() ? [{ divider: true }, { label: t('t.simEdit'), icon: 'pencil', action: act.simEdit }, { label: t('t.simPush'), icon: 'cloudUp', action: act.simTeammate }] : [])];
    case 'help': return [
      { label: t('h.shortcuts'), icon: 'keyboard', action: dlgShortcuts },
      { label: t('f.demo'), icon: 'branches', action: () => openRepo(DEMO) },
      { label: t('h.about'), icon: 'info', action: dlgAbout }];
  }
  return [];
}

/** Right-click on a branch or tag — mirrors Visual Studio's Git Repository menu. */
export function refMenu(ref: string): MenuItem[] {
  const kind = refKind(ref), cb = curBranch(), cur = cb || 'HEAD';
  const isCur = kind === 'local' && ref === cb, local = kind === 'local';
  const tip = resolve(ref)!;
  return [
    { label: t('bc.checkout'), disabled: isCur, action: () => doOp('st.working', () => B().checkout(P(), ref, kind)) },
    { label: t('bc.checkoutTip'), action: () => doOp('st.working', () => B().checkout(P(), tip, 'commit')) },
    { label: t('g.openBrowser'), icon: 'ext', disabled: kind === 'tag' && !R.url, action: () => act.openBrowser(ref) },
    { divider: true },
    { label: t('bc.newLocal'), icon: 'branchPlus', action: () => dlgNewBranch(ref) },
    { label: t('bc.merge', { a: ref, b: cur }), icon: 'merge', disabled: isCur || !cb, action: () => doOp('st.working', () => B().merge(P(), ref)) },
    { label: t('bc.rebase', { a: ref, b: cur }), icon: 'rebase', disabled: isCur || !cb, action: () => doOp('st.working', () => B().rebase(P(), ref)) },
    { label: t('cc.reset'), icon: 'reset', disabled: isCur, submenu: resetItems(tip) },
    { label: t('cc.cherry'), icon: 'cherry', disabled: isCur || ancestors(headSha()).has(tip), action: () => doOp('st.working', () => B().cherryPick(P(), tip)) },
    { divider: true },
    { label: t('bc.delete'), icon: 'trash', shortcut: 'Del', disabled: isCur, action: () => dlgDelete(ref) },
    { divider: true },
    { label: t('bc.viewHistory'), icon: 'history', action: () => { R.historyRef = ref; R.showAll = false; R.selRef = ref; renderAll(); } },
    { label: t('bc.compare', { a: ref, b: cur }), icon: 'compare', disabled: isCur, action: () => dlgCompare(ref, cb || headSha()) },
    { label: t('bc.toggleHistory'), icon: 'eye', checked: R.extra.has(ref), action: () => { R.extra.has(ref) ? R.extra.delete(ref) : R.extra.add(ref); renderAll(); } },
    { divider: true },
    { label: 'Fetch', icon: 'fetch', action: act.fetch },
    { label: 'Pull', icon: 'pull', disabled: !local || ref !== cb, action: act.pull },
    { label: 'Push', icon: 'push', disabled: !local, action: () => act.pushBranch(ref) },
    { label: t('g.sync'), icon: 'sync', disabled: !local || ref !== cb, action: act.sync },
    { divider: true },
    { label: t('bc.newPR'), icon: 'pr', disabled: kind === 'tag', action: () => dlgNewPR(kind === 'remote' ? ref.slice(ref.indexOf('/') + 1) : ref) },
    { label: t('bc.newWorktree'), icon: 'worktree', action: () => dlgWorktree(ref) }
  ];
}
function resetItems(sha: string): MenuItem[] {
  return [
    { label: t('cc.resetMixed'), action: () => doOp('st.working', () => B().reset(P(), sha, 'mixed')) },
    { label: t('cc.resetHard'), action: () => confirmDlg(t('cc.resetHard'), esc(t('dl.discardBody')), 'Reset', true, () => { doOp('st.working', () => B().reset(P(), sha, 'hard')); }) }
  ];
}
/** Right-click on a commit in the graph. */
export function commitMenu(sha: string): MenuItem[] {
  const c = R.commits[sha]; if (!c) return [];
  const merge = c.parents.length > 1;
  return [
    { label: t('cc.checkoutDetach'), action: () => doOp('st.working', () => B().checkout(P(), sha, 'commit')) },
    { label: t('cc.newBranch'), icon: 'branchPlus', action: () => dlgNewBranch(sha) },
    { label: t('cc.newTag'), icon: 'tag', action: () => dlgNewTag(sha) },
    { divider: true },
    { label: t('cc.revert'), icon: 'revert', disabled: merge, action: () => doOp('st.working', () => B().revert(P(), sha)) },
    { label: t('cc.cherry'), icon: 'cherry', disabled: merge || ancestors(headSha()).has(sha), action: () => doOp('st.working', () => B().cherryPick(P(), sha)) },
    { label: t('cc.reset'), icon: 'reset', disabled: sha === headSha(), submenu: resetItems(sha) },
    { divider: true },
    { label: t('cc.copyId'), icon: 'copy', action: () => copyText(sha) },
    { label: t('cc.copyMsg'), icon: 'copy', action: () => copyText(c.msg) },
    { label: t('g.openBrowser'), icon: 'ext', action: () => act.openBrowser(sha) },
    { divider: true },
    { label: t('cc.details'), icon: 'info', action: () => { R.selected = sha; renderAll(); } }
  ];
}
export function fileMenu(path: string, staged: boolean): MenuItem[] {
  const f = R.work.find(x => x.path === path && x.staged === staged); if (!f) return [];
  return [
    { label: t('dk.open'), icon: 'diff', action: () => dlgDiff(f, staged ? 'staged' : 'work') },
    staged ? { label: t('dk.unstage'), icon: 'minus', action: () => fileAct('unstage', path) } : { label: t('dk.stage'), icon: 'plus', action: () => fileAct('stage', path) },
    { label: t('dk.discard'), icon: 'undo', disabled: staged, action: () => fileAct('discard', path) },
    { divider: true },
    { label: t('dk.copyPath'), icon: 'copy', action: () => copyText(path) }
  ];
}
export function fileAct(a: 'stage' | 'unstage' | 'discard', path: string){
  if (a === 'stage') doOp('st.working', () => B().stage(P(), [path]));
  else if (a === 'unstage') doOp('st.working', () => B().unstage(P(), [path]));
  else confirmDlg(t('dk.discard'), `${esc(path)}<br><span class="hint">${esc(t('dl.discardBody'))}</span>`, t('dl.discard'), true, () => { doOp('st.working', () => B().discard(P(), [path])); });
}
export function commitMoreMenu(): MenuItem[] {
  const staged = R.work.some(f => f.staged), base = staged ? t('dk.commitStaged') : t('dk.commitAll');
  const ok = !!($('#commitMsg') as HTMLTextAreaElement).value.trim() && (R.work.length > 0 || ($('#amendCb') as HTMLInputElement).checked) && !busy;
  return [
    { label: t('dk.andPush', { c: base }), icon: 'push', disabled: !ok || !curBranch(), action: () => act.commit('push') },
    { label: t('dk.andSync', { c: base }), icon: 'sync', disabled: !ok || !curBranch(), action: () => act.commit('sync') },
    { divider: true },
    { label: t('g.stashAll'), icon: 'stash', disabled: !R.work.length, action: act.stash }
  ];
}
export function dockMoreMenu(): MenuItem[] {
  return [
    { label: t('g.stashAll'), icon: 'stash', disabled: !R.work.length, action: act.stash },
    { label: t('e.undoCommit'), icon: 'undo', disabled: !canUndoCommit(), action: act.undoCommit },
    { label: t('g.newPR'), icon: 'pr', disabled: !curBranch(), action: () => dlgNewPR(curBranch()!) },
    { divider: true },
    { label: t('g.openBrowser'), icon: 'ext', action: () => act.openBrowser(curBranch()) },
    ...(isDemo() ? [{ divider: true }, { label: t('t.simEdit'), icon: 'pencil', action: act.simEdit }, { label: t('t.simPush'), icon: 'cloudUp', action: act.simTeammate }] : [])
  ];
}
export function syncMenu(): MenuItem[] {
  const cb = curBranch();
  return [
    { label: t('g.fetch'), icon: 'fetch', disabled: !!busy, action: act.fetch },
    { label: t('g.pull'), icon: 'pull', disabled: !!busy || !cb, action: act.pull },
    { label: t('g.push'), icon: 'push', disabled: !!busy || !cb, action: act.push },
    { label: t('g.sync'), icon: 'sync', disabled: !!busy || !cb, action: act.sync }
  ];
}
export function viewRefMenu(): MenuItem[] {
  const cb = curBranch();
  const set = (ref: string | null, all = false) => () => { R.historyRef = ref; R.showAll = all; renderAll(); };
  return ([
    { label: t('gr.current', { b: cb || 'HEAD' }), checked: !R.historyRef && !R.showAll, action: set(null) },
    { label: t('gr.all'), checked: R.showAll, action: set(null, true) },
    { divider: true },
    { header: t('dk.localBranches') }
  ] as MenuItem[])
    .concat(Object.keys(R.branches).sort().map(b => ({ label: b, icon: 'branch', checked: R.historyRef === b && !R.showAll, action: set(b) })))
    .concat([{ header: t('dk.remoteBranches') }])
    .concat(Object.keys(R.remotes).sort().map(b => ({ label: b, icon: 'remote', checked: R.historyRef === b && !R.showAll, action: set(b) })));
}

// ---------- popovers ----------
export function branchPicker(anchor: HTMLElement){
  if (menuAnchor === anchor){ closeMenus(); return; }
  const el = popoverAt(anchor, `<div class="pop-search"><label class="filterbox">${svg('search')}<input placeholder="${esc(t('dk.findBranch'))}"></label></div><div class="pop-list"></div><div class="pop-foot"><button class="mi" data-newb><span class="mi-ic">${svg('branchPlus')}</span><span class="mi-label">${esc(t('g.newBranch'))}</span></button></div>`, anchor.id === 'sbBranch');
  const list = el.querySelector('.pop-list')!, inp = el.querySelector('input')!;
  const draw = () => {
    const q = inp.value.trim().toLowerCase(), f = (n: string) => !q || n.toLowerCase().includes(q);
    const loc = Object.keys(R.branches).filter(f).sort();
    const rem = Object.keys(R.remotes).filter(f).filter(r => !R.branches[r.slice(r.indexOf('/') + 1)]).sort();
    let h = '';
    if (loc.length) h += `<div class="menu-h">${esc(t('dk.localBranches'))}</div>` + loc.map(b => `<button class="mi" data-pick="${esc(b)}" data-kind="local"><span class="mi-ic">${b === curBranch() ? svg('check') : svg('branch')}</span><span class="mi-label">${esc(b)}</span></button>`).join('');
    if (rem.length) h += `<div class="menu-h">${esc(t('dk.remoteBranches'))}</div>` + rem.map(b => `<button class="mi" data-pick="${esc(b)}" data-kind="remote"><span class="mi-ic">${svg('remote')}</span><span class="mi-label">${esc(b)}</span></button>`).join('');
    list.innerHTML = h || `<div class="pop-empty">${esc(t('sb.noMatch', { q: inp.value.trim() }))}</div>`;
  };
  draw(); inp.addEventListener('input', draw); inp.focus();
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') (list.querySelector('[data-pick]') as HTMLElement | null)?.click(); });
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (b){ closeMenus(); if (b.dataset.pick !== curBranch()) doOp('st.working', () => B().checkout(P(), b.dataset.pick!, b.dataset.kind!)); return; }
    if ((e.target as HTMLElement).closest('[data-newb]')){ closeMenus(); act.newBranch(); }
  });
}
export function issuePicker(anchor: HTMLElement, fromTyping: boolean){
  if (!canLinkIssues()) return;
  const body = () => {
    if (R.issuesError && !R.issues) return `<div class="hint err pop-hint">${esc(t('dk.issuesError', { msg: R.issuesError }))}</div>`;
    if (!R.issues) return `<div class="hint pop-hint">${esc(t('st.loading'))}</div>`;
    if (!R.issues.length) return `<div class="hint pop-hint">${esc(t('dk.noIssues'))}</div>`;
    return R.issues.map(i => `<button class="mi" data-issue="${i.number}"><span class="mi-ic issue">#${i.number}</span><span class="mi-label">${esc(i.title)}</span>${R.related.includes(i.number) ? `<span class="mi-sc">${svg('check')}</span>` : ''}</button>`).join('');
  };
  const el = popoverAt(anchor, `<div class="menu-h" style="padding-top:8px">${esc(t('dk.issues'))}</div><div class="pop-list">${body()}</div>`);
  const focusFirst = () => { if (!fromTyping) (el.querySelector('.mi') as HTMLElement | null)?.focus(); };
  focusFirst();
  // Refresh in the background; redraw the list if it changed while the picker is open.
  const shown = R.issues, shownError = R.issuesError;
  loadIssues().then(() => {
    const list = el.querySelector('.pop-list');
    if (!el.isConnected || !list || (R.issues === shown && R.issuesError === shownError)) return;
    list.innerHTML = body(); focusFirst();
  });
  el.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-issue]'); if (!b) return;
    const id = +b.dataset.issue!, ta = $('#commitMsg') as HTMLTextAreaElement;
    closeMenus();
    let v = ta.value;
    if (fromTyping && v.endsWith('#')) v = v.slice(0, -1);
    if (!v.includes('#' + id)) v = (v && !/\s$/.test(v) ? v + ' ' : v) + '#' + id;
    ta.value = v; R.msg = v;
    if (!R.related.includes(id)) R.related.push(id);
    ta.focus(); renderDock();
  });
}
