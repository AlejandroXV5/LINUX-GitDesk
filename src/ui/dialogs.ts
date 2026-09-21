// Dialogs: branch/tag creation, delete, compare, pull requests, worktrees,
// submodules, open/clone/new repository, diff viewer, stash, options, help.
import { inTauri, pickFolder } from '../backend/tauri';
import { GitHub, type GhRepo } from '../backend/github';
import { svg } from '../core/icons';
import { R, absDate, ancestors, curBranch, hasRepo, headSha, onlyIn, refKind, resolve, type FileChange, type WorkFile } from '../core/model';
import { S, saveSettings, t, w } from '../core/settings';
import { $, $$, esc, firstLine, s7 } from '../core/util';
import { account } from './account';
import { appLog, dialog, toast, type DialogApi } from './core';
import { fileRowHtml, renderAll, renderSidebar } from './render';
import { B, DEMO, P, doOp, isDemo, loadPrs, openRepo } from './session';
import { VERSION } from '../version';

const field = (label: string, inner: string) => `<label class="field"><span>${esc(label)}</span>${inner}</label>`;
const check = (id: string, label: string, on: boolean) => `<label class="cb"><input type="checkbox" id="${id}"${on ? ' checked' : ''}><span class="box">${svg('check')}</span><span>${esc(label)}</span></label>`;
const refLabel = (ref: string) => (R.commits[ref] && !R.branches[ref] ? s7(ref) + ' — ' + firstLine(R.commits[ref].msg) : ref);
/** Branch/tag names: what `git check-ref-format --branch` would accept, minus the rare cases. */
export const validName = (n: string, taken: Record<string, unknown>) =>
  /^[A-Za-z0-9._/-]+$/.test(n) && !/^[/.-]|\/$|\.\.|\/\/|\.lock$|@\{/.test(n) && !(n in taken);

export function dlgNewBranch(from?: string | null){
  const base = from || curBranch() || headSha();
  const opts = Object.keys(R.branches).concat(Object.keys(R.remotes));
  const sel = R.commits[base] && !opts.includes(base) ? [base].concat(opts) : opts;
  dialog({
    title: t('dl.newBranch'),
    body: field(t('dl.branchName'), `<input class="inp" id="nbName" placeholder="feature/my-change" autocomplete="off" spellcheck="false">`) +
      field(t('dl.basedOn'), `<select class="inp" id="nbBase">${sel.map(r => `<option value="${esc(r)}"${r === base ? ' selected' : ''}>${esc(refLabel(r))}</option>`).join('')}</select>`) +
      check('nbCo', t('dl.checkoutBranch'), true) + `<div class="hint" id="nbHint"></div>`,
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const n = d.$('#nbName').value.trim();
      if (!validName(n, R.branches)){ d.$('#nbName').classList.add('invalid'); const h = d.$<HTMLElement>('#nbHint'); h.textContent = t('dl.invalidName'); h.className = 'hint err'; d.$('#nbName').focus(); return false; }
      const fromRef = d.$<HTMLSelectElement>('#nbBase').value, co = d.$('#nbCo').checked;
      doOp('st.working', () => B().createBranch(P(), n, fromRef, co));
    } }],
    onMount: d => d.$('#nbName').addEventListener('input', e => { const i = e.target as HTMLInputElement; i.value = i.value.replace(/\s+/g, '-'); i.classList.remove('invalid'); d.$<HTMLElement>('#nbHint').textContent = ''; })
  });
}
export function dlgNewTag(sha: string){
  dialog({
    title: t('dl.newTag'),
    body: field(t('dl.tagName'), `<input class="inp" id="tgName" placeholder="v1.0.0" autocomplete="off" spellcheck="false">`) + field(t('dl.tagMsg'), `<input class="inp" id="tgMsg" autocomplete="off">`) +
      `<div class="hint">${esc(t('dl.tagAt'))}: <span class="mono">${s7(sha)}</span> ${esc(firstLine(R.commits[sha].msg))}</div><div class="hint err" id="tgHint"></div>`,
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const n = d.$('#tgName').value.trim();
      if (!validName(n, R.tags)){ d.$('#tgName').classList.add('invalid'); d.$<HTMLElement>('#tgHint').textContent = t('dl.invalidName'); return false; }
      const msg = d.$('#tgMsg').value.trim();
      doOp('st.working', () => B().tag(P(), n, sha, msg));
    } }]
  });
}
function unmergedCount(ref: string){
  const tip = resolve(ref), others = new Set<string>();
  Object.keys(R.branches).forEach(b => { if (b !== ref) ancestors(R.branches[b].tip).forEach(x => others.add(x)); });
  Object.keys(R.remotes).forEach(k => ancestors(R.remotes[k]).forEach(x => others.add(x)));
  return [...ancestors(tip)].filter(x => !others.has(x)).length;
}
export function dlgDelete(ref: string){
  const kind = refKind(ref);
  if (kind === 'local' && ref === curBranch()){ toast(t('n.cantCurrent')); return; }
  const un = kind === 'local' ? unmergedCount(ref) : 0;
  const doIt = (force: boolean) => { if (R.selRef === ref) R.selRef = null; doOp('st.working', () => B().deleteRef(P(), ref, kind, force)); };
  if (!S.confirmDelete && !un){ doIt(false); return; }
  const title = t(kind === 'remote' ? 'dl.deleteRemote' : kind === 'tag' ? 'dl.deleteTag' : 'dl.deleteBranch', { b: ref });
  let body = `<p style="margin:0">${esc(kind === 'remote' ? t('dl.deleteRemoteBody') : kind === 'local' ? t('dl.deleteBody') : '')}</p>`;
  if (un) body += `<div class="warnbox">${svg('warn')}<span>${esc(t('dl.unmerged', { b: ref, n: un, c: w(un, 'commit', 'commits') }))}</span></div>`;
  dialog({ title, body, actions: [{ label: t('dl.cancel') }, { label: un ? t('dl.deleteForce') : t('dl.delete'), danger: true, fn: () => doIt(!!un) }] });
}
export async function dlgCompare(a: string, b: string){
  const A = resolve(a), Bs = resolve(b);
  const onlyA = onlyIn(A, Bs), onlyB = onlyIn(Bs, A);
  const bl = R.commits[b] && !R.branches[b] ? s7(b) : b;
  const list = (cs: typeof onlyA) => cs.length ? cs.map(c => `<div class="r"><span class="mono">${s7(c.sha)}</span><span class="m">${esc(firstLine(c.msg))}</span></div>`).join('') : `<div class="hint">—</div>`;
  const d = dialog({
    title: t('dl.compare', { a, b: bl }), wide: true,
    body: (!onlyA.length && !onlyB.length) ? `<p style="margin:0">${esc(t('n.nothingToCompare'))}</p>` :
      `<div class="cmp-cols"><div><div class="sub-h">${esc(t('dl.onlyIn', { a, n: onlyA.length }))}</div><div class="cmp-list">${list(onlyA)}</div></div><div><div class="sub-h">${esc(t('dl.onlyIn', { a: bl, n: onlyB.length }))}</div><div class="cmp-list">${list(onlyB)}</div></div></div>` +
      `<div class="sub-h" id="cmpFilesH">${esc(t('dl.filesChanged'))}</div><div id="cmpFiles"><div class="hint">${esc(t('st.loading'))}</div></div>`,
    actions: [{ label: t('dl.close'), primary: true }]
  });
  if (!onlyA.length && !onlyB.length) return;
  const files = await B().compareFiles(P(), a, b);
  const box = d.$<HTMLElement>('#cmpFiles'); if (!box) return;
  d.$<HTMLElement>('#cmpFilesH').textContent = `${t('dl.filesChanged')} (${files.length})`;
  box.innerHTML = files.map(f => fileRowHtml(f, 'commit')).join('');
  box.addEventListener('click', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.frow'); if (r) dlgDiff(files.find(x => x.path === r.dataset.path)!, `cmp:${a}..${b}`); });
}
export function dlgNewPR(source: string){
  const names = [...new Set(Object.keys(R.remotes).map(r => r.slice(r.indexOf('/') + 1)).concat(Object.keys(R.branches)))].sort();
  const target = names.includes(S.defaultBranch) ? S.defaultBranch : names.includes('main') ? 'main' : names[0];
  const tip = resolve(source) || resolve('origin/' + source);
  dialog({
    title: t('dl.newPR'), wide: true,
    body: `<div class="cmp-cols">${field(t('dl.source'), `<select class="inp" id="prSrc">${names.map(b => `<option${b === source ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`)}${field(t('dl.target'), `<select class="inp" id="prTgt">${names.map(b => `<option${b === target && b !== source ? ' selected' : ''}>${esc(b)}</option>`).join('')}</select>`)}</div>` +
      field(t('dl.title'), `<input class="inp" id="prTitle" value="${esc(tip ? firstLine(R.commits[tip]?.msg || '') : '')}">`) +
      field(t('dl.description'), `<textarea class="inp" id="prDesc" rows="4"></textarea>`) + check('prDraft', t('dl.draft'), false),
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const s = d.$<HTMLSelectElement>('#prSrc').value, tg = d.$<HTMLSelectElement>('#prTgt').value, title = d.$('#prTitle').value.trim();
      if (!title || s === tg){ d.$(s === tg ? '#prTgt' : '#prTitle').classList.add('invalid'); return false; }
      const body = d.$<HTMLTextAreaElement>('#prDesc').value.trim(), draft = d.$('#prDraft').checked;
      doOp('st.pushing', async () => {
        const br = R.branches[s];
        if (br && (!br.upstream || (br.ahead ?? 0) > 0)){ const p = await B().push(P(), s); if (!p.ok) return p; }
        return B().prCreate(P(), s, tg, title, body, draft);
      }, () => { R.secClosed.delete('pr'); loadPrs(); });
    } }]
  });
}
export function dlgPR(id: number){
  const p = R.prs.find(x => x.id === id); if (!p) return;
  const live = p.status === 'open' || p.status === 'draft';
  const src = resolve('origin/' + p.source) || resolve(p.source), tgt = resolve('origin/' + p.target) || resolve(p.target);
  const ahead = src && tgt ? onlyIn(src, tgt) : [];
  dialog({
    title: t('dl.pr', { n: p.id }) + ' — ' + p.title, wide: true,
    body: `<div class="detail-meta"><span class="st-badge st-${p.status}">${esc(t('pr.' + p.status))}</span><span>${esc(t('pr.into', { s: p.source, t: p.target }))}</span>${p.t ? `<span>${esc(absDate(p.t))}</span>` : ''}</div>` +
      (p.desc ? `<p class="pre">${esc(p.desc)}</p>` : '') +
      `<div class="sub-h">${ahead.length} ${esc(w(ahead.length, 'commit', 'commits'))}</div><div class="cmp-list">${ahead.map(c => `<div class="r"><span class="mono">${s7(c.sha)}</span><span class="m">${esc(firstLine(c.msg))}</span></div>`).join('')}</div>`,
    actions: [
      { label: t('dl.checkoutSource'), fn: () => { const ref = R.branches[p.source] ? p.source : 'origin/' + p.source; doOp('st.working', () => B().checkout(P(), ref, refKind(ref))); } },
      ...(live ? [
        { label: t('dl.abandon'), danger: true, fn: () => { doOp('st.working', () => B().prMerge(P(), p.id, true), () => loadPrs()); } },
        { label: t('dl.complete'), primary: true, fn: () => { doOp('st.working', () => B().prMerge(P(), p.id, false), () => loadPrs()); } }
      ] : [{ label: t('dl.close'), primary: true }])
    ]
  });
}
export function dlgWorktree(ref: string){
  const nm = ref.replace(/^[^/]+\//, m => (R.remotes[ref] ? '' : m)).replace(/\//g, '-') + '-wt';
  const parent = isDemo() ? '..' : R.path.slice(0, R.path.lastIndexOf('/'));
  dialog({
    title: t('dl.worktree'),
    body: field(t('dl.path'), `<input class="inp mono" id="wtPath" value="${esc(parent + '/' + R.name + '-' + nm)}">`) + field(t('dl.newBranchName'), `<input class="inp" id="wtBranch" value="${esc(nm)}">`) + `<div class="hint">${esc(t('dl.basedOn'))}: ${esc(ref)}</div>`,
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const p = d.$('#wtPath').value.trim(), b = d.$('#wtBranch').value.trim();
      if (!p || !validName(b, R.branches)){ d.$('#wtBranch').classList.add('invalid'); return false; }
      doOp('st.working', () => B().worktreeAdd(P(), p, b, ref));
    } }]
  });
}
export function dlgSubmodule(){
  dialog({
    title: t('dl.submodule'),
    body: field(t('dl.url'), `<input class="inp mono" id="smUrl" placeholder="https://github.com/org/icons.git">`) + field(t('dl.path'), `<input class="inp mono" id="smPath" placeholder="vendor/icons">`),
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const u = d.$('#smUrl').value.trim(); let p = d.$('#smPath').value.trim();
      if (!u){ d.$('#smUrl').classList.add('invalid'); return false; }
      if (!p) p = 'vendor/' + (u.replace(/\.git$/, '').split('/').pop() || 'module');
      R.secClosed.delete('sub');
      doOp('st.working', () => B().submoduleAdd(P(), u, p));
    } }]
  });
}

// ---------- open / clone / new repository ----------
export async function dlgOpenRepo(){
  if (!inTauri()){ openRepo(DEMO); return; }
  const dir = await pickFolder(t('dl.pickRepo'));
  if (dir) openRepo(dir);
}
function folderField(id: string, value: string){
  return `<div class="row-inp"><input class="inp mono" id="${id}" value="${esc(value)}">${inTauri() ? `<button class="btn btn-secondary" data-browse="${id}">${esc(t('dl.browse'))}</button>` : ''}</div>`;
}
function wireBrowse(d: DialogApi){
  d.el.addEventListener('click', async e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-browse]'); if (!b) return;
    const dir = await pickFolder(t('dl.pickParent'));
    if (dir) d.$(`#${b.dataset.browse}`).value = dir;
  });
}
const defaultParent = () => (hasRepo() && !isDemo() ? R.path.slice(0, R.path.lastIndexOf('/')) : '~/src');
const repoRowHtml = (r: GhRepo, selected: boolean) =>
  `<div class="wl-row gh-repo" data-repo="${esc(r.fullName)}" tabindex="0" aria-selected="${selected}">${svg('repo')}<span class="n">${esc(r.name)}</span><span class="p">${esc(r.description || r.fullName)}</span>${r.private ? `<span class="st-badge st-draft">${esc(t('dl.private'))}</span>` : ''}</div>`;

/** Clone a repository: pick one from the signed-in GitHub account, or paste a URL. */
export function dlgClone(){
  const canGitHub = !!account;
  let tab: 'gh' | 'url' = canGitHub ? 'gh' : 'url';
  let repos: GhRepo[] = [];
  let selected: GhRepo | null = null;

  const tabsHtml = canGitHub
    ? `<div class="seg" id="clTabs" role="group"><button type="button" data-v="gh" aria-pressed="true">${esc(t('dl.tabGithub'))}</button><button type="button" data-v="url" aria-pressed="false">${esc(t('dl.tabUrl'))}</button></div>`
    : '';
  const ghPanel = `<div data-clpanel="gh"${canGitHub ? '' : ' hidden'}>
    <input class="inp" id="clSearch" placeholder="${esc(t('dl.searchRepos'))}" spellcheck="false" autocomplete="off">
    <div class="gh-repos" id="clRepos"><div class="hint">${esc(t('st.loading'))}</div></div>
  </div>`;
  const urlPanel = `<div data-clpanel="url"${canGitHub ? ' hidden' : ''}>
    ${field(t('dl.url'), `<input class="inp mono" id="clUrl" placeholder="https://github.com/org/project.git" spellcheck="false">`)}
  </div>`;

  dialog({
    title: t('dl.clone'), wide: canGitHub,
    body: tabsHtml + ghPanel + urlPanel + field(t('dl.parent'), folderField('clParent', defaultParent())),
    actions: [{ label: t('dl.cancel') }, { label: t('dl.cloneBtn'), primary: true, fn: d => {
      const parent = d.$('#clParent').value.trim().replace(/\/$/, '');
      const be = inTauri() ? B('/') : B(DEMO);
      if (canGitHub && tab === 'gh'){
        if (!selected){ d.$<HTMLElement>('#clRepos').classList.add('invalid'); return false; }
        runCreate(() => be.clone(selected!.cloneUrl, parent + '/' + selected!.name));
        return;
      }
      const u = d.$('#clUrl').value.trim();
      const name = (u.replace(/\.git$/, '').split(/[/:]/).pop() || '').replace(/[^\w.-]/g, '');
      if (!name){ d.$('#clUrl').classList.add('invalid'); return false; }
      const dest = parent + '/' + name;
      runCreate(() => be.clone(u, dest));
    } }],
    onMount: d => {
      wireBrowse(d);
      if (!canGitHub) return;
      const listEl = d.$<HTMLElement>('#clRepos');
      const renderList = (filter: string) => {
        const q = filter.trim().toLowerCase();
        const shown = q ? repos.filter(r => r.name.toLowerCase().includes(q) || r.fullName.toLowerCase().includes(q)) : repos;
        listEl.classList.remove('invalid');
        listEl.innerHTML = shown.length
          ? shown.map(r => repoRowHtml(r, r === selected)).join('')
          : `<div class="hint">${esc(q ? t('dl.noRepoMatch', { q: filter }) : t('dl.noRepos'))}</div>`;
      };
      GitHub.repos().then(r => {
        repos = r; selected = repos[0] || null;
        renderList(d.$<HTMLInputElement>('#clSearch').value);
      }).catch(e => { listEl.innerHTML = `<div class="hint err">${esc(String((e as Error)?.message ?? e))}</div>`; });
      d.$('#clSearch').addEventListener('input', e => renderList((e.target as HTMLInputElement).value));
      listEl.addEventListener('click', e => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('.gh-repo'); if (!row) return;
        selected = repos.find(r => r.fullName === row.dataset.repo) || null;
        listEl.classList.remove('invalid');
        d.$$('.gh-repo').forEach(x => x.setAttribute('aria-selected', String(x === row)));
      });
      d.$<HTMLElement>('#clTabs').addEventListener('click', e => {
        const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-v]'); if (!b) return;
        tab = b.dataset.v as 'gh' | 'url';
        d.$$('#clTabs button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        d.$$('[data-clpanel]').forEach(p => { p.hidden = p.dataset.clpanel !== tab; });
      });
    }
  });
}
export function dlgNewRepo(){
  dialog({
    title: t('dl.newRepo'),
    body: field(t('dl.repoName'), `<input class="inp" id="nrName" placeholder="my-project" spellcheck="false">`) + field(t('dl.parent'), folderField('nrParent', defaultParent())) + check('nrReadme', t('dl.initReadme'), true),
    actions: [{ label: t('dl.cancel') }, { label: t('dl.create'), primary: true, fn: d => {
      const n = d.$('#nrName').value.trim();
      if (!/^[A-Za-z0-9._-]+$/.test(n)){ d.$('#nrName').classList.add('invalid'); return false; }
      const dest = d.$('#nrParent').value.trim().replace(/\/$/, '') + '/' + n, readme = d.$('#nrReadme').checked;
      const be = inTauri() ? B('/') : B(DEMO);
      runCreate(() => be.init(dest, S.defaultBranch || 'main', readme));
    } }],
    onMount: wireBrowse
  });
}
async function runCreate(fn: () => Promise<{ path: string; result: import('../core/model').OpResult }>){
  try {
    const { path, result } = await fn();
    if (result.ok && path) await openRepo(path, result);
    else { result.log.forEach(e => appLog(e.cmd)); toast(result.notice ? t(result.notice.key, result.notice.vars) : 'git failed'); }
  } catch (e){ toast(String((e as Error)?.message ?? e)); }
}

