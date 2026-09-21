// UI infrastructure: toast, info-bar notices, busy state, menus, popovers, dialogs.
import { svg } from '../core/icons';
import { R, hasRepo, type Notice } from '../core/model';
import { t } from '../core/settings';
import { $, $$, esc } from '../core/util';

// ---------- toast ----------
let toastTimer: number | undefined;
export interface Action { label: string; fn: () => void }
export function toast(msg: string, action?: Action | null){
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button class="link">${esc(action.label)}</button>` : '');
  if (action) (el.querySelector('button') as HTMLButtonElement).onclick = () => { el.classList.remove('show'); action.fn(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), action ? 5000 : 2600);
}

export const isNarrow = () => window.innerWidth <= 760;

// ---------- notices (Git Changes info bar) ----------
// Set by main.ts: how a notice's action names ("push", "mergeAbort"…) run.
export let runNoticeAction: (name: string) => void = () => {};
export function setNoticeActionRunner(fn: (name: string) => void){ runNoticeAction = fn; }
let dockVisibleFn: () => boolean = () => true;
export function setDockVisible(fn: () => boolean){ dockVisibleFn = fn; }

export function notice(kind: string, key: string, vars: Record<string, string> = {}, actions: string[] = []){
  if (!hasRepo()) { toast(t(key, vars)); return; }
  const n: Notice = { kind, key, vars, actions };
  R.notice = n;
  if (!dockVisibleFn()){
    const a = actions[0];
    toast(t(key, vars), a ? { label: t('act.' + a), fn: () => runNoticeAction(a) } : null);
  }
}

// ---------- busy state ----------
export let busy: string | null = null;
let onBusyChange: () => void = () => {};
export function setBusyListener(fn: () => void){ onBusyChange = fn; }
/** Run an async job with a busy indicator; ignores re-entry while busy. */
export async function run(key: string, fn: () => Promise<void>){
  if (busy) return;
  busy = key; onBusyChange();
  try { await fn(); }
  catch (err){ console.error(err); notice('error', 'n.gitError', { msg: String((err as Error)?.message ?? err) }); }
  finally { busy = null; onBusyChange(); }
}

// ---------- menus ----------
export interface MenuItem {
  label?: string; icon?: string; shortcut?: string; disabled?: boolean; checked?: boolean;
  action?: () => void; submenu?: MenuItem[]; divider?: boolean; header?: string;
}
type MenuEl = HTMLDivElement & { _sub?: MenuEl | null; _from?: HTMLElement; _parent?: MenuEl };
export let menuAnchor: Element | null = null;

export function closeMenus(){
  $$('.menu, .popover').forEach(m => m.remove());
  $$('.menubar .mb[aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
  menuAnchor = null;
}
export function place(el: HTMLElement, x: number, y: number, alignRight = false){
  el.style.left = '0px'; el.style.top = '0px';
  const wd = el.offsetWidth, ht = el.offsetHeight;
  let vx = alignRight ? x - wd : x;
  vx = Math.max(8, Math.min(vx, window.innerWidth - wd - 8));
  let vy = y;
  if (vy + ht > window.innerHeight - 8) vy = Math.max(8, window.innerHeight - ht - 8);
  el.style.left = vx + 'px'; el.style.top = vy + 'px';
}
function buildMenu(items: (MenuItem | null | false)[]): MenuEl {
  const el = document.createElement('div') as MenuEl;
  el.className = 'menu'; el.setAttribute('role', 'menu');
  items.forEach(it => {
    if (!it) return;
    if (it.divider){ el.insertAdjacentHTML('beforeend', '<div class="menu-sep" role="separator"></div>'); return; }
    if (it.header){ el.insertAdjacentHTML('beforeend', `<div class="menu-h">${esc(it.header)}</div>`); return; }
    const b = document.createElement('button') as HTMLButtonElement & { _openSub?: () => void };
    b.type = 'button'; b.className = 'mi'; b.setAttribute('role', 'menuitem'); b.disabled = !!it.disabled;
    b.innerHTML = `<span class="mi-ic">${it.checked ? svg('check') : it.icon ? svg(it.icon) : ''}</span><span class="mi-label">${esc(it.label)}</span>` +
      (it.shortcut ? `<span class="mi-sc">${esc(it.shortcut)}</span>` : '') + (it.submenu ? '<span class="mi-sc">▸</span>' : '');
    if (it.submenu){
      const open = () => openSub(b, el, it.submenu!);
      b.addEventListener('mouseenter', open);
      b.addEventListener('click', e => { e.stopPropagation(); open(); (el._sub?.querySelector('.mi:not(:disabled)') as HTMLElement | null)?.focus(); });
      b._openSub = open;
    } else {
      b.addEventListener('mouseenter', () => closeSub(el));
      b.addEventListener('click', e => { e.stopPropagation(); closeMenus(); it.action?.(); });
    }
    el.appendChild(b);
  });
  return el;
}
function openSub(btn: HTMLElement, parent: MenuEl, items: MenuItem[]){
  if (parent._sub && parent._sub._from === btn) return;
  closeSub(parent);
  const sub = buildMenu(items); sub._from = btn; sub._parent = parent;
  document.body.appendChild(sub); parent._sub = sub; btn.classList.add('sub-open');
  const r = btn.getBoundingClientRect();
  place(sub, r.right - 2, r.top - 4);
  if (sub.getBoundingClientRect().left < r.right - 10) place(sub, r.left - sub.offsetWidth + 2, r.top - 4);
}
export function closeSub(menu: MenuEl){
  if (menu._sub){ closeSub(menu._sub); menu._sub._from?.classList.remove('sub-open'); menu._sub.remove(); menu._sub = null; }
}
export function showMenu(items: (MenuItem | null | false)[], x: number, y: number, anchor?: Element | null, alignRight = false){
  closeMenus();
  const el = buildMenu(items); document.body.appendChild(el);
  place(el, x, y, alignRight); menuAnchor = anchor || null;
  return el;
}
export function menuAt(anchor: Element, items: (MenuItem | null | false)[], alignRight = false){
  if (menuAnchor === anchor){ closeMenus(); return null; }
  const r = anchor.getBoundingClientRect();
  const el = showMenu(items, alignRight ? r.right : r.left, r.bottom + 2, anchor, alignRight);
  if (r.bottom + el.offsetHeight > window.innerHeight - 8) place(el, alignRight ? r.right : r.left, r.top - el.offsetHeight - 2, alignRight);
  menuAnchor = anchor;
  return el;
}
export function popoverAt(anchor: Element, html: string, above = false){
  closeMenus();
  const el = document.createElement('div'); el.className = 'popover'; el.innerHTML = html;
  document.body.appendChild(el);
  const r = anchor.getBoundingClientRect();
  if (above || r.bottom + el.offsetHeight > window.innerHeight - 8) place(el, r.left, r.top - el.offsetHeight - 4);
  else place(el, r.left, r.bottom + 4);
  menuAnchor = anchor;
  return el;
}
/** Keyboard navigation inside open menus. Returns true when it handled the key. */
export function menuKeys(e: KeyboardEvent): boolean {
  const open = $('.menu, .popover');
  if (!open) return false;
  if (e.key === 'Escape'){ e.preventDefault(); closeMenus(); return true; }
  if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return false;
  const menus = $$<MenuEl>('.menu'); const m = menus[menus.length - 1] || open;
  const items = $$<HTMLButtonElement>('.mi:not(:disabled)', m);
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp'){
    e.preventDefault();
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  } else if (e.key === 'ArrowRight'){
    const a = document.activeElement as HTMLElement & { _openSub?: () => void };
    if (a?._openSub){ e.preventDefault(); a._openSub(); ($$('.menu').pop()?.querySelector('.mi:not(:disabled)') as HTMLElement | null)?.focus(); }
  } else if (e.key === 'ArrowLeft' && (m as MenuEl)._parent){
    e.preventDefault(); const from = (m as MenuEl)._from; closeSub((m as MenuEl)._parent!); from?.focus();
  }
  return true;
}

// ---------- dialogs ----------
export interface DialogAction { label: string; primary?: boolean; danger?: boolean; fn?: (d: DialogApi) => unknown; el?: HTMLButtonElement }
export interface DialogApi { el: HTMLElement; $: <T extends Element = HTMLInputElement>(s: string) => T; $$: (s: string) => HTMLElement[]; close: () => void }
export function dialog(o: { title: string; body: string; actions?: DialogAction[]; wide?: boolean; onMount?: (d: DialogApi) => void }): DialogApi {
  closeMenus();
  const bd = document.createElement('div');
  bd.className = 'dlg-backdrop';
  bd.innerHTML = `<div class="dlg${o.wide ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="dlgT"><div class="dlg-head"><h2 id="dlgT">${esc(o.title)}</h2><button class="icon-btn dlg-x" aria-label="${esc(t('dl.close'))}">${svg('x')}</button></div><div class="dlg-body">${o.body}</div><div class="dlg-foot"></div></div>`;
  const prev = document.activeElement as HTMLElement | null;
  const api: DialogApi = { el: bd, $: <T extends Element>(s: string) => bd.querySelector(s) as T, $$: s => $$(s, bd), close };
  const foot = bd.querySelector('.dlg-foot')!;
  const actions = o.actions || [];
  actions.forEach(a => {
    const b = document.createElement('button');
    b.className = 'btn ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-secondary');
    b.textContent = a.label; a.el = b;
    b.addEventListener('click', () => { const r = a.fn ? a.fn(api) : undefined; if (r !== false) close(); });
    foot.appendChild(b);
  });
  function onKey(e: KeyboardEvent){
    if (e.key === 'Escape'){ e.stopPropagation(); e.preventDefault(); close(); }
    else if (e.key === 'Enter' && !e.shiftKey && !/TEXTAREA|BUTTON|SELECT/.test((e.target as HTMLElement).tagName)){
      const p = actions.find(a => a.primary); if (p && p.el && !p.el.disabled){ e.preventDefault(); p.el.click(); }
    }
  }
  function close(){ bd.remove(); document.removeEventListener('keydown', onKey, true); prev?.focus?.(); }
  document.addEventListener('keydown', onKey, true);
  bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
  bd.querySelector('.dlg-x')!.addEventListener('click', close);
  document.body.appendChild(bd);
  o.onMount?.(api);
  const first = bd.querySelector<HTMLElement>('.dlg-body input:not([type=checkbox]), .dlg-body select, .dlg-body textarea') || bd.querySelector<HTMLElement>('.btn-primary');
  first?.focus();
  return api;
}
export function confirmDlg(title: string, bodyHtml: string, label: string, danger: boolean, fn: () => void){
  dialog({ title, body: `<p style="margin:0">${bodyHtml}</p>`, actions: [{ label: t('dl.cancel') }, { label, primary: !danger, danger, fn: () => { fn(); } }] });
}

// ---------- clipboard ----------
export function copyText(s: string){
  const doneFn = () => toast(t('n.copied'));
  const fallback = () => {
    const ta = document.createElement('textarea'); ta.value = s; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch { /* ignore */ }
    ta.remove(); doneFn();
  };
  try { navigator.clipboard.writeText(s).then(doneFn, fallback); } catch { fallback(); }
}

// ---------- output log ----------
export interface OutLine { ch: 'git' | 'app'; tm: Date; text: string; kind: string }
export const OUT: OutLine[] = [];
let onLog: () => void = () => {};
export function setLogListener(fn: () => void){ onLog = fn; }
export function log(cmd: string, lines: string[] = [], err = false, ch: 'git' | 'app' = 'git'){
  const tm = new Date();
  OUT.push({ ch, tm, text: cmd, kind: 'cmd' });
  lines.forEach(l => OUT.push({ ch, tm, text: l, kind: err && /error|fatal|rejected|!/.test(l) ? 'err' : '' }));
  if (OUT.length > 1000) OUT.splice(0, OUT.length - 1000);
  onLog();
}
export const appLog = (text: string) => log(text, [], false, 'app');
