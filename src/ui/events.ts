// Event wiring: one delegated listener per region.
import { svg } from '../core/icons';
import { R, curBranch, hasRepo, headSha, refKind } from '../core/model';
import { t } from '../core/settings';
import { $, $$ } from '../core/util';
import { accountMenu, signIn } from './account';
import { act, winClose } from './actions';
import { OUT, appLog, closeMenus, copyText, isNarrow, menuAnchor, menuAt, menuKeys, runNoticeAction, showMenu } from './core';
import { dlgClone, dlgDelete, dlgDiff, dlgNewPR, dlgNewRepo, dlgOpenRepo, dlgOptions, dlgPR, dlgStash, dlgSubmodule } from './dialogs';
import { branchPicker, commitMenu, commitMoreMenu, dockMoreMenu, fileAct, fileMenu, issuePicker, mainMenu, refMenu, repoMenuItems, syncMenu, viewRefMenu } from './menus';
import { filesFor, renderAll, renderChrome, renderDetail, renderDock, renderGraph, renderLayout, renderOutput, renderSidebar } from './render';
import { B, DEMO, P, doOp, loadPrs, openRepo, refresh, removeRecent } from './session';

const ta = () => $('#commitMsg') as HTMLTextAreaElement;
const closest = <T extends HTMLElement = HTMLElement>(e: Event, sel: string) => (e.target as HTMLElement).closest<T>(sel);