// ---------- diff viewer ----------
interface DiffRow { k: string; o: number | ''; n: number | ''; t: string }
/** Parse a unified diff into rows with old/new line numbers. */
export function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []; let o = 0, n = 0;
  for (const line of text.split('\n')){
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
    if (/^(new file|deleted file|rename |similarity|old mode|new mode|Binary)/.test(line)){ rows.push({ k: 'meta', o: '', n: '', t: line }); continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h){ o = +h[1]; n = +h[2]; rows.push({ k: 'hunk', o: '', n: '', t: line }); continue; }
    if (line.startsWith('+')) rows.push({ k: 'add', o: '', n: n++, t: line });
    else if (line.startsWith('-')) rows.push({ k: 'del', o: o++, n: '', t: line });
    else if (line.startsWith(' ')) rows.push({ k: '', o: o++, n: n++, t: line });
    else if (line.startsWith('\\')) rows.push({ k: 'meta', o: '', n: '', t: line });
  }
  return rows;
}
export async function dlgDiff(f: FileChange | WorkFile, ctx: string){
  const inWork = R.work.find(x => x.path === f.path && (ctx === 'staged' ? x.staged : !x.staged));
  const untracked = ctx === 'work' && f.st === 'A';
  const sub = ctx === 'work' ? t('dl.diffWork') : ctx === 'staged' ? t('dk.staged') : R.commits[ctx] ? t('dl.diffCommit', { sha: s7(ctx) }) : ctx.replace(/^(cmp|stash):/, '');
  const d = dialog({
    title: f.path, wide: true,
    body: `<div class="diff-stat"><span class="hint">${esc(sub)}</span><span class="a" id="dfA"></span><span class="d" id="dfD"></span></div><div class="diff" id="dfBody"><div class="hint" style="padding:8px">${esc(t('st.loading'))}</div></div>`,
    actions: inWork && (ctx === 'work' || ctx === 'staged') ? [
      ...(ctx === 'work' ? [{ label: t('dk.discard'), danger: true, fn: () => { doOp('st.working', () => B().discard(P(), [f.path])); } }] : []),
      ctx === 'staged'
        ? { label: t('dk.unstage'), primary: true, fn: () => { doOp('st.working', () => B().unstage(P(), [f.path])); } }
        : { label: t('dk.stage'), primary: true, fn: () => { doOp('st.working', () => B().stage(P(), [f.path])); } }
    ] : [{ label: t('dl.close'), primary: true }]
  });
  const text = await B().diff(P(), f.path, ctx, untracked);
  const rows = parseDiff(text);
  const box = d.$<HTMLElement>('#dfBody'); if (!box) return;
  d.$<HTMLElement>('#dfA').textContent = '+' + rows.filter(r => r.k === 'add').length;
  d.$<HTMLElement>('#dfD').textContent = '−' + rows.filter(r => r.k === 'del').length;
  box.innerHTML = rows.length ? `<table>${rows.map(r => `<tr class="${r.k}"><td class="ln">${r.o}</td><td class="ln">${r.n}</td><td>${esc(r.t)}</td></tr>`).join('')}</table>` : `<div class="hint" style="padding:8px">—</div>`;
}
export async function dlgStash(id: string){
  const s = R.stashes.find(x => x.id === id); if (!s) return;
  const d = dialog({
    title: s.id, wide: true,
    body: `<div class="hint">${esc(s.msg)} · ${esc(absDate(s.t))}</div><div id="stFiles"><div class="hint">${esc(t('st.loading'))}</div></div>`,
    actions: [
      { label: t('dk.drop'), danger: true, fn: () => { doOp('st.working', () => B().stashDrop(P(), id)); } },
      { label: t('dk.apply'), fn: () => { doOp('st.working', () => B().stashApply(P(), id, false)); } },
      { label: t('dk.pop'), primary: true, fn: () => { doOp('st.working', () => B().stashApply(P(), id, true)); } }
    ]
  });
  const files = await B().stashFiles(P(), id);
  const box = d.$<HTMLElement>('#stFiles'); if (!box) return;
  box.innerHTML = files.map(f => fileRowHtml(f, 'commit')).join('');
  box.addEventListener('click', e => { const r = (e.target as HTMLElement).closest<HTMLElement>('.frow'); if (r) dlgDiff(files.find(x => x.path === r.dataset.path)!, 'stash:' + id); });
}

