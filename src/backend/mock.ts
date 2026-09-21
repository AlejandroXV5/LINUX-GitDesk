// In-memory Git repository used by `npm run dev` in a browser and by the
// "demo repository" inside the app. It behaves like git closely enough to click
// through every flow (fetch/pull/push/sync, rejected pushes, rebase, stash,
// pull requests…) and reports results in the same OpResult shape as the Rust
// backend, so the UI can't tell the difference.
import type { Commit, FileChange, LogEntry, Notice, OpResult, PullRequest, Snapshot, WorkFile } from '../core/model';
import type { GitBackend } from './types';

interface MBranch { tip: string; upstream: string | null }
interface MStash { id: string; msg: string; files: WorkFile[]; t: number }
interface MRepo {
  name: string; url: string;
  commits: Record<string, Commit>;
  branches: Record<string, MBranch>;
  remotes: Record<string, string>;   // what we've fetched: 'origin/x' → sha
  server: Record<string, string>;    // the real origin: 'x' → sha (unseen until fetch)
  tags: Record<string, string>;
  head: { branch?: string; detached?: string };
  work: WorkFile[];
  stashes: MStash[];
  prs: PullRequest[];
  prNext: number;
  submodules: { path: string; url: string }[];
  worktrees: { path: string; branch: string }[];
}

// ---------- deterministic randomness so the demo looks the same every time ----------
let seedN = 20260921;
function rnd(){ seedN |= 0; seedN = (seedN + 0x6d2b79f5) | 0; let t = Math.imul(seedN ^ (seedN >>> 15), 1 | seedN); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const hex = (n: number) => { let s = ''; for (let i = 0; i < n; i++) s += '0123456789abcdef'[Math.floor(rnd() * 16)]; return s; };
const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
const s7 = (s: string) => s.slice(0, 7);
const firstLine = (m: string) => m.split('\n')[0];
let clock = Date.now();
const nowT = () => (clock = Math.max(clock + 1000, Date.now()));
const TEAM = ['J. Kim', 'A. Rivera', 'S. Patel', 'M. Osei'];
const USER = () => { try { return (JSON.parse(localStorage.getItem('gitdesk-settings') || '{}').userName as string) || 'You'; } catch { return 'You'; } };

const REPOS: Record<string, MRepo> = {};
let M: MRepo;

// ---------- op result collector ----------
let LOG: LogEntry[] = [];
let NOTICE: Notice | null = null;
function log(cmd: string, lines: string[] = [], err = false){ LOG.push({ cmd, lines, err }); }
function notice(kind: string, key: string, vars: Record<string, string | number> = {}, actions: string[] = []){
  NOTICE = { kind, key, vars: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, String(v)])), actions };
}
function done(ok = true): OpResult { const r = { ok, notice: NOTICE, log: LOG }; LOG = []; NOTICE = null; return r; }
async function op(path: string, fn: () => boolean | void): Promise<OpResult> {
  use(path);
  await new Promise(r => setTimeout(r, 250 + Math.random() * 350)); // feel like a real command
  const ok = fn();
  return done(ok !== false);
}