export function wire(){
  $$('i[data-ic]').forEach(el => { el.outerHTML = svg(el.dataset.ic!); });

  // any [data-act] button
  document.addEventListener('click', e => {
    const b = closest<HTMLButtonElement>(e, '[data-act]');
    if (!b || b.disabled) return;
    const fn = (act as Record<string, unknown>)[b.dataset.act!];
    if (typeof fn === 'function') (fn as () => void).call(act);
  });
  // close menus when clicking elsewhere
  document.addEventListener('mousedown', e => { if (!closest(e, '.menu, .popover, [data-keepmenu]')) closeMenus(); });
  window.addEventListener('resize', () => { closeMenus(); renderLayout(); });

  // title bar (browser demo only) + quick language/theme toggles
  $('#langBtn').addEventListener('click', () => act.setLang(document.documentElement.lang === 'es' ? 'en' : 'es'));
  $('#themeBtn').addEventListener('click', () => { const cur = document.documentElement.getAttribute('data-theme'); act.setTheme(cur === 'light' ? 'dark' : cur === 'dark' ? 'auto' : 'light'); });
  $('#winClose').addEventListener('click', winClose);
  $('#accountBtn').addEventListener('click', e => accountMenu(e.currentTarget as HTMLElement));
  $('#shutBtn').addEventListener('click', () => { $('#shutdown').hidden = true; appLog('window restored'); renderAll(); });

  // menu bar
  const openMain = (b: HTMLElement) => { if (menuAt(b, mainMenu(b.dataset.menu!))) b.setAttribute('aria-expanded', 'true'); };
  $$('.menubar .mb').forEach(b => {
    b.addEventListener('click', () => { const was = menuAnchor === b; closeMenus(); if (!was) openMain(b); });
    b.addEventListener('mouseenter', () => { if (menuAnchor && (menuAnchor as HTMLElement).classList?.contains('mb') && menuAnchor !== b){ closeMenus(); openMain(b); } });
  });

  // welcome screen
  $('#welcome').addEventListener('click', e => {
    const f = closest(e, '[data-forget]'); if (f){ e.stopPropagation(); removeRecent(f.dataset.forget!); return; }
    const o = closest(e, '[data-open]'); if (o){ openRepo(o.dataset.open!); return; }
    const a = closest(e, '[data-wl]')?.dataset.wl;
    if (a === 'open') dlgOpenRepo(); else if (a === 'clone') dlgClone(); else if (a === 'new') dlgNewRepo(); else if (a === 'demo') openRepo(DEMO); else if (a === 'signin') signIn();
  });
  $('#welcome').addEventListener('keydown', e => { const o = closest(e, '[data-open]'); if (o && e.key === 'Enter') openRepo(o.dataset.open!); });

  // sidebar tree
  const tr = $('#tree');
  const select = (row: HTMLElement) => { $$('.trow.selected', tr).forEach(x => x.classList.remove('selected')); row.classList.add('selected'); row.focus(); };
  tr.addEventListener('click', e => {
    const sec = closest(e, '[data-sec]'); if (sec){ const k = sec.dataset.sec!; R.secClosed.has(k) ? R.secClosed.delete(k) : R.secClosed.add(k); renderSidebar(); return; }
    if (closest(e, '[data-addsub]')){ dlgSubmodule(); return; }
    const pm = closest(e, '[data-prmenu]'); if (pm){ menuAt(pm, [{ label: t('g.newPR'), icon: 'pr', disabled: !curBranch(), action: () => dlgNewPR(curBranch()!) }, { label: t('gr.refresh'), icon: 'refresh', action: loadPrs }], true); return; }
    const rs = closest(e, '[data-rmsub]'); if (rs){ doOp('st.working', () => B().submoduleRemove(P(), rs.dataset.rmsub!)); return; }
    const rw = closest(e, '[data-rmwt]'); if (rw){ doOp('st.working', () => B().worktreeRemove(P(), rw.dataset.rmwt!)); return; }
    const pr = closest(e, '[data-pr]'); if (pr){ dlgPR(+pr.dataset.pr!); return; }
    const f = closest(e, '[data-folder]'); if (f){ const k = f.dataset.folder!; R.openFolders.has(k) ? R.openFolders.delete(k) : R.openFolders.add(k); renderSidebar(); return; }
    const r = closest(e, '[data-ref]');
    if (r){ R.selRef = r.dataset.ref!; R.historyRef = r.dataset.ref === curBranch() ? null : r.dataset.ref!; R.showAll = false; select(r); renderGraph(); renderChrome(); return; }
    if (closest(e, '[data-root]')){ R.historyRef = null; R.selRef = null; renderAll(); }
  });
  tr.addEventListener('dblclick', e => {
    const r = closest(e, '[data-ref]'); if (!r) return;
    const ref = r.dataset.ref!;
    if (ref !== curBranch()) doOp('st.working', () => B().checkout(P(), ref, refKind(ref)));
    if (isNarrow()){ $('#app').classList.remove('drawer-sidebar'); renderLayout(); }
  });
  tr.addEventListener('contextmenu', e => {
    const r = closest(e, '[data-ref]'); if (!r) return;
    e.preventDefault(); R.selRef = r.dataset.ref!; select(r);
    showMenu(refMenu(r.dataset.ref!), (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  tr.addEventListener('keydown', e => {
    const rows = $$('[data-ref]', tr); const i = rows.findIndex(x => x.dataset.ref === R.selRef);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){ e.preventDefault(); rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.click(); }
    else if (e.key === 'Enter' && R.selRef && R.selRef !== curBranch()){ const ref = R.selRef; doOp('st.working', () => B().checkout(P(), ref, refKind(ref))); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && R.selRef){ e.preventDefault(); dlgDelete(R.selRef); }
    else if ((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu'){ const row = rows[i]; if (row){ e.preventDefault(); const rc = row.getBoundingClientRect(); showMenu(refMenu(R.selRef!), rc.left + 40, rc.bottom); } }
  });
  $('#branchFilter').addEventListener('input', renderSidebar);

  // graph
  const gp = $('#graphPane');
  const selectCommit = (sha: string) => { R.selected = sha; renderGraph(); renderDetail(); };
  gp.addEventListener('click', e => {
    if (closest(e, '[data-inc]')){ R.incOpen = !R.incOpen; renderGraph(); return; }
    const row = closest(e, '.crow'); if (row){ selectCommit(row.dataset.sha!); $('#graphBody').focus({ preventScroll: true }); return; }
    const dt = closest(e, '[data-dact]');
    if (dt){ const a = dt.dataset.dact; if (a === 'close'){ R.selected = null; renderDetail(); renderGraph(); } else if (a === 'copy') copyText(R.selected!); else if (a === 'menu') menuAt(dt, commitMenu(R.selected!), true); return; }
    const go = closest(e, '[data-goto]'); if (go){ selectCommit(go.dataset.goto!); $(`.crow[data-sha="${go.dataset.goto}"]`)?.scrollIntoView({ block: 'nearest' }); return; }
    const fr = closest(e, '#detail .frow'); if (fr){ const f = (filesFor(R.selected!) || []).find(x => x.path === fr.dataset.path); if (f) dlgDiff(f, R.selected!); }
  });
  gp.addEventListener('contextmenu', e => { const row = closest(e, '.crow'); if (!row) return; e.preventDefault(); selectCommit(row.dataset.sha!); showMenu(commitMenu(row.dataset.sha!), (e as MouseEvent).clientX, (e as MouseEvent).clientY); });
  $('#graphBody').addEventListener('keydown', e => {
    const rows = $$('.crow', $('#graphBody')); const i = rows.findIndex(r => r.dataset.sha === R.selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
      e.preventDefault();
      const n = rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (n){ selectCommit(n.dataset.sha!); $(`#graphBody .crow[data-sha="${R.selected}"]`)?.scrollIntoView({ block: 'nearest' }); }
    } else if (((e.key === 'F10' && e.shiftKey) || e.key === 'ContextMenu') && R.selected && rows[i]){ e.preventDefault(); const rc = rows[i].getBoundingClientRect(); showMenu(commitMenu(R.selected), rc.left + 200, rc.bottom); }
    else if (e.key === 'Escape'){ R.selected = null; renderGraph(); renderDetail(); }
  });
  $('#historyFilter').addEventListener('input', renderGraph);
  $('#viewRefBtn').addEventListener('click', e => menuAt(e.currentTarget as Element, viewRefMenu()));

  // output
  $('#outChannel').addEventListener('change', renderOutput);
  $('#outClear').addEventListener('click', () => { const ch = ($('#outChannel') as HTMLSelectElement).value; for (let i = OUT.length - 1; i >= 0; i--) if (OUT[i].ch === ch) OUT.splice(i, 1); renderOutput(); });

  // Git Changes dock
  $('#branchSelect').addEventListener('click', e => branchPicker(e.currentTarget as HTMLElement));
  $('#dockMore').addEventListener('click', e => menuAt(e.currentTarget as Element, dockMoreMenu(), true));
  $('#dockCounts').addEventListener('click', e => menuAt(e.currentTarget as Element, syncMenu()));
  $('#commitMore').addEventListener('click', e => menuAt(e.currentTarget as Element, commitMoreMenu()));
  $('#commitBtn').addEventListener('click', () => act.commit());
  $('#hashBtn').addEventListener('click', e => { if (menuAnchor === e.currentTarget) closeMenus(); else issuePicker(e.currentTarget as HTMLElement, false); });
  ta().addEventListener('input', e => { R.msg = ta().value; renderDock(); if ((e as InputEvent).data === '#') issuePicker($('#hashBtn'), true); });
  ta().addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)){ e.preventDefault(); act.commit(); } });
  $('#amendCb').addEventListener('change', e => {
    const h = R.commits[headSha()], on = (e.target as HTMLInputElement).checked;
    if (h && on && !ta().value.trim()) ta().value = h.msg;
    else if (h && !on && ta().value === h.msg) ta().value = '';
    R.msg = ta().value; renderDock();
  });
  $('#notice').addEventListener('click', e => {
    const run = closest(e, '[data-nrun]');
    if (run){ R.notice = null; runNoticeAction(run.dataset.nrun!); renderDock(); return; }
    if (closest(e, '[data-nclose]')){ R.notice = null; renderDock(); }
  });
  const cs = $('#changesScroll');
  const rowFile = (el: HTMLElement) => { const r = el.closest<HTMLElement>('.frow')!; return { path: r.dataset.path!, staged: r.dataset.ctx === 'staged' }; };
  cs.addEventListener('click', e => {
    const s = closest(e, '[data-dsec]'); if (s){ const k = s.dataset.dsec!; R.dockClosed.has(k) ? R.dockClosed.delete(k) : R.dockClosed.add(k); renderDock(); return; }
    const tl = closest(e, '[data-dtool]'); if (tl){ ((act as Record<string, unknown>)[tl.dataset.dtool!] as () => void).call(act); return; }
    const ur = closest(e, '[data-unrel]'); if (ur){ const id = ur.dataset.unrel!; R.related = R.related.filter(x => x !== +id); ta().value = ta().value.replace(new RegExp('\\s?#' + id + '\\b'), ''); R.msg = ta().value; renderDock(); return; }
    const fa = closest(e, '[data-fact]');
    if (fa){ const { path, staged } = rowFile(fa); const a = fa.dataset.fact!; if (a === 'diff'){ const f = R.work.find(x => x.path === path && x.staged === staged); if (f) dlgDiff(f, staged ? 'staged' : 'work'); } else fileAct(a as 'stage' | 'unstage' | 'discard', path); return; }
    const sa = closest(e, '[data-sact]');
    if (sa){ const id = sa.closest<HTMLElement>('[data-stash]')!.dataset.stash!; const a = sa.dataset.sact; doOp('st.working', () => a === 'drop' ? B().stashDrop(P(), id) : B().stashApply(P(), id, a === 'pop')); return; }
    const st = closest(e, '[data-stash]'); if (st){ dlgStash(st.dataset.stash!); return; }
    const fr = closest(e, '.frow[data-path]');
    if (fr){ const { path, staged } = rowFile(fr); const f = R.work.find(x => x.path === path && x.staged === staged); if (f) dlgDiff(f, staged ? 'staged' : 'work'); }
  });
  cs.addEventListener('dblclick', e => { const fr = closest(e, '.frow[data-path]'); if (fr && !closest(e, 'button')){ const { path, staged } = rowFile(fr); fileAct(staged ? 'unstage' : 'stage', path); } });
  cs.addEventListener('contextmenu', e => {
    const fr = closest(e, '.frow[data-path]');
    const me = e as MouseEvent;
    if (fr){ e.preventDefault(); const { path, staged } = rowFile(fr); showMenu(fileMenu(path, staged), me.clientX, me.clientY); return; }
    const st = closest(e, '[data-stash]');
    if (st){
      e.preventDefault(); const id = st.dataset.stash!;
      showMenu([
        { label: t('dk.apply'), icon: 'check', action: () => doOp('st.working', () => B().stashApply(P(), id, false)) },
        { label: t('dk.pop'), icon: 'up', action: () => doOp('st.working', () => B().stashApply(P(), id, true)) },
        { divider: true },
        { label: t('dk.drop'), icon: 'trash', action: () => doOp('st.working', () => B().stashDrop(P(), id)) }
      ], me.clientX, me.clientY);
    }
  });

  // status bar
  $('#sbSync').addEventListener('click', e => menuAt(e.currentTarget as Element, syncMenu()));
  $('#sbChanges').addEventListener('click', () => { act.showDock(); ta().focus(); });
  $('#sbBranch').addEventListener('click', e => branchPicker(e.currentTarget as HTMLElement));
  $('#sbRepo').addEventListener('click', e => menuAt(e.currentTarget as Element, repoMenuItems(), true));

  // mobile drawers
  $('#backdrop').addEventListener('click', () => { $('#app').classList.remove('drawer-sidebar', 'drawer-dock'); renderLayout(); });

  // keyboard
  document.addEventListener('keydown', e => {
    if (menuKeys(e)) return;
    if ($('.dlg-backdrop')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && k === 'o'){ e.preventDefault(); dlgOpenRepo(); return; }
    if (mod && e.key === ','){ e.preventDefault(); dlgOptions(); return; }
    if (mod && k === 'q'){ e.preventDefault(); winClose(); return; }
    if (!hasRepo()) return;
    if (mod && e.shiftKey && k === 'f'){ e.preventDefault(); act.fetch(); }
    else if (mod && e.shiftKey && k === 'g'){ e.preventDefault(); act.toggleDock(); }
    else if (mod && !e.shiftKey && k === 'f'){ e.preventDefault(); act.focusFilter(); }
    else if (mod && !e.shiftKey && k === 'b'){ e.preventDefault(); act.toggleSidebar(); }
    else if (mod && !e.shiftKey && k === 'j'){ e.preventDefault(); act.toggleOutput(); }
    else if (e.key === 'F5'){ e.preventDefault(); act.refresh(); }
  });

  // keep in sync with changes made outside GitDesk (editor, terminal)
  window.addEventListener('focus', () => { if (hasRepo()) refresh(); });
  setInterval(() => { if (hasRepo() && !document.hidden && !$('.menu, .popover, .dlg-backdrop')) refresh(); }, 10000);
}