// ---------- options ----------
export function dlgOptions(tab?: string){
  const seg = (id: string, val: string, opts: [string, string][]) => `<div class="seg" id="${id}" role="group">${opts.map(o => `<button type="button" data-v="${o[0]}" aria-pressed="${o[0] === val}">${esc(o[1])}</button>`).join('')}</div>`;
  const body = `<div class="opt-wrap"><div class="opt-nav" role="tablist">${['general', 'git', 'keyboard'].map(k => `<button role="tab" data-tab="${k}" aria-selected="${(tab || 'general') === k}">${esc(t('op.' + k))}</button>`).join('')}</div><div>` +
    `<div class="opt-panel" data-panel="general">` +
      field(t('op.language'), seg('opLang', S.lang, [['es', 'Español'], ['en', 'English']])) + `<div class="hint">${esc(t('op.langNote'))}</div>` +
      field(t('op.theme'), seg('opTheme', S.theme, [['auto', t('th.auto')], ['light', t('th.light')], ['dark', t('th.dark')]])) +
      field(t('op.dateFmt'), seg('opDate', S.dateFmt, [['relative', t('op.relative')], ['absolute', t('op.absolute')]])) +
      check('opAvatars', t('op.avatars'), S.avatars) + `</div>` +
    `<div class="opt-panel" data-panel="git">` +
      `<div class="cmp-cols">${field(t('op.userName'), `<input class="inp" id="opName" value="${esc(S.userName)}">`)}${field(t('op.email'), `<input class="inp" id="opEmail" type="email" value="${esc(S.email)}" placeholder="you@example.com">`)}</div><div class="hint">${esc(t('op.identityNote'))}</div>` +
      field(t('op.defaultBranch'), `<input class="inp" id="opDefault" value="${esc(S.defaultBranch)}" style="max-width:220px">`) +
      field(t('op.autoFetch'), `<select class="inp" id="opAuto" style="max-width:260px">${['off', '30', '300', '900'].map(v => `<option value="${v}"${S.autoFetch === v ? ' selected' : ''}>${esc(t('op.af.' + v))}</option>`).join('')}</select>`) +
      check('opPrune', t('op.prune'), S.prune) + check('opPush', t('op.pushAfterCommit'), S.pushAfterCommit) + check('opConfirm', t('op.confirmDelete'), S.confirmDelete) + `</div>` +
    `<div class="opt-panel" data-panel="keyboard">${shortcutsHtml()}</div>` +
    `</div></div>`;
  dialog({
    title: t('op.title'), wide: true, body,
    actions: [{ label: t('dl.cancel') }, { label: t('dl.save'), primary: true, fn: d => {
      const segVal = (id: string) => d.$<HTMLElement>(`#${id} [aria-pressed="true"]`).dataset.v!;
      const oldName = S.userName, oldEmail = S.email;
      Object.assign(S, {
        lang: segVal('opLang'), theme: segVal('opTheme'), dateFmt: segVal('opDate'), avatars: d.$('#opAvatars').checked,
        userName: d.$('#opName').value.trim(), email: d.$('#opEmail').value.trim(), defaultBranch: d.$('#opDefault').value.trim() || 'main',
        autoFetch: d.$<HTMLSelectElement>('#opAuto').value, prune: d.$('#opPrune').checked, pushAfterCommit: d.$('#opPush').checked, confirmDelete: d.$('#opConfirm').checked
      });
      saveSettings(); setupAutoFetch(); appLog('settings saved');
      if (hasRepo() && (S.userName !== oldName || S.email !== oldEmail) && (S.userName || S.email)) doOp('st.working', () => B().setIdentity(P(), S.userName, S.email));
      renderAll(); toast(t('n.settingsSaved'));
    } }],
    onMount: d => {
      const show = (k: string) => { d.$$('[data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === k))); d.$$('[data-panel]').forEach(p => { p.hidden = p.dataset.panel !== k; }); };
      show(tab || 'general');
      d.el.addEventListener('click', e => {
        const tb = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (tb) show(tb.dataset.tab!);
        const sb = (e.target as HTMLElement).closest<HTMLElement>('.seg button'); if (sb) $$('button', sb.parentNode as ParentNode).forEach(x => x.setAttribute('aria-pressed', String(x === sb)));
      });
    }
  });
}
export function shortcutsHtml(){
  const k: [string, string][] = [['ks.commit', 'Ctrl+Enter'], ['ks.fetch', 'Ctrl+Shift+F'], ['ks.find', 'Ctrl+F'], ['ks.sidebar', 'Ctrl+B'], ['ks.dock', 'Ctrl+Shift+G'], ['ks.output', 'Ctrl+J'], ['ks.options', 'Ctrl+,'], ['ks.checkout', 'Enter · ' + t('ks.dbl')], ['ks.delete', 'Del'], ['ks.menu', 'Shift+F10'], ['ks.move', '↑ ↓'], ['ks.close', 'Esc']];
  return `<div class="kbd-list">${k.map(x => `<span>${esc(t(x[0]))}</span><span>${x[1].split(' · ').map(s => s.indexOf('+') > 0 || s.length < 6 ? `<kbd>${esc(s)}</kbd>` : esc(s)).join(' · ')}</span>`).join('')}</div>`;
}
export function dlgShortcuts(){ dialog({ title: t('dl.shortcuts'), body: shortcutsHtml(), actions: [{ label: t('dl.close'), primary: true }] }); }
export function dlgAbout(){
  dialog({ title: t('dl.about'), body: `<div class="about-head">${svg('logo', 'about-logo')}<strong>GitDesk ${VERSION}</strong></div><p style="margin:0">${esc(t('about.body', { v: VERSION }))}</p>${isDemo() ? `<p class="hint" style="margin:0">${esc(t('about.proto'))}</p>` : ''}`, actions: [{ label: t('dl.close'), primary: true }] });
}
export function shutdown(title: string, text: string, btn: string){
  $('#shutTitle').textContent = title; $('#shutText').textContent = text; $('#shutBtn').textContent = btn;
  $('#shutdown').hidden = false; ($('#shutBtn') as HTMLButtonElement).focus();
}

// ---------- auto-fetch ----------
let autoTimer: number | undefined;
export function setupAutoFetch(){
  clearInterval(autoTimer); autoTimer = undefined;
  if (S.autoFetch === 'off') return;
  autoTimer = window.setInterval(async () => {
    if (!hasRepo() || document.hidden) return;
    const be = B();
    if (be.simulateTeammate && Math.random() < 0.5) be.simulateTeammate(P());
    const r = await be.fetch(P(), S.prune);
    r.log.forEach(e => appLog('(auto) ' + e.cmd));
    const { refresh } = await import('./session'); await refresh();
    const n = Number(r.notice?.vars?.n || 0);
    if (n) toast(t('n.autoFetch', { n }), { label: 'Pull', fn: () => { import('./actions').then(m => m.act.pull()); } });
    renderSidebar();
  }, Number(S.autoFetch) * 1000);
}
