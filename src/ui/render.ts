// Rendering: every panel is re-drawn from R (the repository view) + S (settings).
import { svg } from '../core/icons';
import {
  R, absDate, avatar, byHistory, curBranch, fmtDate, hasRepo, headSha, incomingList, outgoingSet, resolve, tracking,
  type Commit, type FileChange
} from '../core/model';
import { S, locale, t } from '../core/settings';
import { $, $$, baseOf, dirOf, esc, firstLine, s7, short } from '../core/util';
import { setWindowTitle } from '../backend/tauri';
import { OUT, busy, isNarrow } from './core';
import { B, P, isDemo, recent } from './session';
import { account, accountPic, renderAccount, signingIn } from './account';

export function renderAll(){
  const app = $('#app');
  app.classList.toggle('no-repo', !hasRepo());
  renderChrome(); renderLayout();
  if (!hasRepo()){ renderWelcome(); renderStatus(); renderOutput(); renderBusy(); return; }
  renderSidebar(); renderGraph(); renderDetail(); renderDock(); renderStatus(); renderOutput(); renderBusy();
}

export function applyTheme(){
  const r = document.documentElement;
  if (S.theme === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', S.theme);
  $('#themeIcon').innerHTML = svg(S.theme === 'dark' ? 'moon' : S.theme === 'light' ? 'sun' : 'auto');
  $('#themeLabel').textContent = t('th.' + S.theme);
}
export function renderChrome(){
  document.documentElement.lang = S.lang;
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n!); });
  $$<HTMLInputElement>('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh!); });
  $$('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle!); el.setAttribute('aria-label', t(el.dataset.i18nTitle!)); });
  $('#langLabel').textContent = S.lang.toUpperCase();
  applyTheme();
  renderAccount();
  if (!hasRepo()){ setWindowTitle('GitDesk'); $('#winTitle').textContent = 'GitDesk'; $('#pushCount').hidden = true; $('#pullCount').hidden = true; return; }
  const cb = curBranch();
  setWindowTitle(`GitDesk — ${R.name} (${cb || s7(headSha())})`);
  $('#winTitle').textContent = `GitDesk — ${R.name} (${cb || s7(headSha())})`;
  const tr = cb ? tracking(cb) : null, inc = incomingList().length;
  const pc = $('#pushCount'); pc.hidden = !(tr && tr.ahead); pc.textContent = tr ? String(tr.ahead) : '';
  const lc = $('#pullCount'); lc.hidden = !inc; lc.textContent = String(inc);
  $('#allBtn').setAttribute('aria-pressed', String(R.showAll)); $('#tagsBtn').setAttribute('aria-pressed', String(R.showTags));
}
export function renderLayout(){
  const app = $('#app');
  app.classList.toggle('no-sidebar', !S.showSidebar);
  app.classList.toggle('no-dock', !S.showDock);
  app.classList.toggle('no-output', !S.showOutput);
  const n = isNarrow();
  $('#dockToggle').setAttribute('aria-pressed', String(n ? app.classList.contains('drawer-dock') : S.showDock));
  $('#outputToggle').setAttribute('aria-pressed', String(n ? app.classList.contains('drawer-output') : S.showOutput));
}
const BUSY_ACT: Record<string, string> = { 'st.fetching': 'fetch', 'st.pulling': 'pull', 'st.pushing': 'push', 'st.syncing': 'sync' };
export function renderBusy(){
  $('#dockProgress').hidden = !busy;
  $$<HTMLButtonElement>('.sync-op').forEach(b => { b.disabled = !!busy || !hasRepo(); });
  $$<HTMLButtonElement>('.needs-repo').forEach(b => { b.disabled = !hasRepo(); });
  $$('.t-btn.sync-op').forEach(b => b.classList.toggle('spin', !!busy && b.dataset.act === BUSY_ACT[busy]));
  renderStatus();
  if (busy) ($('#commitBtn') as HTMLButtonElement).disabled = true;
}

// ---------- welcome ----------
function renderWelcome(){
  const rec = recent();
  $('#welcome').innerHTML = `<div class="wl-card">
    <div class="wl-head">${svg('logo', 'wl-logo')}<div><h1>${esc(t('wl.title'))}</h1><p>${esc(t('wl.sub'))}</p></div></div>
    <div class="wl-actions">
      <button class="wl-btn" data-wl="open">${svg('folder')}<span>${esc(t('wl.open'))}</span></button>
      <button class="wl-btn" data-wl="clone">${svg('clone')}<span>${esc(t('wl.clone'))}</span></button>
      <button class="wl-btn" data-wl="new">${svg('plus')}<span>${esc(t('wl.new'))}</span></button>
      <button class="wl-btn" data-wl="demo">${svg('branches')}<span>${esc(t('wl.demo'))}<small>${esc(t('wl.demoNote'))}</small></span></button>
      ${account
        ? `<div class="wl-acct">${accountPic(account)}<span>${esc(t('wl.signedAs', { name: account.name, login: account.login }))}</span></div>`
        : `<button class="wl-btn wl-wide" data-wl="signin"${signingIn ? ' disabled' : ''}>${svg('user')}<span>${esc(t(signingIn ? 'acc.waiting' : 'wl.signIn'))}<small>${esc(t('wl.signInNote'))}</small></span></button>`}
    </div>
    <div class="sub-h">${esc(t('wl.recent'))}</div>
    <div class="wl-recent">${rec.length ? rec.map(r => `<div class="wl-row" data-open="${esc(r.path)}" tabindex="0">${svg('repo')}<span class="n">${esc(r.name)}</span><span class="p">${esc(r.path)}</span><button class="icon-btn" data-forget="${esc(r.path)}" title="${esc(t('wl.remove'))}">${svg('x')}</button></div>`).join('') : `<div class="hint">${esc(t('wl.noRecent'))}</div>`}</div>
  </div>`;
}

// ---------- sidebar ----------
export function renderSidebar(){
  if (!hasRepo()) return;
  const q = ($('#branchFilter') as HTMLInputElement).value.trim().toLowerCase();
  const match = (n: string) => !q || n.toLowerCase().includes(q);
  let h = '';
  const sec = (key: string, label: string, extra = '') => { const open = !R.secClosed.has(key); return `<div class="tsec-h${open ? ' open' : ''}"><button class="tog" data-sec="${key}" aria-expanded="${open}">${svg('chev', 'chev')}<span>${esc(label)}</span></button>${extra}</div>`; };
  h += sec('br', t('sb.branchesTags'));
  if (!R.secClosed.has('br')){
    const cb = curBranch();
    h += `<div class="trow" style="padding-left:12px" data-root>${svg('repo', 'cur')}<span class="lbl" style="font-weight:700">${esc(R.name)} (${esc(cb || s7(headSha()))})</span></div>`;
    const locals = Object.keys(R.branches).filter(match).sort();
    h += tree(locals.map(n => ({ rel: n, full: n })), 1, 'local:', it => refRow(it.full, baseOf(it.rel), 'local', it.depth!), q);
    const rems = Object.keys(R.remotes).filter(match).sort();
    if (rems.length){
      const byRemote: Record<string, string[]> = {};
      rems.forEach(r => { const i = r.indexOf('/'); (byRemote[r.slice(0, i)] = byRemote[r.slice(0, i)] || []).push(r); });
      Object.keys(byRemote).sort().forEach(rem => {
        const key = rem === 'origin' ? 'remotes' : 'remotes:' + rem;
        const open = !!q || R.openFolders.has(key);
        h += folderRow('remotes/' + rem, key, 1, open, true);
        if (open) h += tree(byRemote[rem].map(n => ({ rel: n.slice(rem.length + 1), full: n })), 2, 'remote:' + rem + ':', it => refRow(it.full, baseOf(it.rel), 'remote', it.depth!), q);
      });
    }
    const tags = Object.keys(R.tags).filter(match).sort((a, b) => (R.commits[R.tags[b]]?.t || 0) - (R.commits[R.tags[a]]?.t || 0));
    if (tags.length){
      const open = !!q || R.openFolders.has('tags');
      h += folderRow(t('sb.tags'), 'tags', 1, open, false);
      if (open) tags.forEach(n => { h += refRow(n, n, 'tag', 2); });
    }
    if (q && !locals.length && !rems.length && !tags.length) h += `<div class="tempty">${esc(t('sb.noMatch', { q }))}</div>`;
  }
  h += sec('pr', t('sb.prs'), `<button class="icon-btn" data-keepmenu data-prmenu title="${esc(t('sb.prMenu'))}">${svg('dots')}</button>`);
  if (!R.secClosed.has('pr')){
    if (R.prError) h += `<div class="tempty">${esc(R.prError === 'gh-missing' ? t('n.ghMissing') : R.prError)}</div>`;
    else if (!R.prs.length) h += `<div class="tempty">${esc(t('sb.noPrs'))}</div>`;
    R.prs.slice().sort((a, b) => b.id - a.id).forEach(p => { h += `<div class="prrow" data-pr="${p.id}"><div class="t1">${svg('pr')}<strong>#${p.id}</strong><span class="lbl">${esc(p.title)}</span><span class="st-badge st-${p.status}">${esc(t('pr.' + p.status))}</span></div><div class="t2">${esc(t('pr.into', { s: p.source, t: p.target }))}</div></div>`; });
  }
  if (R.worktrees.length){
    h += sec('wt', t('sb.worktrees'));
    if (!R.secClosed.has('wt')) R.worktrees.forEach(x => { h += `<div class="subrow">${svg('worktree')}<span class="lbl">${esc(x.path)} <span class="muted">[${esc(x.branch)}]</span></span><button class="icon-btn" data-rmwt="${esc(x.path)}" title="${esc(t('sb.remove'))}">${svg('x')}</button></div>`; });
  }
  h += sec('sub', t('sb.submodules'), `<button class="icon-btn" data-addsub title="${esc(t('sb.addSub'))}">${svg('plus')}</button>`);
  if (!R.secClosed.has('sub')){
    if (!R.submodules.length) h += `<div class="tempty">${esc(t('sb.noSub'))}</div>`;
    R.submodules.forEach(s => { h += `<div class="subrow">${svg('repo')}<span class="lbl" title="${esc(s.url)}">${esc(s.path)}</span><button class="icon-btn" data-rmsub="${esc(s.path)}" title="${esc(t('sb.remove'))}">${svg('x')}</button></div>`; });
  }
  const treeEl = $('#tree'), st = treeEl.scrollTop;
  treeEl.innerHTML = h; treeEl.scrollTop = st;
}
interface TreeItem { rel: string; full: string; path?: string; depth?: number }
function tree(items: TreeItem[], depth: number, keyPrefix: string, rowFn: (it: TreeItem) => string, q: string): string {
  const folders: Record<string, TreeItem[]> = {}, leaves: TreeItem[] = [];
  items.forEach(it => {
    const i = it.rel.indexOf('/');
    if (i > 0){ const f = it.rel.slice(0, i); (folders[f] = folders[f] || []).push({ rel: it.rel.slice(i + 1), full: it.full, path: (it.path ? it.path + '/' : '') + f }); }
    else leaves.push({ ...it, depth });
  });
  let h = '';
  Object.keys(folders).sort().forEach(f => {
    const key = keyPrefix + (folders[f][0].path || f);
    const open = !!q || R.openFolders.has(key);
    h += folderRow(f, key, depth, open, false);
    if (open) h += tree(folders[f], depth + 1, keyPrefix, rowFn, q);
  });
  leaves.forEach(it => { h += rowFn(it); });
  return h;
}
function folderRow(label: string, key: string, depth: number, open: boolean, remoteIcon: boolean){
  return `<div class="trow folder${open ? ' open' : ''}" data-folder="${esc(key)}" style="padding-left:${depth * 16}px" role="treeitem" aria-expanded="${open}">${svg('chev', 'fchev')}${svg(remoteIcon ? 'remote' : 'folder', remoteIcon ? 'remote' : '')}<span class="lbl">${esc(label)}</span></div>`;
}
function refRow(full: string, label: string, kind: string, depth: number){
  const isCur = kind === 'local' && R.head.branch === full;
  const tr = kind === 'local' ? tracking(full) : null;
  const gone = kind === 'local' && (R.branches[full].gone || (!!R.branches[full].upstream && !R.remotes[R.branches[full].upstream!]));
  const icon = kind === 'local' ? svg('branch', isCur ? 'cur' : 'local') : kind === 'remote' ? svg('remote', 'remote') : svg('tag', 'tag');
  let tail = '';
  if (R.extra.has(full)) tail += svg('eye', 'eye');
  if (tr && tr.ahead) tail += `<span class="pill ahead" title="${tr.ahead} outgoing">↑${tr.ahead}</span>`;
  if (tr && tr.behind) tail += `<span class="pill behind" title="${tr.behind} incoming">↓${tr.behind}</span>`;
  if (gone) tail += `<span class="pill gone">gone</span>`;
  if (isCur) tail += svg('check', 'cur');
  return `<div class="trow${isCur ? ' current' : ''}${R.selRef === full ? ' selected' : ''}" data-ref="${esc(full)}" data-kind="${kind}" tabindex="-1" role="treeitem" style="padding-left:${depth * 16}px"><span class="tw"></span>${icon}<span class="lbl" title="${esc(full)}">${esc(label)}</span>${tail}</div>`;
}

// ---------- commit graph ----------
function viewTips(): string[] {
  const tips: string[] = [];
  if (R.showAll){
    Object.values(R.branches).forEach(b => tips.push(b.tip));
    Object.values(R.remotes).forEach(s => tips.push(s));
    if (R.showTags) Object.values(R.tags).forEach(s => tips.push(s));
    if (R.head.detached) tips.push(R.head.detached);
  } else {
    const main = R.historyRef ? resolve(R.historyRef) : headSha();
    if (main) tips.push(main);
    R.extra.forEach(r => { const s = resolve(r); if (s) tips.push(s); });
  }
  return tips;
}
interface Lane { c: Commit; col: number; before: (string | null)[]; after: (string | null)[]; pcols: number[] }
/** Assign each commit a column; lanes carry the sha each column is waiting for. */
export function layout(rows: Commit[], visible: Set<string>): Lane[] {
  let lanes: (string | null)[] = []; const out: Lane[] = [];
  rows.forEach(c => {
    const before = lanes.slice();
    let col = before.indexOf(c.sha);
    if (col < 0){ col = before.indexOf(null); if (col < 0) col = before.length; }
    const after = before.slice();
    before.forEach((s, i) => { if (s === c.sha) after[i] = null; });
    while (after.length <= col) after.push(null);
    const pcols: number[] = [];
    c.parents.filter(p => visible.has(p)).forEach((p, pi) => {
      const ex = after.indexOf(p);
      if (ex >= 0){ pcols.push(ex); return; }
      if (pi === 0 && after[col] === null){ after[col] = p; pcols.push(col); return; }
      let f = after.indexOf(null); if (f < 0){ f = after.length; after.push(null); }
      after[f] = p; pcols.push(f);
    });
    while (after.length && after[after.length - 1] === null) after.pop();
    out.push({ c, col, before, after, pcols });
    lanes = after;
  });
  return out;
}
const LX = (i: number) => 9 + i * 12;
const laneColor = (i: number) => `var(--graph-${(i % 5) + 1})`;
function rowSvg(L: Lane, gw: number, headS: string){
  const H = 26, Mid = 13; let p = '';
  const seg = (x1: number, y1: number, x2: number, y2: number, col: number) => x1 === x2
    ? `<path d="M${x1} ${y1}V${y2}" style="stroke:${laneColor(col)}" stroke-width="1.8" fill="none"/>`
    : `<path d="M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}" style="stroke:${laneColor(col)}" stroke-width="1.8" fill="none"/>`;
  L.before.forEach((s, i) => {
    if (s == null) return;
    p += s === L.c.sha ? seg(LX(i), 0, LX(L.col), Mid, i) : seg(LX(i), 0, LX(i), H, i);
  });
  L.pcols.forEach(pc => { p += seg(LX(L.col), Mid, LX(pc), H, pc); });
  const x = LX(L.col), col = laneColor(L.col);
  if (L.c.sha === headS) p += `<circle cx="${x}" cy="${Mid}" r="5" style="fill:${col};stroke:var(--brand)" stroke-width="2"/>`;
  else if (L.c.parents.length > 1) p += `<circle cx="${x}" cy="${Mid}" r="3.8" style="fill:var(--surface-100);stroke:${col}" stroke-width="2"/>`;
  else p += `<circle cx="${x}" cy="${Mid}" r="3.8" style="fill:${col}"/>`;
  return `<svg width="${gw}" height="${H}" viewBox="0 0 ${gw} ${H}" aria-hidden="true">${p}</svg>`;
}
interface RefChip { name: string; cls: string }
function refsByCommit(): Record<string, RefChip[]> {
  const m: Record<string, RefChip[]> = {};
  const add = (s: string, o: RefChip) => { (m[s] = m[s] || []).push(o); };
  Object.keys(R.branches).forEach(b => add(R.branches[b].tip, { name: b, cls: R.head.branch === b ? 'head' : '' }));
  Object.keys(R.remotes).forEach(k => add(R.remotes[k], { name: k, cls: 'remote' }));
  if (R.showTags) Object.keys(R.tags).forEach(k => add(R.tags[k], { name: k, cls: 'tag' }));
  if (R.head.detached) add(R.head.detached, { name: 'HEAD', cls: 'head' });
  Object.values(m).forEach(a => a.sort((x, y) => Number(y.cls === 'head') - Number(x.cls === 'head')));
  return m;
}
function chipsHtml(refs?: RefChip[]){
  if (!refs || !refs.length) return '';
  const first = refs[0], all = esc(refs.map(r => r.name).join(', '));
  return `<span class="chip ${first.cls}" title="${all}">${first.cls === 'tag' ? svg('tag') : ''}${esc(first.name)}</span>` + (refs.length > 1 ? `<span class="chip more" title="${all}">+${refs.length - 1}</span>` : '');
}
function rowHtml(c: Commit, gcell: string, refs: RefChip[] | undefined, out: boolean, sel: boolean){
  return `<div class="gridrow crow${sel ? ' selected' : ''}" data-sha="${c.sha}" role="row">` +
    `<span class="c-ref">${chipsHtml(refs)}</span><span class="c-graph">${gcell}</span>` +
    `<span class="c-msg">${out ? svg('up', 'out') : ''}<span class="m" title="${esc(firstLine(c.msg))}">${esc(firstLine(c.msg))}</span></span>` +
    `<span class="c-author">${avatar(c.author)}<span class="ell">${esc(c.author)}</span></span>` +
    `<span class="c-date" title="${esc(absDate(c.t))}">${esc(fmtDate(c.t))}</span><span class="c-id">${short(c.sha)}</span></div>`;
}
export function renderGraph(){
  if (!hasRepo()) return;
  const cb = curBranch();
  const followingHead = !R.historyRef && !R.showAll;
  $('#viewRefBtn').innerHTML = esc(R.showAll ? t('gr.all') : (R.historyRef || cb || 'HEAD (' + s7(headSha()) + ')')) + svg('chevDown');
  let sh = '';
  const outSet = followingHead ? outgoingSet() : new Set<string>();
  if (followingHead && cb){
    const inc = incomingList();
    sh += `<div class="gsec${R.incOpen ? ' open' : ''}"><button class="tog" data-inc aria-expanded="${R.incOpen}">${svg('chev', 'chev')}<span>${esc(t('gr.incoming', { n: inc.length }))}</span></button><span class="sp"></span><button class="link sync-op" data-act="fetch">Fetch</button><span class="sep-dot">|</span><button class="link sync-op" data-act="pull">Pull</button></div>`;
    if (R.incOpen) sh += inc.length ? `<div class="inc-list">${inc.map(c => rowHtml(c, '', undefined, false, R.selected === c.sha)).join('')}</div>` : `<div class="inc-empty">${esc(t('gr.noIncoming'))}</div>`;
    sh += `<div class="gsec"><strong>${esc(t('gr.localHistory', { n: outSet.size }))}</strong><span class="sp"></span><button class="link sync-op" data-act="push">Push</button><span class="sep-dot">|</span><button class="link sync-op" data-act="sync">Sync</button></div>`;
  } else sh += `<div class="gsec"><strong>${esc(t('gr.history'))}</strong></div>`;
  $('#syncSections').innerHTML = sh;

  const set = new Set<string>();
  viewTips().forEach(s => {
    const st = [s];
    while (st.length){ const x = st.pop()!; if (set.has(x) || !R.commits[x]) continue; set.add(x); st.push(...R.commits[x].parents); }
  });
  let rows = [...set].map(x => R.commits[x]).sort(byHistory);
  const qRaw = ($('#historyFilter') as HTMLInputElement).value.trim(), q = qRaw.toLowerCase();
  const refs = refsByCommit();
  const body = $('#graphBody'), st = body.scrollTop;
  if (q){
    rows = rows.filter(c => (c.msg + ' ' + c.author + ' ' + c.sha + ' ' + (refs[c.sha] || []).map(r => r.name).join(' ')).toLowerCase().includes(q));
    body.style.setProperty('--gw', '40px'); $('#thead').style.setProperty('--gw', '40px');
    body.innerHTML = rows.length ? rows.map(c => rowHtml(c, '', refs[c.sha], outSet.has(c.sha), R.selected === c.sha)).join('') : `<div class="g-empty">${esc(t('gr.noResults', { q: qRaw }))}</div>`;
  } else {
    const lay = layout(rows, set);
    const maxCols = Math.min(24, lay.reduce((m, l) => Math.max(m, l.before.length, l.after.length, l.col + 1), 1));
    const gw = Math.max(40, LX(maxCols - 1) + 10);
    body.style.setProperty('--gw', gw + 'px'); $('#thead').style.setProperty('--gw', gw + 'px');
    const hs = headSha();
    body.innerHTML = lay.map(l => rowHtml(l.c, rowSvg(l, gw, hs), refs[l.c.sha], outSet.has(l.c.sha), R.selected === l.c.sha)).join('') +
      (R.truncated ? `<div class="g-empty">${esc(t('n.truncated'))}</div>` : '') +
      (!rows.length ? `<div class="g-empty">—</div>` : '');
  }
  body.scrollTop = st;
}

// ---------- commit detail ----------
export function filesFor(sha: string): FileChange[] | null {
  const c = R.commits[sha];
  if (c?.files) return c.files;
  const cached = R.filesCache.get(sha);
  if (cached) return cached;
  const path = P();
  B().commitFiles(path, sha).then(f => {
    if (!hasRepo() || R.path !== path) return;
    R.filesCache.set(sha, f);
    if (R.selected === sha) renderDetail();
  }).catch(() => { R.filesCache.set(sha, []); });
  return null;
}
export function renderDetail(){
  const el = $('#detail'), c = R.selected ? R.commits[R.selected] : null;
  if (!c){ el.hidden = true; return; }
  const files = filesFor(c.sha), rest = c.msg.split('\n').slice(1).join('\n').trim();
  el.hidden = false;
  el.innerHTML = `<div class="detail-h"><strong>${esc(firstLine(c.msg))}</strong><button class="icon-btn" data-dact="copy" title="${esc(t('cc.copyId'))}">${svg('copy')}</button><button class="icon-btn" data-dact="menu" data-keepmenu title="${esc(t('dk.more'))}">${svg('dots')}</button><button class="icon-btn" data-dact="close" title="${esc(t('dl.close'))}">${svg('x')}</button></div>` +
    `<div class="detail-meta">${avatar(c.author)}<span>${esc(c.author)}${c.email ? ` &lt;${esc(c.email)}&gt;` : ''}</span><span>${esc(absDate(c.t))}</span><span class="mono">${esc(c.sha)}</span>` +
    (c.parents.length ? `<span>${esc(t('dt.parents'))}: ${c.parents.map(p => `<button class="link mono" data-goto="${p}">${short(p)}</button>`).join(' ')}</span>` : '') + `</div>` +
    (rest ? `<pre class="detail-body">${esc(rest)}</pre>` : '') +
    (files == null ? `<div class="hint">${esc(t('st.loading'))}</div>` :
      `<div class="sub-h">${esc(t('dt.files', { n: files.length }))}</div>` +
      (files.length ? files.map(f => fileRowHtml(f, 'commit')).join('') : `<div class="cempty" style="padding-left:0">${esc(t('dt.merge'))}</div>`));
}
export function fileRowHtml(f: { st: string; path: string; from?: string | null }, ctx: 'staged' | 'work' | 'commit'){
  const name = f.st === 'R' && f.from ? `${baseOf(f.from)} → ${baseOf(f.path)}` : baseOf(f.path);
  let acts = '';
  if (ctx === 'staged') acts = `<button class="icon-btn" data-fact="diff" title="${esc(t('dk.open'))}">${svg('diff')}</button><button class="icon-btn" data-fact="unstage" title="${esc(t('dk.unstage'))}">${svg('minus')}</button>`;
  else if (ctx === 'work') acts = `<button class="icon-btn" data-fact="diff" title="${esc(t('dk.open'))}">${svg('diff')}</button><button class="icon-btn" data-fact="discard" title="${esc(t('dk.discard'))}">${svg('undo')}</button><button class="icon-btn" data-fact="stage" title="${esc(t('dk.stage'))}">${svg('plus')}</button>`;
  return `<div class="frow${ctx === 'commit' ? ' flat' : ''}" data-path="${esc(f.path)}" data-ctx="${ctx}" title="${esc(f.path)}"><span class="sg ${f.st}">${f.st}</span><span class="fname ${f.st}"><span class="n1">${esc(name)}</span><span class="n2">${esc(dirOf(f.path))}</span></span><span class="ractions">${acts}</span></div>`;
}

// ---------- Git Changes dock ----------
export function renderDock(){
  if (!hasRepo()) return;
  const cb = curBranch();
  $('#dockTitle').textContent = t('dk.title', { r: R.name });
  $('#branchSelectLabel').textContent = cb || t('dk.detached', { sha: s7(headSha()) });
  const tr = cb ? tracking(cb) : null;
  const o = cb ? outgoingSet().size : 0, i = tr ? tr.behind : 0;
  $('#dockCounts').innerHTML = `${svg('updown')}<span>${o} / ${i}</span>`;
  $('#dockCounts').title = t('dk.counts', { o, i });
  let nh = '';
  if (R.inProgress){
    const abortAct = R.inProgress === 'cherry-pick' ? 'cherryAbort' : R.inProgress + 'Abort';
    nh += `<div class="notice warn">${svg('warn')}<span class="txt">${esc(t('n.inProgress', { op: R.inProgress }))}<span class="acts"><button class="link" data-nrun="${abortAct}">${esc(t('act.' + abortAct))}</button></span></span></div>`;
  }
  const n = R.notice;
  if (n) nh += `<div class="notice ${n.kind}">${svg(n.kind === 'ok' ? 'ok' : n.kind === 'warn' ? 'warn' : n.kind === 'error' ? 'error' : 'info')}<span class="txt">${esc(t(n.key, n.vars))}${n.actions.length ? `<span class="acts">${n.actions.map(a => `<button class="link" data-nrun="${a}">${esc(t('act.' + a))}</button>`).join('')}</span>` : ''}</span><button class="icon-btn" data-nclose title="${esc(t('dl.close'))}">${svg('x')}</button></div>`;
  $('#notice').innerHTML = nh;
  const staged = R.work.filter(f => f.staged), unstaged = R.work.filter(f => !f.staged);
  $('#commitBtn').textContent = staged.length ? t('dk.commitStaged') : t('dk.commitAll');
  const amend = ($('#amendCb') as HTMLInputElement).checked;
  ($('#commitBtn') as HTMLButtonElement).disabled = !!busy || !($('#commitMsg') as HTMLTextAreaElement).value.trim() || (!R.work.length && !amend);
  const sec = (key: string, label: string, count: number | null, tools = '') => { const open = !R.dockClosed.has(key); return `<div class="csec-h${open ? ' open' : ''}"><button class="tog" data-dsec="${key}" aria-expanded="${open}">${svg('chev', 'chev')}<span>${esc(label)}</span>${count != null ? `<span class="n">(${count})</span>` : ''}</button>${tools}</div>`; };
  let h = '';
  h += sec('rel', t('dk.related'), R.related.length || null);
  if (!R.dockClosed.has('rel')) h += R.related.length ? R.related.map(id => `<div class="relrow"><span class="id">#${id}</span><span class="lbl">${esc(ISSUES.find(x => x.id === id)?.title || '')}</span><button class="icon-btn" data-unrel="${id}" title="${esc(t('dk.removeLink'))}">${svg('x')}</button></div>`).join('') : `<div class="cempty">${esc(t('dk.noRelated'))}</div>`;
  if (staged.length){
    h += sec('staged', t('dk.staged'), staged.length, `<button class="icon-btn" data-dtool="unstageAll" title="${esc(t('dk.unstageAll'))}">${svg('minus')}</button>`);
    if (!R.dockClosed.has('staged')) h += staged.map(f => fileRowHtml(f, 'staged')).join('');
  }
  h += sec('changes', t('dk.changes'), unstaged.length, `<button class="icon-btn" data-dtool="discardAll" title="${esc(t('dk.discardAll'))}" ${unstaged.length ? '' : 'disabled'}>${svg('undo')}</button><button class="icon-btn" data-dtool="stageAll" title="${esc(t('dk.stageAll'))}" ${unstaged.length ? '' : 'disabled'}>${svg('plus')}</button>`);
  if (!R.dockClosed.has('changes')) h += unstaged.length ? unstaged.map(f => fileRowHtml(f, 'work')).join('') : `<div class="cempty">${esc(t('dk.noChanges'))}${isDemo() ? `<br><button class="link" data-dtool="simEdit">${esc(t('dk.simEdit'))}</button>` : ''}</div>`;
  h += sec('stash', t('dk.stashes'), R.stashes.length || null);
  if (!R.dockClosed.has('stash')) h += R.stashes.length ? R.stashes.map(s => `<div class="frow stash" data-stash="${esc(s.id)}" title="${esc(s.msg)}">${svg('stash')}<span class="fname"><span class="n1">${esc(s.id)}</span><span class="n2">${esc(s.msg)}</span></span><span class="ractions"><button class="icon-btn" data-sact="apply" title="${esc(t('dk.apply'))}">${svg('check')}</button><button class="icon-btn" data-sact="pop" title="${esc(t('dk.pop'))}">${svg('up')}</button><button class="icon-btn" data-sact="drop" title="${esc(t('dk.drop'))}">${svg('trash')}</button></span></div>`).join('') : `<div class="cempty">${esc(t('dk.noStashes'))}</div>`;
  const cs = $('#changesScroll'), st = cs.scrollTop; cs.innerHTML = h; cs.scrollTop = st;
}
/** Work items for the # picker. Replace with your tracker (GitHub Issues, Jira…). */
export const ISSUES = [
  { id: 58, title: 'Token expiry is not refreshed after sleep' },
  { id: 61, title: 'OAuth login flow' },
  { id: 64, title: 'Rate-limit fetches against origin' },
  { id: 66, title: 'Sidebar filter loses focus on refresh' },
  { id: 71, title: 'Spanish translation for the UI' }
];

// ---------- status bar & output ----------
export function renderStatus(){
  $('#sbState').innerHTML = busy ? `<span class="spinner"></span><span>${esc(t(busy))}</span>` : `<span>${esc(t('st.ready'))}</span>`;
  const demo = $('#sbDemo'); demo.hidden = !(hasRepo() && isDemo()); demo.textContent = t('mode.demo'); demo.title = t('mode.demoTip');
  ['#sbSync', '#sbChanges', '#sbBranch', '#sbRepo'].forEach(s => { $(s).hidden = !hasRepo(); });
  if (!hasRepo()) return;
  const cb = curBranch(), tr = cb ? tracking(cb) : null;
  const o = cb ? outgoingSet().size : 0, i = tr ? tr.behind : 0;
  $('#sbSync').innerHTML = `${svg('updown')}<span>${o} / ${i}</span>`; $('#sbSync').title = t('st.syncTip', { o, i });
  $('#sbChanges').innerHTML = `${svg('pencil')}<span>${R.work.length}</span>`; $('#sbChanges').title = t('st.changes', { n: R.work.length });
  $('#sbBranch').innerHTML = `${svg('branch')}<span>${esc(cb || s7(headSha()))}</span>`; $('#sbBranch').title = t('st.branchTip');
  $('#sbRepo').innerHTML = `${svg('repo')}<span>${esc(R.name)}</span>`; $('#sbRepo').title = R.path;
}
export function renderOutput(){
  const ch = ($('#outChannel') as HTMLSelectElement).value || 'git', body = $('#outBody');
  const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 30;
  body.innerHTML = OUT.filter(l => l.ch === ch).map(l => `<div class="ol ${l.kind}">${l.kind === 'cmd' ? `<span class="ts">[${l.tm.toLocaleTimeString(locale(), { hour12: false })}]</span> ${ch === 'git' ? '&gt; ' : ''}` : '    '}${esc(l.text)}</div>`).join('');
  if (atBottom) body.scrollTop = body.scrollHeight;
}