// ---------- graph helpers ----------
function add(msg: string, author: string, parents: string[], files?: FileChange[] | null, t?: number){
  const s = hex(40);
  M.commits[s] = { sha: s, msg, author, parents, files: files || null, t: t || nowT() };
  return s;
}
function anc(s: string | null | undefined){
  const set = new Set<string>(), st = [s];
  while (st.length){ const x = st.pop(); if (!x || set.has(x)) continue; set.add(x); const c = M.commits[x]; if (c) st.push(...c.parents); }
  return set;
}
function only(a: string, b?: string | null){ const A = anc(a), B = b ? anc(b) : new Set<string>(); return [...A].filter(x => !B.has(x)).map(x => M.commits[x]).sort((x, y) => y.t - x.t); }
const headSha = () => (M.head.branch ? M.branches[M.head.branch].tip : M.head.detached!);
const cur = () => M.head.branch || null;
const setTip = (s: string) => { if (M.head.branch) M.branches[M.head.branch].tip = s; else M.head.detached = s; };
function resolve(ref: string){ return M.branches[ref]?.tip ?? M.remotes[ref] ?? M.tags[ref] ?? (M.commits[ref] ? ref : null); }
function filesOf(c: Commit): FileChange[] {
  if (c.files) return c.files;
  if (c.parents.length > 1) return [];
  const m = /^\w+\(([^)]+)\)/.exec(c.msg); const sc = (m ? m[1] : 'core').replace(/[^a-z0-9-]/gi, '');
  const n = parseInt(c.sha.slice(0, 2), 16);
  const list: FileChange[] = [{ st: 'M', path: `src/${sc}/${sc}_service.py` }];
  if (n % 3 !== 0) list.push({ st: n % 2 ? 'A' : 'M', path: `tests/${sc}/test_${sc}.py` });
  if (n % 5 === 0) list.push({ st: 'M', path: 'docs/CHANGELOG.md' });
  return list;
}
function use(path: string){
  const name = path.replace(/^demo:\/\//, '');
  if (!REPOS[name]) name === 'gitdesk' ? seedGitdesk() : seedGeneric(name);
  M = REPOS[name];
}

// ---------- seed data ----------
function blank(name: string): MRepo {
  return { name, url: 'https://github.com/org/' + name, commits: {}, branches: {}, remotes: {}, server: {}, tags: {}, head: { branch: 'main' }, work: [], stashes: [], prs: [], prNext: 62, submodules: [], worktrees: [] };
}
function seedGitdesk(){
  M = REPOS.gitdesk = blank('gitdesk');
  const D = 86400000, T = Date.now(), at = (d: number) => Math.round(T - d * D);
  const c = (m: string, a: string, p: string[], d: number, f?: FileChange[]) => add(m, a, p, f, at(d));
  const m1 = c('chore: initial project scaffold', 'J. Kim', [], 9.2, [{ st: 'A', path: 'README.md' }, { st: 'A', path: 'pyproject.toml' }]);
  const m2 = c('feat(core): repository model and git CLI wrapper', 'A. Rivera', [m1], 8.7);
  const m3 = c('feat(ui): branch tree sidebar', 'S. Patel', [m2], 8.1);
  const x1 = c('wip: experimental canvas renderer', 'M. Osei', [m3], 7.8);
  const m4 = c('fix(core): handle detached HEAD in status parsing', 'M. Osei', [m3], 7.2);
  const h1 = c('fix(security): sanitize remote URLs in logs', 'S. Patel', [m4], 6.9);
  const m5 = c('Merge pull request #60 from org/hotfix/urgent-patch', 'J. Kim', [m4, h1], 6.5);
  const m6 = c('docs: document token-rotation flow', 'J. Kim', [m5], 5.6, [{ st: 'M', path: 'docs/auth.md' }]);
  const m7 = c('chore(k8s): adjust pod resource requests', 'M. Osei', [m6], 4.1, [{ st: 'M', path: 'deploy/k8s/deployment.yaml' }]);
  const d1 = c('feat(graph): lane layout for commit history', 'A. Rivera', [m7], 3.6);
  const m8 = c('fix(deploy): pin base image digest', 'S. Patel', [m7], 2.9, [{ st: 'M', path: 'Dockerfile' }]);
  const d2 = c('feat(graph): curved merge edges', 'S. Patel', [d1], 2.2);
  const f1 = c('feat(auth): add refresh-token rotation', 'A. Rivera', [m8], 1.3);
  const d3 = c('feat(graph): highlight the HEAD lane', 'M. Osei', [d2], 1.0);
  const m9 = c('chore(ci): update workflow matrix', 'A. Rivera', [m8], 0.9, [{ st: 'M', path: '.github/workflows/ci.yml' }]);
  const m10 = c('Merge pull request #61 from org/feature/oauth-login', 'J. Kim', [m9, f1], 0.12);
  const f2 = c('test(auth): cover token expiry edge cases', 'A. Rivera', [f1], 0.08);
  const f3 = c('refactor(auth): extract token store', 'A. Rivera', [f2], 0.05);
  const s1 = c('fix(ui): tooltip clipping in narrow sidebar', 'M. Osei', [m10], 0.04);
  const s2 = c('feat(status-bar): show ahead/behind counts', 'S. Patel', [s1], 0.02);
  const p1 = c('feat(payments): scaffold billing module', 'J. Kim', [m10], 0.03);
  M.branches = { main: { tip: m10, upstream: 'origin/main' }, develop: { tip: d2, upstream: 'origin/develop' }, 'feature/oauth-login': { tip: f3, upstream: 'origin/feature/oauth-login' } };
  M.remotes = { 'origin/main': m10, 'origin/develop': d3, 'origin/feature/oauth-login': f1, 'origin/hotfix/urgent-patch': h1, 'origin/release/2.3': m6, 'origin/old-experiment': x1 };
  M.server = { main: s2, develop: d3, 'feature/oauth-login': f1, 'hotfix/urgent-patch': h1, 'release/2.3': m6, 'feature/payments': p1 };
  M.tags = { 'v2.2.1': m3, 'v2.3.0': m6, 'v2.4.0': m8 };
  M.work = [
    { path: 'src/auth/token_service.py', st: 'M', staged: false },
    { path: 'tests/auth/test_token_rotation.py', st: 'A', staged: false },
    { path: 'src/web/session_view.py', from: 'src/web/login_view.py', st: 'R', staged: false },
    { path: 'src/auth/legacy_session.py', st: 'D', staged: true }
  ];
  M.stashes = [{ id: hex(8), msg: 'WIP on develop: ' + s7(d2) + ' curved merge edges', files: [{ path: 'src/graph/layout.py', st: 'M', staged: false }, { path: 'src/graph/edges.py', st: 'A', staged: false }], t: at(0.6) }];
}
function seedGeneric(name: string, url?: string){
  M = REPOS[name] = blank(name);
  if (url) M.url = url;
  const D = 86400000, T = Date.now();
  const people = ['Andrés J.', 'L. Mora', 'D. Chen'];
  const msgs = ['chore: initial commit', 'feat(api): health endpoint', 'feat(api): request logging middleware', 'fix(api): handle empty payloads', 'docs: setup instructions', 'feat(auth): API keys', 'chore(ci): add lint job', 'fix(auth): key rotation race'];
  let prev = '', i = msgs.length; const ids: string[] = [];
  msgs.forEach((m, k) => { prev = add(m, people[k % 3], prev ? [prev] : [], null, Math.round(T - i-- * 0.8 * D)); ids.push(prev); });
  const dv1 = add('feat(api): pagination for list endpoints', people[1], [prev], null, Math.round(T - 0.5 * D));
  const dv2 = add('test(api): pagination edge cases', people[2], [dv1], null, Math.round(T - 0.3 * D));
  const sv = add('fix(api): correct 404 body format', people[0], [prev], null, Math.round(T - 0.1 * D));
  M.branches = { main: { tip: prev, upstream: 'origin/main' }, develop: { tip: dv2, upstream: 'origin/develop' } };
  M.remotes = { 'origin/main': prev, 'origin/develop': dv1 };
  M.server = { main: sv, develop: dv1 };
  M.tags = { 'v1.0.0': ids[4] };
}

// ---------- operations ----------
function fetchAll(prune: boolean, quiet = false){
  const lines: string[] = [];
  Object.keys(M.server).sort().forEach(b => {
    const k = 'origin/' + b, old = M.remotes[k], nw = M.server[b];
    if (old === undefined) lines.push(` * [new branch]      ${b} -> ${k}`);
    else if (old !== nw) lines.push(`   ${s7(old)}..${s7(nw)}  ${b} -> ${k}`);
    M.remotes[k] = nw;
  });
  if (prune) Object.keys(M.remotes).forEach(k => { if (!(k.slice(7) in M.server)){ delete M.remotes[k]; lines.push(` - [deleted]         (none) -> ${k}`); } });
  if (lines.length) lines.unshift('From ' + M.url);
  log('git fetch --all' + (prune ? ' --prune' : ''), lines);
  const n = incoming();
  if (!quiet) notice('info', 'n.fetched', { n }, n ? ['pull'] : []);
}
function incoming(){ const b = cur(); if (!b) return 0; const up = M.branches[b].upstream; return up && M.remotes[up] ? only(M.remotes[up], M.branches[b].tip).length : 0; }
function integrate(b: string, theirs: string, name: string){
  const ours = M.branches[b].tip;
  if (anc(ours).has(theirs)) return { kind: 'uptodate', n: 0 };
  const n = only(theirs, ours).length;
  if (anc(theirs).has(ours)){ M.branches[b].tip = theirs; return { kind: 'ff', n }; }
  M.branches[b].tip = add(`Merge ${name.startsWith('origin/') ? `remote-tracking branch '${name}'` : `branch '${name}'`} into ${b}`, USER(), [ours, theirs], []);
  return { kind: 'merge', n };
}
function pull(): boolean {
  const b = cur(); if (!b){ notice('warn', 'n.detached'); return false; }
  fetchAll(true, true);
  const up = M.branches[b].upstream;
  if (!up || !M.remotes[up]){ notice('info', 'n.noUpstream', { b }, ['push']); return true; }
  const before = M.branches[b].tip, r = integrate(b, M.remotes[up], up);
  log('git pull --no-rebase --no-edit', r.kind === 'uptodate' ? ['Already up to date.'] : r.kind === 'ff' ? [`Updating ${s7(before)}..${s7(M.branches[b].tip)}`, 'Fast-forward'] : ["Merge made by the 'ort' strategy."]);
  if (r.kind === 'uptodate') notice('info', 'n.upToDate'); else notice('ok', 'n.pulled', { n: r.n, u: up });
  return true;
}
function push(branch?: string | null): boolean {
  const b = branch || cur(); if (!b){ notice('warn', 'n.detached'); return false; }
  const br = M.branches[b];
  if (!br.upstream){
    M.server[b] = br.tip; M.remotes['origin/' + b] = br.tip; br.upstream = 'origin/' + b;
    log(`git push --set-upstream origin ${b}`, ['To ' + M.url, ` * [new branch]      ${b} -> ${b}`, `branch '${b}' set up to track 'origin/${b}'.`]);
    notice('ok', 'n.published', { b }); return true;
  }
  const rb = br.upstream.slice(7), srv = M.server[rb];
  if (srv && !anc(br.tip).has(srv)){
    log(`git push origin ${b}:${rb}`, ['To ' + M.url, ` ! [rejected]        ${b} -> ${rb} (fetch first)`, `error: failed to push some refs to '${M.url}'`], true);
    notice('error', 'n.pushRejected', {}, ['pull', 'sync']); return false;
  }
  if (srv === br.tip){ log(`git push origin ${b}:${rb}`, ['Everything up-to-date']); notice('info', 'n.nothingToPush'); return true; }
  const n = only(br.tip, srv).length;
  M.server[rb] = br.tip; M.remotes[br.upstream] = br.tip;
  log(`git push origin ${b}:${rb}`, ['To ' + M.url, `   ${s7(srv || br.tip)}..${s7(br.tip)}  ${b} -> ${rb}`]);
  notice('ok', 'n.pushed', { n, u: br.upstream }); return true;
}
function ab(ours: string, theirs?: string){ return theirs ? { ahead: only(ours, theirs).length, behind: only(theirs, ours).length } : null; }

export const MockBackend: GitBackend = {
  kind: 'mock',
  async open(path){ use(path); return snapshot(path); },
  async snapshot(path){ use(path); return snapshot(path); },
  async clone(url, dest){
    const name = (url.replace(/\.git$/, '').split(/[/:]/).pop() || 'repo').replace(/[^\w.-]/g, '');
    await new Promise(r => setTimeout(r, 500));
    seedGeneric(name, url.replace(/\.git$/, ''));
    Object.keys(M.server).forEach(b => { M.remotes['origin/' + b] = M.server[b]; if (M.branches[b]) M.branches[b].tip = M.server[b]; });
    log(`git clone ${url} ${dest}`, [`Cloning into '${name}'...`, 'done.']); notice('ok', 'n.cloned', { r: name });
    return { path: 'demo://' + name, result: done() };
  },
  async init(dest, defaultBranch, readme){
    const name = dest.split('/').pop() || 'repo';
    M = REPOS[name] = blank(name);
    const c = add('Initial commit', USER(), [], readme ? [{ st: 'A', path: 'README.md' }] : [{ st: 'A', path: '.gitignore' }]);
    M.branches = { [defaultBranch]: { tip: c, upstream: null } }; M.head = { branch: defaultBranch };
    log(`git init -b ${defaultBranch}`, [`Initialized empty Git repository in ${dest}/.git/`]); notice('ok', 'n.repoCreated', { r: name });
    return { path: 'demo://' + name, result: done() };
  },

  async commitFiles(path, sha){ use(path); return M.commits[sha] ? filesOf(M.commits[sha]) : []; },
  async stashFiles(path, id){ use(path); return (M.stashes[stashIndex(id)]?.files || []).map(f => ({ st: f.st, path: f.path, from: f.from })); },
  async compareFiles(path, a, b){
    use(path);
    const A = resolve(a)!, B = resolve(b)!, files: Record<string, FileChange> = {};
    only(A, B).concat(only(B, A)).forEach(c => filesOf(c).forEach(f => { files[f.path] = f; }));
    return Object.values(files);
  },
  async diff(_path, file, _ctx, untracked){ return fakeDiff(file, untracked ? 'A' : statusOf(file)); },

  fetch: (path, prune) => op(path, () => fetchAll(prune)),
  pull: path => op(path, pull),
  push: (path, branch) => op(path, () => push(branch)),
  sync: path => op(path, () => {
    if (!pull()) return false;
    if (!push()) return false;
    notice('ok', 'n.synced', { u: M.branches[cur()!].upstream || '' });
  }),
  commit: (path, o) => op(path, () => {
    if (!o.message.trim()){ notice('warn', 'n.emptyMessage'); return false; }
    const staged = M.work.filter(f => f.staged), files = staged.length ? staged : o.all ? M.work.slice() : [];
    if (!files.length && !o.amend){ notice('info', 'n.nothingToCommit'); return false; }
    const head = M.commits[headSha()];
    const cf = files.map(f => ({ st: f.st, path: f.path, from: f.from }));
    let s: string;
    if (o.amend){
      const merged = filesOf(head).slice();
      cf.forEach(f => { const i = merged.findIndex(x => x.path === f.path); if (i >= 0) merged[i] = f; else merged.push(f); });
      s = add(o.message, USER(), head.parents.slice(), merged);
    } else s = add(o.message, USER(), [head.sha], cf);
    setTip(s);
    M.work = M.work.filter(f => files.indexOf(f) < 0);
    if (!staged.length && o.all) log('git add --all');
    log(`git commit ${o.amend ? '--amend ' : ''}-m "${firstLine(o.message)}"`, [`[${cur() || 'detached HEAD'} ${s7(s)}] ${firstLine(o.message)}`, ` ${cf.length} file${cf.length === 1 ? '' : 's'} changed`]);
    notice('ok', o.amend ? 'n.amended' : 'n.committed', { sha: s7(s) }, cur() ? ['push', 'sync'] : []);
  }),
  stage: (path, files) => op(path, () => { M.work.forEach(f => { if (files.includes(f.path)) f.staged = true; }); log('git add -- ' + files.join(' ')); }),
  unstage: (path, files) => op(path, () => { M.work.forEach(f => { if (files.includes(f.path)) f.staged = false; }); log('git restore --staged -- ' + files.join(' ')); }),
  discard: (path, files) => op(path, () => { M.work = M.work.filter(f => f.staged || !files.includes(f.path)); log('git restore -- ' + files.join(' ')); }),
  discardAll: path => op(path, () => { M.work = M.work.filter(f => f.staged); log('git restore --worktree -- .'); log('git clean -fd'); }),
  checkout: (path, target, kind) => op(path, () => {
    if (kind === 'local') M.head = { branch: target };
    else if (kind === 'remote'){
      const name = target.slice(target.indexOf('/') + 1);
      if (!M.branches[name]){ M.branches[name] = { tip: M.remotes[target], upstream: target }; log(`git switch --track ${target}`, [`branch '${name}' set up to track '${target}'.`, `Switched to a new branch '${name}'`]); }
      else log(`git switch ${name}`, [`Switched to branch '${name}'`]);
      M.head = { branch: name }; notice('ok', 'n.checkedOut', { b: name }); return;
    } else { const s = resolve(target)!; M.head = { detached: s }; log(`git switch --detach ${target}`, [`HEAD is now at ${s7(s)} ${firstLine(M.commits[s].msg)}`]); notice('warn', 'n.detachedAt', { sha: s7(s) }, ['newBranch']); return; }
    log(`git switch ${target}`, [`Switched to branch '${target}'`]); notice('ok', 'n.checkedOut', { b: target });
  }),
  createBranch: (path, name, from, co) => op(path, () => {
    if (M.branches[name]){ log(`git branch ${name} ${from}`, [`fatal: a branch named '${name}' already exists`], true); notice('error', 'n.gitError', { msg: `a branch named '${name}' already exists` }); return false; }
    M.branches[name] = { tip: resolve(from)!, upstream: null };
    log(co ? `git switch -c ${name} ${from}` : `git branch --no-track ${name} ${from}`);
    if (co) M.head = { branch: name };
    notice('ok', 'n.branchCreated', { b: name }, ['push']);
  }),
  deleteRef: (path, target, kind, force) => op(path, () => {
    if (kind === 'local'){ delete M.branches[target]; log(`git branch ${force ? '-D' : '-d'} ${target}`, [`Deleted branch ${target}.`]); }
    else if (kind === 'remote'){ const n = target.slice(target.indexOf('/') + 1); delete M.remotes[target]; delete M.server[n]; log(`git push origin --delete ${n}`, ['To ' + M.url, ` - [deleted]         ${n}`]); }
    else { delete M.tags[target]; log(`git tag -d ${target}`, [`Deleted tag '${target}'`]); }
    notice('ok', 'n.deleted', { b: target });
  }),
  merge: (path, target) => op(path, () => {
    const b = cur(); if (!b){ notice('warn', 'n.detached'); return false; }
    const before = M.branches[b].tip, r = integrate(b, resolve(target)!, target);
    log(`git merge --no-edit ${target}`, r.kind === 'uptodate' ? ['Already up to date.'] : r.kind === 'ff' ? [`Updating ${s7(before)}..${s7(M.branches[b].tip)}`, 'Fast-forward'] : ["Merge made by the 'ort' strategy."]);
    if (r.kind === 'uptodate') notice('info', 'n.alreadyContains', { a: target, b }); else notice('ok', r.kind === 'ff' ? 'n.ff' : 'n.merged', { a: target, b }, ['push']);
  }),
  rebase: (path, onto) => op(path, () => {
    const b = cur(); if (!b){ notice('warn', 'n.detached'); return false; }
    const o = resolve(onto)!, ours = M.branches[b].tip;
    if (anc(ours).has(o)){ log(`git rebase ${onto}`, [`Current branch ${b} is up to date.`]); notice('info', 'n.upToDateRebase', { a: onto, b }); return; }
    if (anc(o).has(ours)){ M.branches[b].tip = o; log(`git rebase ${onto}`, [`Successfully rebased and updated refs/heads/${b}.`]); notice('ok', 'n.ff', { a: onto, b }); return; }
    const replay = only(ours, o).filter(c => c.parents.length === 1).reverse();
    let tip = o; replay.forEach(c => { tip = add(c.msg, c.author, [tip], filesOf(c)); });
    M.branches[b].tip = tip;
    log(`git rebase ${onto}`, [`Successfully rebased and updated refs/heads/${b}.`]);
    notice('ok', 'n.rebased', { a: onto, b, n: replay.length }, ['push']);
  }),
  reset: (path, sha, mode) => op(path, () => {
    const target = sha === 'HEAD~1' ? M.commits[headSha()].parents[0] : resolve(sha)!;
    const old = headSha(), keep = anc(target);
    const dropped = [...anc(old)].filter(x => !keep.has(x)).map(x => M.commits[x]);
    setTip(target);
    if (mode === 'hard') M.work = [];
    else {
      if (mode === 'mixed') M.work.forEach(f => { f.staged = false; });
      dropped.forEach(c => filesOf(c).forEach(f => { if (!M.work.some(x => x.path === f.path)) M.work.push({ path: f.path, st: f.st, from: f.from, staged: mode === 'soft' }); }));
    }
    log(`git reset --${mode} ${sha === 'HEAD~1' ? sha : s7(target)}`, mode === 'hard' ? [`HEAD is now at ${s7(target)} ${firstLine(M.commits[target].msg)}`] : []);
    notice('ok', mode === 'soft' ? 'n.undone' : 'n.reset', { b: cur() || 'HEAD', sha: s7(target), mode: '--' + mode });
  }),
  cherryPick: (path, sha) => op(path, () => {
    const c = M.commits[sha];
    if (c.parents.length > 1){ notice('warn', 'n.cherryMerge', { sha: s7(sha) }); return false; }
    const n = add(c.msg, c.author, [headSha()], filesOf(c)); setTip(n);
    log(`git cherry-pick ${s7(sha)}`, [`[${cur() || 'detached HEAD'} ${s7(n)}] ${firstLine(c.msg)}`]);
    notice('ok', 'n.cherry', { sha: s7(sha), b: cur() || 'HEAD' }, ['push']);
  }),
  revert: (path, sha) => op(path, () => {
    const c = M.commits[sha];
    const files = filesOf(c).map(f => ({ st: f.st === 'A' ? 'D' : f.st === 'D' ? 'A' : 'M', path: f.path }));
    const n = add(`Revert "${firstLine(c.msg)}"\n\nThis reverts commit ${sha}.`, USER(), [headSha()], files); setTip(n);
    log(`git revert --no-edit ${s7(sha)}`, [`[${cur() || 'detached HEAD'} ${s7(n)}] Revert "${firstLine(c.msg)}"`]);
    notice('ok', 'n.reverted', { sha: s7(sha) }, ['push']);
  }),
  abort: (path, o) => op(path, () => { log(`git ${o} --abort`); notice('info', 'n.aborted', { op: o }); }),
  tag: (path, name, sha, msg) => op(path, () => { M.tags[name] = resolve(sha)!; log(`git tag ${msg ? `-a ${name} -m "${msg}"` : name} ${s7(sha)}`); notice('ok', 'n.tagCreated', { t: name, sha: s7(sha) }); }),
  stashPush: path => op(path, () => {
    if (!M.work.length){ notice('info', 'n.nothingToStash'); return; }
    const b = cur() || '(no branch)', h = M.commits[headSha()], n = M.work.length;
    M.stashes.unshift({ id: hex(8), msg: `WIP on ${b}: ${s7(h.sha)} ${firstLine(h.msg)}`, files: M.work.map(f => ({ ...f, staged: false })), t: nowT() });
    M.work = [];
    log('git stash push --include-untracked', [`Saved working directory and index state WIP on ${b}: ${s7(h.sha)} ${firstLine(h.msg)}`]);
    notice('ok', 'n.stashed', { n });
  }),
  stashApply: (path, id, pop) => op(path, () => {
    const i = stashIndex(id), st = M.stashes[i]; if (!st) return false;
    st.files.forEach(f => { const k = M.work.findIndex(x => x.path === f.path); const nf = { ...f, staged: false }; if (k >= 0) M.work[k] = nf; else M.work.push(nf); });
    if (pop) M.stashes.splice(i, 1);
    log(`git stash ${pop ? 'pop' : 'apply'} ${id}`, st.files.map(f => `\t${f.st === 'A' ? 'new file:' : f.st === 'D' ? 'deleted: ' : 'modified:'}   ${f.path}`));
    notice('ok', pop ? 'n.popped' : 'n.applied', { s: id });
  }),
  stashDrop: (path, id) => op(path, () => { M.stashes.splice(stashIndex(id), 1); log(`git stash drop ${id}`, [`Dropped ${id}`]); notice('ok', 'n.dropped', { s: id }); }),
  worktreeAdd: (path, dir, branch, from) => op(path, () => {
    M.branches[branch] = { tip: resolve(from)!, upstream: null }; M.worktrees.push({ path: dir, branch });
    log(`git worktree add -b ${branch} ${dir} ${from}`, [`Preparing worktree (new branch '${branch}')`]); notice('ok', 'n.worktree', { p: dir });
  }),
  worktreeRemove: (path, dir) => op(path, () => { M.worktrees = M.worktrees.filter(w => w.path !== dir); log(`git worktree remove ${dir}`); }),
  submoduleAdd: (path, url, dir) => op(path, () => {
    M.submodules.push({ url, path: dir });
    if (!M.work.some(f => f.path === '.gitmodules')) M.work.push({ path: '.gitmodules', st: 'A', staged: true });
    M.work.push({ path: dir, st: 'A', staged: true });
    log(`git submodule add ${url} ${dir}`, [`Cloning into '${dir}'...`, 'done.']); notice('ok', 'n.submodule', { p: dir });
  }),
  submoduleRemove: (path, dir) => op(path, () => { M.submodules = M.submodules.filter(s => s.path !== dir); M.work.push({ path: dir, st: 'D', staged: true }); log(`git rm -f ${dir}`, [`rm '${dir}'`]); }),
  setIdentity: (path, name, email) => op(path, () => { log(`git config --global user.name "${name}"`); if (email) log(`git config --global user.email "${email}"`); }),

  async prList(path){ use(path); return M.prs.map(p => ({ ...p })); },
  prCreate: (path, source, target, title, body, draft) => op(path, () => {
    if (M.branches[source] && (!M.branches[source].upstream || M.server[source] !== M.branches[source].tip)) push(source);
    const pr = { id: M.prNext++, title, desc: body, source, target, status: draft ? 'draft' : 'open', t: nowT() };
    M.prs.push(pr);
    log(`gh pr create --head ${source} --base ${target} --title "${title}"${draft ? ' --draft' : ''}`, [`${M.url}/pull/${pr.id}`]);
    notice('ok', 'n.prCreated', { n: pr.id });
  }),
  prMerge: (path, id, close) => op(path, () => {
    const p = M.prs.find(x => x.id === id); if (!p) return false;
    if (close){ p.status = 'abandoned'; log(`gh pr close ${id}`); notice('info', 'n.prAbandoned', { n: id }); return; }
    const s = M.server[p.source], tg = M.server[p.target];
    if (s && tg && !anc(tg).has(s)) M.server[p.target] = add(`Merge pull request #${id} from org/${p.source}\n\n${p.title}`, USER(), [tg, s], []);
    else if (s && !tg) M.server[p.target] = s;
    p.status = 'completed';
    log(`gh pr merge ${id} --merge`, [`✓ Merged pull request #${id} (${p.title})`]);
    notice('ok', 'n.prCompleted', { n: id }, ['fetch', 'pull']);
  }),

  simulateEdit(path){
    use(path);
    const pool = ['src/ui/sidebar.py', 'src/graph/layout.py', 'README.md', 'src/core/git_cli.py', 'docs/setup.md', 'src/ui/theme.css', 'src/ui/options_dialog.py', 'src/i18n/es.json', 'tests/ui/test_sidebar.py'];
    const free = pool.filter(p => !M.work.some(f => f.path === p));
    const p = free.length ? pick(free) : pick(pool);
    const ex = M.work.find(f => f.path === p);
    if (ex) ex.staged = false; else M.work.push({ path: p, st: /options_dialog|es\.json|test_sidebar/.test(p) ? 'A' : 'M', staged: false });
    return p;
  },
  simulateTeammate(path){
    use(path);
    const b = M.server.main ? 'main' : Object.keys(M.server)[0];
    if (!b) return null;
    const who = pick(TEAM);
    const m = pick(['fix(ui): focus ring on tree rows', 'feat(output): colorize git errors', 'chore(deps): bump pygit2 to 1.15', 'docs: keyboard shortcuts table', 'fix(core): parse renames with spaces', 'perf(graph): cache lane layout']);
    M.server[b] = add(m, who, [M.server[b]], null);
    return { who, b };
  }
};

function stashIndex(id: string){ const m = /stash@\{(\d+)\}/.exec(id); return m ? +m[1] : 0; }
function statusOf(file: string){ return M.work.find(f => f.path === file)?.st || 'M'; }

function snapshot(path: string): Snapshot {
  const branches: Snapshot['branches'] = {};
  Object.entries(M.branches).forEach(([k, b]) => {
    const t = b.upstream && M.remotes[b.upstream] ? ab(b.tip, M.remotes[b.upstream]) : null;
    branches[k] = { tip: b.tip, upstream: b.upstream, ahead: t?.ahead ?? null, behind: t?.behind ?? null, gone: !!b.upstream && !M.remotes[b.upstream] };
  });
  const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
  return {
    name: M.name, path, url: M.url,
    head: { branch: M.head.branch || null, detached: M.head.detached || null },
    branches, remotes: { ...M.remotes }, tags: { ...M.tags },
    commits: clone(M.commits),
    work: clone(M.work),
    stashes: M.stashes.map((s, i) => ({ id: `stash@{${i}}`, msg: s.msg, t: s.t })),
    worktrees: clone(M.worktrees), submodules: clone(M.submodules),
    inProgress: null, truncated: false
  };
}

// A believable unified diff for demo files.
function fakeDiff(path: string, st: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1), stem = name.replace(/\.\w+$/, '').replace(/[^a-z0-9_]/gi, '_'), ext = (name.split('.').pop() || '').toLowerCase();
  let a: string[], b: string[];
  if (ext === 'py'){
    a = ['import logging', 'from datetime import timedelta', '', 'log = logging.getLogger(__name__)', '', '', `def ${stem}(session):`, '    ttl = timedelta(minutes=15)', '    token = session.refresh()', '    return token'];
    b = ['import logging', 'from datetime import timedelta', '', 'log = logging.getLogger(__name__)', 'DEFAULT_TTL = timedelta(minutes=30)', '', `def ${stem}(session, ttl=DEFAULT_TTL):`, '    token = session.refresh(ttl=ttl)', '    log.debug("refreshed %s", token.id)', '    return token'];
  } else if (ext === 'md'){
    a = [`# ${stem}`, '', 'GitDesk is a Git client for the Linux desktop.', '', '## Setup', '', '    pip install gitdesk'];
    b = [`# ${stem}`, '', 'GitDesk is a Git client for the Linux desktop.', '', '## Setup', '', '    pipx install gitdesk', '    gitdesk --repo ~/src/project'];
  } else {
    a = ['key: value', 'enabled: false', 'retries: 3'];
    b = ['key: value', 'enabled: true', 'retries: 5', 'timeout: 30s'];
  }
  const out = [`diff --git a/${path} b/${path}`];
  if (st === 'A'){ out.push('new file mode 100644', '--- /dev/null', `+++ b/${path}`, `@@ -0,0 +1,${b.length} @@`, ...b.map(l => '+' + l)); return out.join('\n'); }
  if (st === 'D'){ out.push('deleted file mode 100644', `--- a/${path}`, '+++ /dev/null', `@@ -1,${a.length} +0,0 @@`, ...a.map(l => '-' + l)); return out.join('\n'); }
  out.push(`--- a/${path}`, `+++ b/${path}`, `@@ -1,${a.length} +1,${b.length} @@`);
  let i = 0, j = 0;
  while (i < a.length || j < b.length){
    if (i < a.length && j < b.length && a[i] === b[j]){ out.push(' ' + a[i]); i++; j++; }
    else if (i < a.length && b.indexOf(a[i], j) < 0){ out.push('-' + a[i]); i++; }
    else { out.push('+' + b[j]); j++; }
  }
  return out.join('\n');
}
