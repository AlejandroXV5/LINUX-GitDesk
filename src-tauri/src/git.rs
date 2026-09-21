//! Everything GitDesk does to a repository goes through the `git` CLI.
//!
//! Why the CLI and not libgit2: it is what the user already has configured
//! (credential helpers, SSH agent, hooks, `includeIf`, LFS…), its behaviour
//! matches what they'd get in a terminal, and every action can be echoed to the
//! Output panel as the exact command that ran.
//!
//! Two kinds of functions live here:
//! * `snapshot` / `commit_files` / `diff` … read the repository and return data.
//! * operations (`fetch`, `commit`, `merge`, …) change it and return an
//!   [`OpResult`]: the commands that ran, their output, and a notice for the UI.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

// ---------------------------------------------------------------------------
// Data sent to the frontend (camelCase to match the TypeScript types)
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub sha: String,
    pub msg: String,
    pub author: String,
    pub email: String,
    pub parents: Vec<String>,
    /// Commit time in milliseconds since the epoch.
    pub t: i64,
    /// Position in `git log --topo-order`; the graph is drawn in this order.
    pub o: usize,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Branch {
    pub tip: String,
    pub upstream: Option<String>,
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    /// The upstream is configured but no longer exists on the remote.
    pub gone: bool,
}

#[derive(Serialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Head {
    pub branch: Option<String>,
    pub detached: Option<String>,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkFile {
    pub path: String,
    /// One of M, A, D, R, U (U = unmerged / conflict).
    pub st: String,
    pub from: Option<String>,
    pub staged: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Stash {
    pub id: String,
    pub msg: String,
    pub t: i64,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Worktree {
    pub path: String,
    pub branch: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Submodule {
    pub path: String,
    pub url: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub name: String,
    pub path: String,
    pub url: String,
    pub head: Head,
    pub branches: BTreeMap<String, Branch>,
    /// Remote-tracking refs, keyed by short name (`origin/main`).
    pub remotes: BTreeMap<String, String>,
    pub tags: BTreeMap<String, String>,
    pub commits: BTreeMap<String, Commit>,
    pub work: Vec<WorkFile>,
    pub stashes: Vec<Stash>,
    pub worktrees: Vec<Worktree>,
    pub submodules: Vec<Submodule>,
    /// "merge", "rebase", "cherry-pick" or "revert" while one is in progress.
    pub in_progress: Option<String>,
    pub truncated: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub st: String,
    pub path: String,
    pub from: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct LogEntry {
    pub cmd: String,
    pub lines: Vec<String>,
    pub err: bool,
}

#[derive(Serialize, Debug, Clone)]
pub struct Notice {
    /// ok | info | warn | error
    pub kind: String,
    /// i18n key understood by the frontend (see src/core/i18n.ts).
    pub key: String,
    pub vars: BTreeMap<String, String>,
    /// Follow-up actions offered as links: push, pull, sync, fetch, mergeAbort, …
    pub actions: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
pub struct OpResult {
    pub ok: bool,
    pub notice: Option<Notice>,
    pub log: Vec<LogEntry>,
}

#[derive(Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitOptions {
    pub message: String,
    pub amend: bool,
    /// Stage every change first ("Commit All") when nothing is staged.
    pub all: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub id: u64,
    pub title: String,
    pub desc: String,
    pub source: String,
    pub target: String,
    pub status: String,
    pub t: i64,
}

// ---------------------------------------------------------------------------
// Running git
// ---------------------------------------------------------------------------

pub struct Out {
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
}

impl Out {
    pub fn ok(&self) -> bool {
        self.code == 0
    }
    fn lines(&self) -> Vec<String> {
        let mut v: Vec<String> = Vec::new();
        for s in [&self.stdout, &self.stderr] {
            for l in s.lines() {
                if !l.trim().is_empty() {
                    v.push(l.to_string());
                }
            }
        }
        v
    }
}

pub struct Repo {
    pub dir: PathBuf,
    log: Vec<LogEntry>,
}

const MAX_COMMITS: usize = 2000;

fn git_command(dir: &Path) -> Command {
    let mut c = Command::new("git");
    c.current_dir(dir)
        // Stable, parseable English output regardless of the user's locale.
        .env("LC_ALL", "C")
        .env("LANG", "C")
        // Never block on a terminal prompt: a GUI has no terminal. Credentials must
        // come from a credential helper or the SSH agent.
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GCM_INTERACTIVE", "never")
        .env("GIT_EDITOR", "true")
        .env("GIT_MERGE_AUTOEDIT", "no")
        .arg("-c")
        .arg("color.ui=false")
        .arg("-c")
        .arg("core.quotepath=false");
    c
}

impl Repo {
    pub fn open(dir: &str) -> Result<Repo, String> {
        let p = PathBuf::from(dir);
        if !p.is_dir() {
            return Err(format!("Not a folder: {dir}"));
        }
        let r = Repo { dir: p, log: Vec::new() };
        let top = r.raw(&["rev-parse", "--show-toplevel"]);
        if !top.ok() {
            return Err(format!("Not a Git repository: {dir}"));
        }
        Ok(Repo { dir: PathBuf::from(top.stdout.trim()), log: Vec::new() })
    }

    /// Run git without recording it in the Output log (reads).
    pub fn raw(&self, args: &[&str]) -> Out {
        match git_command(&self.dir).args(args).output() {
            Ok(o) => Out {
                code: o.status.code().unwrap_or(-1),
                stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
                stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
            },
            Err(e) => Out { code: -1, stdout: String::new(), stderr: format!("could not run git: {e}") },
        }
    }

    /// Run git and record the command + output for the Output panel (writes).
    fn run(&mut self, args: &[&str]) -> Out {
        let out = self.raw(args);
        let shown: Vec<String> = args
            .iter()
            .map(|a| if a.contains(' ') || a.is_empty() { format!("\"{a}\"") } else { a.to_string() })
            .collect();
        self.log.push(LogEntry { cmd: format!("git {}", shown.join(" ")), lines: out.lines(), err: !out.ok() });
        out
    }

    fn finish(&mut self, ok: bool, notice: Option<Notice>) -> OpResult {
        OpResult { ok, notice, log: std::mem::take(&mut self.log) }
    }

    fn fail(&mut self, out: &Out) -> OpResult {
        if let Some(n) = auth_notice(out) {
            return self.finish(false, Some(n));
        }
        let msg = out
            .stderr
            .lines()
            .chain(out.stdout.lines())
            .find(|l| l.starts_with("fatal:") || l.starts_with("error:"))
            .unwrap_or_else(|| out.stderr.lines().next().unwrap_or("git failed"))
            .to_string();
        let n = notice("error", "n.gitError", &[("msg", &msg)], &[]);
        self.finish(false, Some(n))
    }

    // -----------------------------------------------------------------------
    // Reads
    // -----------------------------------------------------------------------

    pub fn snapshot(&self) -> Snapshot {
        let name = self.dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
        let url = {
            let o = self.raw(&["remote", "get-url", "origin"]);
            if o.ok() { o.stdout.trim().to_string() } else { String::new() }
        };

        // HEAD
        let mut head = Head::default();
        let sym = self.raw(&["symbolic-ref", "-q", "--short", "HEAD"]);
        let head_sha = self.raw(&["rev-parse", "-q", "--verify", "HEAD"]);
        if sym.ok() {
            head.branch = Some(sym.stdout.trim().to_string());
        } else if head_sha.ok() {
            head.detached = Some(head_sha.stdout.trim().to_string());
        }

        // refs
        let mut branches = BTreeMap::new();
        let mut remotes = BTreeMap::new();
        let mut tags = BTreeMap::new();
        let refs = self.raw(&[
            "for-each-ref",
            "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track)",
            "refs/heads",
            "refs/remotes",
            "refs/tags",
        ]);
        for line in refs.stdout.lines() {
            let f: Vec<&str> = line.split('\0').collect();
            if f.len() < 5 {
                continue;
            }
            let (refname, obj, peeled, upstream, track) = (f[0], f[1], f[2], f[3], f[4]);
            if let Some(n) = refname.strip_prefix("refs/heads/") {
                let (ahead, behind, gone) = parse_track(track);
                branches.insert(
                    n.to_string(),
                    Branch {
                        tip: obj.to_string(),
                        upstream: if upstream.is_empty() { None } else { Some(upstream.to_string()) },
                        ahead,
                        behind,
                        gone,
                    },
                );
            } else if let Some(n) = refname.strip_prefix("refs/remotes/") {
                if !n.ends_with("/HEAD") {
                    remotes.insert(n.to_string(), obj.to_string());
                }
            } else if let Some(n) = refname.strip_prefix("refs/tags/") {
                // annotated tags point at a tag object; the commit is the peeled value
                tags.insert(n.to_string(), if peeled.is_empty() { obj.to_string() } else { peeled.to_string() });
            }
        }
        // An unborn branch (fresh `git init`) has no ref yet but is still "current".
        if let Some(b) = &head.branch {
            if !branches.contains_key(b) && !head_sha.ok() {
                head.branch = Some(b.clone());
            }
        }

        // history: everything reachable from branches, remotes, tags and HEAD
        let mut commits = BTreeMap::new();
        let mut truncated = false;
        if head_sha.ok() || !branches.is_empty() {
            let max = format!("-n{MAX_COMMITS}");
            let mut args = vec![
                "log",
                "--topo-order",
                max.as_str(),
                "--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%B%x1e",
                "--branches",
                "--remotes",
                "--tags",
            ];
            if head_sha.ok() {
                args.push("HEAD");
            }
            args.push("--");
            let log = self.raw(&args);
            for (i, rec) in log.stdout.split('\x1e').enumerate() {
                let rec = rec.trim_start_matches('\n');
                if rec.trim().is_empty() {
                    continue;
                }
                let f: Vec<&str> = rec.splitn(6, '\x1f').collect();
                if f.len() < 6 {
                    continue;
                }
                commits.insert(
                    f[0].to_string(),
                    Commit {
                        sha: f[0].to_string(),
                        parents: f[1].split_whitespace().map(String::from).collect(),
                        author: f[2].to_string(),
                        email: f[3].to_string(),
                        t: f[4].trim().parse::<i64>().unwrap_or(0) * 1000,
                        msg: f[5].trim_end().to_string(),
                        o: i,
                    },
                );
            }
            truncated = commits.len() >= MAX_COMMITS;
        }

        Snapshot {
            name,
            path: self.dir.to_string_lossy().into_owned(),
            url,
            head,
            branches,
            remotes,
            tags,
            commits,
            work: self.status(),
            stashes: self.stashes(),
            worktrees: self.worktrees(),
            submodules: self.submodules(),
            in_progress: self.in_progress(),
            truncated,
        }
    }

    pub fn status(&self) -> Vec<WorkFile> {
        let o = self.raw(&["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
        parse_status(&o.stdout)
    }

    fn stashes(&self) -> Vec<Stash> {
        let o = self.raw(&["stash", "list", "--format=%gd%x1f%s%x1f%ct"]);
        o.stdout
            .lines()
            .filter_map(|l| {
                let f: Vec<&str> = l.split('\x1f').collect();
                (f.len() == 3).then(|| Stash {
                    id: f[0].to_string(),
                    msg: f[1].to_string(),
                    t: f[2].parse::<i64>().unwrap_or(0) * 1000,
                })
            })
            .collect()
    }

    fn worktrees(&self) -> Vec<Worktree> {
        let o = self.raw(&["worktree", "list", "--porcelain"]);
        let mut out = Vec::new();
        let (mut path, mut branch) = (String::new(), String::new());
        for l in o.stdout.lines().chain(std::iter::once("")) {
            if let Some(p) = l.strip_prefix("worktree ") {
                path = p.to_string();
            } else if let Some(b) = l.strip_prefix("branch refs/heads/") {
                branch = b.to_string();
            } else if l == "detached" {
                branch = "(detached)".into();
            } else if l.is_empty() && !path.is_empty() {
                if Path::new(&path) != self.dir {
                    out.push(Worktree { path: path.clone(), branch: branch.clone() });
                }
                path.clear();
                branch.clear();
            }
        }
        out
    }

    fn submodules(&self) -> Vec<Submodule> {
        if !self.dir.join(".gitmodules").exists() {
            return vec![];
        }
        let o = self.raw(&["config", "-f", ".gitmodules", "--get-regexp", r"^submodule\..*\.(path|url)$"]);
        let mut map: BTreeMap<String, (String, String)> = BTreeMap::new();
        for l in o.stdout.lines() {
            if let Some((k, v)) = l.split_once(' ') {
                let name = k.trim_start_matches("submodule.").rsplit_once('.').map(|x| x.0).unwrap_or(k).to_string();
                let e = map.entry(name).or_default();
                if k.ends_with(".path") { e.0 = v.to_string() } else { e.1 = v.to_string() }
            }
        }
        map.into_values().map(|(path, url)| Submodule { path, url }).collect()
    }

    fn in_progress(&self) -> Option<String> {
        let g = self.raw(&["rev-parse", "--git-dir"]);
        let gd = self.dir.join(g.stdout.trim());
        if gd.join("MERGE_HEAD").exists() { return Some("merge".into()); }
        if gd.join("rebase-merge").exists() || gd.join("rebase-apply").exists() { return Some("rebase".into()); }
        if gd.join("CHERRY_PICK_HEAD").exists() { return Some("cherry-pick".into()); }
        if gd.join("REVERT_HEAD").exists() { return Some("revert".into()); }
        None
    }

    pub fn commit_files(&self, sha: &str) -> Vec<FileChange> {
        let o = self.raw(&["show", "--no-color", "--format=", "--name-status", "-M", "--no-renames-limit", sha]);
        let o = if o.ok() { o } else { self.raw(&["show", "--format=", "--name-status", "-M", sha]) };
        parse_name_status(&o.stdout)
    }

    pub fn stash_files(&self, id: &str) -> Vec<FileChange> {
        let o = self.raw(&["stash", "show", "--name-status", "--include-untracked", id]);
        let o = if o.ok() { o } else { self.raw(&["stash", "show", "--name-status", id]) };
        parse_name_status(&o.stdout)
    }

    pub fn compare_files(&self, a: &str, b: &str) -> Vec<FileChange> {
        parse_name_status(&self.raw(&["diff", "--name-status", "-M", b, a]).stdout)
    }

    /// Unified diff text. `ctx` is "work" (unstaged), "staged", a commit sha,
    /// or "cmp:<a>..<b>" for a compare.
    pub fn diff(&self, path: &str, ctx: &str, untracked: bool) -> String {
        let o = if ctx == "work" && untracked {
            self.raw(&["diff", "--no-index", "--", "/dev/null", path])
        } else if ctx == "work" {
            self.raw(&["diff", "-M", "--", path])
        } else if ctx == "staged" {
            self.raw(&["diff", "--cached", "-M", "--", path])
        } else if let Some(id) = ctx.strip_prefix("stash:") {
            let base = format!("{id}^1");
            let o = self.raw(&["diff", "-M", &base, id, "--", path]);
            if o.stdout.trim().is_empty() {
                // untracked files live in the stash's third parent
                let u = format!("{id}^3");
                self.raw(&["show", "--format=", &u, "--", path])
            } else { o }
        } else if let Some(r) = ctx.strip_prefix("cmp:") {
            let (a, b) = r.split_once("..").unwrap_or((r, "HEAD"));
            self.raw(&["diff", "-M", b, a, "--", path])
        } else {
            self.raw(&["show", "--format=", "-M", ctx, "--", path])
        };
        o.stdout
    }

    // -----------------------------------------------------------------------
    // Operations
    // -----------------------------------------------------------------------

    pub fn fetch(&mut self, prune: bool) -> OpResult {
        if self.raw(&["remote"]).stdout.trim().is_empty() {
            return self.finish(true, Some(notice("info", "n.noRemote", &[], &[])));
        }
        let before = self.incoming_count();
        let mut args = vec!["fetch", "--all"];
        if prune {
            args.push("--prune");
        }
        let o = self.run(&args);
        if !o.ok() {
            return self.fail(&o);
        }
        let n = self.incoming_count();
        let _ = before;
        let acts: &[&str] = if n > 0 { &["pull"] } else { &[] };
        let nt = notice("info", "n.fetched", &[("n", &n.to_string())], acts);
        self.finish(true, Some(nt))
    }

    fn current_branch(&self) -> Option<String> {
        let o = self.raw(&["symbolic-ref", "-q", "--short", "HEAD"]);
        o.ok().then(|| o.stdout.trim().to_string())
    }

    fn upstream_of(&self, branch: &str) -> Option<String> {
        let o = self.raw(&["rev-parse", "--abbrev-ref", &format!("{branch}@{{upstream}}")]);
        o.ok().then(|| o.stdout.trim().to_string())
    }

    fn incoming_count(&self) -> u32 {
        let o = self.raw(&["rev-list", "--count", "HEAD..@{upstream}"]);
        o.stdout.trim().parse().unwrap_or(0)
    }

    fn outgoing_count(&self, branch: &str) -> u32 {
        let o = self.raw(&["rev-list", "--count", &format!("{branch}@{{upstream}}..{branch}")]);
        o.stdout.trim().parse().unwrap_or(0)
    }

    pub fn pull(&mut self) -> OpResult {
        let Some(b) = self.current_branch() else {
            return self.finish(false, Some(notice("warn", "n.detached", &[], &[])));
        };
        let Some(up) = self.upstream_of(&b) else {
            return self.finish(true, Some(notice("info", "n.noUpstream", &[("b", &b)], &["push"])));
        };
        let n = {
            let _ = self.raw(&["fetch", "--quiet"]);
            self.incoming_count()
        };
        let o = self.run(&["pull", "--no-rebase", "--no-edit"]);
        if !o.ok() {
            if self.in_progress().as_deref() == Some("merge") {
                let nt = notice("error", "n.conflicts", &[("op", "merge")], &["mergeAbort"]);
                return self.finish(false, Some(nt));
            }
            return self.fail(&o);
        }
        if o.stdout.contains("Already up to date") {
            return self.finish(true, Some(notice("info", "n.upToDate", &[], &[])));
        }
        let nt = notice("ok", "n.pulled", &[("n", &n.to_string()), ("u", &up)], &[]);
        self.finish(true, Some(nt))
    }

    pub fn push(&mut self, branch: Option<String>) -> OpResult {
        let Some(b) = branch.or_else(|| self.current_branch()) else {
            return self.finish(false, Some(notice("warn", "n.detached", &[], &[])));
        };
        let remote = self.raw(&["remote"]).stdout.lines().next().unwrap_or("").to_string();
        if remote.is_empty() {
            return self.finish(false, Some(notice("warn", "n.noRemote", &[], &[])));
        }
        match self.upstream_of(&b) {
            None => {
                let o = self.run(&["push", "--set-upstream", &remote, &b]);
                if !o.ok() {
                    return self.push_failed(&o);
                }
                self.finish(true, Some(notice("ok", "n.published", &[("b", &b)], &[])))
            }
            Some(up) => {
                let n = self.outgoing_count(&b);
                let dst = up.split_once('/').map(|x| x.1.to_string()).unwrap_or(b.clone());
                let refspec = format!("{b}:{dst}");
                let rem = up.split_once('/').map(|x| x.0.to_string()).unwrap_or(remote);
                let o = self.run(&["push", &rem, &refspec]);
                if !o.ok() {
                    return self.push_failed(&o);
                }
                if o.stderr.contains("Everything up-to-date") {
                    return self.finish(true, Some(notice("info", "n.nothingToPush", &[], &[])));
                }
                self.finish(true, Some(notice("ok", "n.pushed", &[("n", &n.to_string()), ("u", &up)], &[])))
            }
        }
    }

    fn push_failed(&mut self, o: &Out) -> OpResult {
        let e = &o.stderr;
        if e.contains("[rejected]") || e.contains("fetch first") || e.contains("non-fast-forward") {
            return self.finish(false, Some(notice("error", "n.pushRejected", &[], &["pull", "sync"])));
        }
        self.fail(o)
    }

    pub fn sync(&mut self) -> OpResult {
        let mut pulled = self.pull();
        if !pulled.ok {
            return pulled;
        }
        let pushed = self.push(None);
        let mut log = std::mem::take(&mut pulled.log);
        log.extend(pushed.log);
        let nt = if pushed.ok {
            let up = self.current_branch().and_then(|b| self.upstream_of(&b)).unwrap_or_default();
            Some(notice("ok", "n.synced", &[("u", &up)], &[]))
        } else {
            pushed.notice
        };
        OpResult { ok: pushed.ok, notice: nt, log }
    }

    pub fn commit(&mut self, opt: CommitOptions) -> OpResult {
        if opt.message.trim().is_empty() {
            return self.finish(false, Some(notice("warn", "n.emptyMessage", &[], &[])));
        }
        let status = self.status();
        let any_staged = status.iter().any(|f| f.staged);
        if opt.all && !any_staged {
            let o = self.run(&["add", "--all"]);
            if !o.ok() {
                return self.fail(&o);
            }
        }
        let mut args = vec!["commit", "-m", opt.message.as_str()];
        if opt.amend {
            args.push("--amend");
        }
        let o = self.run(&args);
        if !o.ok() {
            if o.stdout.contains("nothing to commit") || o.stdout.contains("no changes added") {
                return self.finish(false, Some(notice("info", "n.nothingToCommit", &[], &[])));
            }
            return self.fail(&o);
        }
        let sha = self.raw(&["rev-parse", "--short=7", "HEAD"]).stdout.trim().to_string();
        let key = if opt.amend { "n.amended" } else { "n.committed" };
        let acts: &[&str] = if self.current_branch().is_some() { &["push", "sync"] } else { &[] };
        self.finish(true, Some(notice("ok", key, &[("sha", &sha)], acts)))
    }

    pub fn stage(&mut self, paths: Vec<String>) -> OpResult {
        let mut args = vec!["add", "--"];
        args.extend(paths.iter().map(String::as_str));
        let o = self.run(&args);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, None)
    }

    pub fn unstage(&mut self, paths: Vec<String>) -> OpResult {
        let has_head = self.raw(&["rev-parse", "-q", "--verify", "HEAD"]).ok();
        let mut args = if has_head { vec!["restore", "--staged", "--"] } else { vec!["rm", "--cached", "-r", "-q", "--"] };
        args.extend(paths.iter().map(String::as_str));
        let o = self.run(&args);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, None)
    }

    /// Discard unstaged changes. Untracked files are deleted with `git clean`.
    pub fn discard(&mut self, paths: Vec<String>) -> OpResult {
        let status = self.status();
        let (untracked, tracked): (Vec<String>, Vec<String>) = paths.into_iter().partition(|p| {
            status.iter().any(|f| &f.path == p && !f.staged && f.st == "A")
        });
        if !tracked.is_empty() {
            let mut a = vec!["restore", "--"];
            a.extend(tracked.iter().map(String::as_str));
            let o = self.run(&a);
            if !o.ok() { return self.fail(&o); }
        }
        if !untracked.is_empty() {
            let mut a = vec!["clean", "-f", "--"];
            a.extend(untracked.iter().map(String::as_str));
            let o = self.run(&a);
            if !o.ok() { return self.fail(&o); }
        }
        self.finish(true, None)
    }

    pub fn discard_all(&mut self) -> OpResult {
        let o = self.run(&["restore", "--worktree", "--", "."]);
        if !o.ok() && !o.stderr.contains("did not match") { return self.fail(&o); }
        let o = self.run(&["clean", "-fd"]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, None)
    }

    pub fn checkout(&mut self, r#ref: &str, kind: &str) -> OpResult {
        let o = match kind {
            "local" => self.run(&["switch", r#ref]),
            "remote" => {
                let local = r#ref.split_once('/').map(|x| x.1).unwrap_or(r#ref).to_string();
                let exists = self.raw(&["rev-parse", "-q", "--verify", &format!("refs/heads/{local}")]).ok();
                if exists { self.run(&["switch", &local]) } else { self.run(&["switch", "--track", r#ref]) }
            }
            _ => self.run(&["switch", "--detach", r#ref]),
        };
        if !o.ok() {
            if o.stderr.contains("would be overwritten") {
                return self.finish(false, Some(notice("error", "n.checkoutBlocked", &[], &["stash"])));
            }
            return self.fail(&o);
        }
        match self.current_branch() {
            Some(b) => self.finish(true, Some(notice("ok", "n.checkedOut", &[("b", &b)], &[]))),
            None => {
                let sha = self.raw(&["rev-parse", "--short=7", "HEAD"]).stdout.trim().to_string();
                self.finish(true, Some(notice("warn", "n.detachedAt", &[("sha", &sha)], &["newBranch"])))
            }
        }
    }

    pub fn create_branch(&mut self, name: &str, from: &str, checkout: bool) -> OpResult {
        let o = if checkout {
            self.run(&["switch", "-c", name, from])
        } else {
            self.run(&["branch", "--no-track", name, from])
        };
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("ok", "n.branchCreated", &[("b", name)], &["push"])))
    }

    pub fn delete_ref(&mut self, r#ref: &str, kind: &str, force: bool) -> OpResult {
        let o = match kind {
            "local" => self.run(&["branch", if force { "-D" } else { "-d" }, r#ref]),
            "remote" => {
                let (remote, name) = r#ref.split_once('/').unwrap_or(("origin", r#ref));
                self.run(&["push", remote, "--delete", name])
            }
            _ => self.run(&["tag", "-d", r#ref]),
        };
        if !o.ok() {
            if o.stderr.contains("not fully merged") {
                return self.finish(false, Some(notice("warn", "n.notMerged", &[("b", r#ref)], &[])));
            }
            return self.fail(&o);
        }
        self.finish(true, Some(notice("ok", "n.deleted", &[("b", r#ref)], &[])))
    }

    pub fn merge(&mut self, r#ref: &str) -> OpResult {
        let b = self.current_branch().unwrap_or_else(|| "HEAD".into());
        let o = self.run(&["merge", "--no-edit", r#ref]);
        if !o.ok() {
            if self.in_progress().as_deref() == Some("merge") {
                return self.finish(false, Some(notice("error", "n.conflicts", &[("op", "merge")], &["mergeAbort"])));
            }
            return self.fail(&o);
        }
        if o.stdout.contains("Already up to date") {
            return self.finish(true, Some(notice("info", "n.alreadyContains", &[("a", r#ref), ("b", &b)], &[])));
        }
        let key = if o.stdout.contains("Fast-forward") { "n.ff" } else { "n.merged" };
        self.finish(true, Some(notice("ok", key, &[("a", r#ref), ("b", &b)], &["push"])))
    }

    pub fn rebase(&mut self, onto: &str) -> OpResult {
        let b = self.current_branch().unwrap_or_else(|| "HEAD".into());
        let n = self.raw(&["rev-list", "--count", "--no-merges", &format!("{onto}..HEAD")]).stdout.trim().to_string();
        let o = self.run(&["rebase", onto]);
        if !o.ok() {
            if self.in_progress().as_deref() == Some("rebase") {
                return self.finish(false, Some(notice("error", "n.conflicts", &[("op", "rebase")], &["rebaseAbort"])));
            }
            return self.fail(&o);
        }
        if o.stdout.contains("is up to date") || o.stderr.contains("is up to date") {
            return self.finish(true, Some(notice("info", "n.upToDateRebase", &[("a", onto), ("b", &b)], &[])));
        }
        self.finish(true, Some(notice("ok", "n.rebased", &[("a", onto), ("b", &b), ("n", &n)], &["push"])))
    }

    pub fn reset(&mut self, sha: &str, mode: &str) -> OpResult {
        let flag = if mode == "hard" { "--hard" } else if mode == "soft" { "--soft" } else { "--mixed" };
        let o = self.run(&["reset", flag, sha]);
        if !o.ok() { return self.fail(&o); }
        let b = self.current_branch().unwrap_or_else(|| "HEAD".into());
        let short = self.raw(&["rev-parse", "--short=7", sha]).stdout.trim().to_string();
        let key = if mode == "soft" { "n.undone" } else { "n.reset" };
        self.finish(true, Some(notice("ok", key, &[("b", &b), ("sha", &short), ("mode", flag)], &[])))
    }

    pub fn cherry_pick(&mut self, sha: &str) -> OpResult {
        let short = self.raw(&["rev-parse", "--short=7", sha]).stdout.trim().to_string();
        let o = self.run(&["cherry-pick", sha]);
        if !o.ok() {
            if self.in_progress().as_deref() == Some("cherry-pick") {
                return self.finish(false, Some(notice("error", "n.conflicts", &[("op", "cherry-pick")], &["cherryAbort"])));
            }
            return self.fail(&o);
        }
        let b = self.current_branch().unwrap_or_else(|| "HEAD".into());
        self.finish(true, Some(notice("ok", "n.cherry", &[("sha", &short), ("b", &b)], &["push"])))
    }

    pub fn revert(&mut self, sha: &str) -> OpResult {
        let short = self.raw(&["rev-parse", "--short=7", sha]).stdout.trim().to_string();
        let o = self.run(&["revert", "--no-edit", sha]);
        if !o.ok() {
            if self.in_progress().as_deref() == Some("revert") {
                return self.finish(false, Some(notice("error", "n.conflicts", &[("op", "revert")], &["revertAbort"])));
            }
            return self.fail(&o);
        }
        self.finish(true, Some(notice("ok", "n.reverted", &[("sha", &short)], &["push"])))
    }

    /// Abort a merge / rebase / cherry-pick / revert in progress.
    pub fn abort(&mut self, op: &str) -> OpResult {
        let o = self.run(&[op, "--abort"]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("info", "n.aborted", &[("op", op)], &[])))
    }

    pub fn tag(&mut self, name: &str, sha: &str, msg: &str) -> OpResult {
        let o = if msg.is_empty() { self.run(&["tag", name, sha]) } else { self.run(&["tag", "-a", name, "-m", msg, sha]) };
        if !o.ok() { return self.fail(&o); }
        let short = self.raw(&["rev-parse", "--short=7", sha]).stdout.trim().to_string();
        self.finish(true, Some(notice("ok", "n.tagCreated", &[("t", name), ("sha", &short)], &[])))
    }

    pub fn stash_push(&mut self) -> OpResult {
        let n = self.status().len();
        if n == 0 {
            return self.finish(true, Some(notice("info", "n.nothingToStash", &[], &[])));
        }
        let o = self.run(&["stash", "push", "--include-untracked"]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("ok", "n.stashed", &[("n", &n.to_string())], &[])))
    }

    pub fn stash_apply(&mut self, id: &str, pop: bool) -> OpResult {
        let o = self.run(&["stash", if pop { "pop" } else { "apply" }, id]);
        if !o.ok() {
            if o.stdout.contains("CONFLICT") {
                return self.finish(false, Some(notice("error", "n.conflicts", &[("op", "stash")], &[])));
            }
            return self.fail(&o);
        }
        self.finish(true, Some(notice("ok", if pop { "n.popped" } else { "n.applied" }, &[("s", id)], &[])))
    }

    pub fn stash_drop(&mut self, id: &str) -> OpResult {
        let o = self.run(&["stash", "drop", id]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("ok", "n.dropped", &[("s", id)], &[])))
    }

    pub fn worktree_add(&mut self, path: &str, branch: &str, from: &str) -> OpResult {
        let o = self.run(&["worktree", "add", "-b", branch, path, from]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("ok", "n.worktree", &[("p", path)], &[])))
    }

    pub fn worktree_remove(&mut self, path: &str) -> OpResult {
        let o = self.run(&["worktree", "remove", path]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, None)
    }

    pub fn submodule_add(&mut self, url: &str, path: &str) -> OpResult {
        let o = self.run(&["submodule", "add", url, path]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, Some(notice("ok", "n.submodule", &[("p", path)], &[])))
    }

    pub fn submodule_remove(&mut self, path: &str) -> OpResult {
        let o = self.run(&["rm", "-f", path]);
        if !o.ok() { return self.fail(&o); }
        self.finish(true, None)
    }

    pub fn set_identity(&mut self, name: &str, email: &str) -> OpResult {
        if !name.is_empty() { let _ = self.run(&["config", "--global", "user.name", name]); }
        if !email.is_empty() { let _ = self.run(&["config", "--global", "user.email", email]); }
        self.finish(true, None)
    }

    // --- pull requests through the GitHub CLI (`gh`), when installed -------

    fn gh(&mut self, args: &[&str]) -> Option<Out> {
        let o = Command::new("gh").current_dir(&self.dir).env("GH_PROMPT_DISABLED", "1").env("NO_COLOR", "1").args(args).output().ok()?;
        let out = Out {
            code: o.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&o.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&o.stderr).into_owned(),
        };
        self.log.push(LogEntry { cmd: format!("gh {}", args.join(" ")), lines: out.lines(), err: !out.ok() });
        Some(out)
    }

    pub fn pr_list(&mut self) -> Result<Vec<PullRequest>, String> {
        let Some(o) = self.gh(&["pr", "list", "--state", "all", "--limit", "30", "--json", "number,title,body,headRefName,baseRefName,state,isDraft,createdAt"]) else {
            return Err("gh-missing".into());
        };
        if !o.ok() { return Err(o.stderr.trim().to_string()); }
        let v: serde_json::Value = serde_json::from_str(&o.stdout).map_err(|e| e.to_string())?;
        Ok(v.as_array().cloned().unwrap_or_default().iter().map(|p| {
            let state = p["state"].as_str().unwrap_or("OPEN");
            let status = if p["isDraft"].as_bool().unwrap_or(false) && state == "OPEN" { "draft" }
                else { match state { "MERGED" => "completed", "CLOSED" => "abandoned", _ => "open" } };
            PullRequest {
                id: p["number"].as_u64().unwrap_or(0),
                title: p["title"].as_str().unwrap_or("").into(),
                desc: p["body"].as_str().unwrap_or("").into(),
                source: p["headRefName"].as_str().unwrap_or("").into(),
                target: p["baseRefName"].as_str().unwrap_or("").into(),
                status: status.into(),
                t: 0,
            }
        }).collect())
    }

    pub fn pr_create(&mut self, source: &str, target: &str, title: &str, body: &str, draft: bool) -> OpResult {
        let mut args = vec!["pr", "create", "--head", source, "--base", target, "--title", title, "--body", body];
        if draft { args.push("--draft"); }
        match self.gh(&args) {
            None => self.finish(false, Some(notice("error", "n.ghMissing", &[], &[]))),
            Some(o) if !o.ok() => self.fail(&o),
            Some(o) => {
                let n = o.stdout.trim().rsplit('/').next().unwrap_or("").to_string();
                self.finish(true, Some(notice("ok", "n.prCreated", &[("n", &n)], &[])))
            }
        }
    }

    pub fn pr_merge(&mut self, id: u64, close: bool) -> OpResult {
        let n = id.to_string();
        let args: Vec<&str> = if close { vec!["pr", "close", &n] } else { vec!["pr", "merge", &n, "--merge"] };
        match self.gh(&args) {
            None => self.finish(false, Some(notice("error", "n.ghMissing", &[], &[]))),
            Some(o) if !o.ok() => self.fail(&o),
            Some(_) => {
                let key = if close { "n.prAbandoned" } else { "n.prCompleted" };
                let acts: &[&str] = if close { &[] } else { &["fetch", "pull"] };
                self.finish(true, Some(notice("ok", key, &[("n", &n)], acts)))
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Repository creation (no repo yet, so these are free functions)
// ---------------------------------------------------------------------------

pub fn clone(url: &str, dest: &str) -> Result<(String, OpResult), String> {
    let parent = Path::new(dest).parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."));
    std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;
    let mut r = Repo { dir: parent, log: Vec::new() };
    let o = r.run(&["clone", "--progress", url, dest]);
    if !o.ok() {
        return Ok((String::new(), r.fail(&o)));
    }
    let name = Path::new(dest).file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let res = r.finish(true, Some(notice("ok", "n.cloned", &[("r", &name)], &[])));
    Ok((dest.to_string(), res))
}

pub fn init(dest: &str, default_branch: &str, readme: bool) -> Result<(String, OpResult), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let mut r = Repo { dir: PathBuf::from(dest), log: Vec::new() };
    let o = r.run(&["init", "-b", default_branch]);
    if !o.ok() {
        return Ok((String::new(), r.fail(&o)));
    }
    let name = r.dir.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    if readme {
        std::fs::write(r.dir.join("README.md"), format!("# {name}\n")).map_err(|e| e.to_string())?;
        r.run(&["add", "README.md"]);
        let c = r.run(&["commit", "-m", "Initial commit"]);
        if !c.ok() {
            return Ok((dest.to_string(), r.fail(&c)));
        }
    }
    let res = r.finish(true, Some(notice("ok", "n.repoCreated", &[("r", &name)], &[])));
    Ok((dest.to_string(), res))
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/// Git couldn't authenticate. Over HTTPS to github.com, signing in to GitHub from
/// GitDesk fixes it (see github.rs); an SSH key it can't help with. The SSH check
/// wants "Permission denied (publickey…)" — a bare "Permission denied" is usually
/// a file-system error.
fn auth_notice(o: &Out) -> Option<Notice> {
    let e = &o.stderr;
    let https = e.contains("Authentication failed") || e.contains("could not read Username") || e.contains("could not read Password");
    if https && e.contains("https://github.com") {
        return Some(notice("error", "n.authFailed", &[], &["signIn"]));
    }
    (https || e.contains("Permission denied (")).then(|| notice("error", "n.authFailed", &[], &[]))
}

fn notice(kind: &str, key: &str, vars: &[(&str, &str)], actions: &[&str]) -> Notice {
    Notice {
        kind: kind.into(),
        key: key.into(),
        vars: vars.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
        actions: actions.iter().map(|s| s.to_string()).collect(),
    }
}

/// `[ahead 2, behind 1]`, `[gone]`, or empty.
pub fn parse_track(s: &str) -> (Option<u32>, Option<u32>, bool) {
    if s.contains("gone") {
        return (None, None, true);
    }
    let num = |label: &str| -> Option<u32> {
        s.find(label).and_then(|i| s[i + label.len()..].trim_start().split(|c: char| !c.is_ascii_digit()).next()?.parse().ok())
    };
    let (a, b) = (num("ahead"), num("behind"));
    if s.is_empty() { (Some(0), Some(0), false) } else { (Some(a.unwrap_or(0)), Some(b.unwrap_or(0)), false) }
}

/// Parse `git status --porcelain=v1 -z`. A path that is both staged and
/// modified again in the working tree appears twice, once per side.
pub fn parse_status(z: &str) -> Vec<WorkFile> {
    let mut out = Vec::new();
    let mut it = z.split('\0').filter(|s| !s.is_empty());
    while let Some(entry) = it.next() {
        if entry.len() < 4 {
            continue;
        }
        let x = &entry[0..1];
        let y = &entry[1..2];
        let path = entry[3..].to_string();
        let renamed = x == "R" || x == "C";
        let from = if renamed { it.next().map(String::from) } else { None };
        if x == "?" {
            out.push(WorkFile { path, st: "A".into(), from: None, staged: false });
            continue;
        }
        if x == "U" || y == "U" || (x == "A" && y == "A") || (x == "D" && y == "D") {
            out.push(WorkFile { path, st: "U".into(), from: None, staged: false });
            continue;
        }
        if x != " " {
            let st = match x { "R" => "R", "C" | "A" => "A", "D" => "D", _ => "M" };
            out.push(WorkFile { path: path.clone(), st: st.into(), from: from.clone(), staged: true });
        }
        if y != " " {
            let st = match y { "D" => "D", "A" => "A", _ => "M" };
            out.push(WorkFile { path, st: st.into(), from: None, staged: false });
        }
    }
    out
}

pub fn parse_name_status(s: &str) -> Vec<FileChange> {
    s.lines()
        .filter_map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            let code = f.first()?.chars().next()?;
            match code {
                'R' | 'C' if f.len() >= 3 => Some(FileChange { st: if code == 'R' { "R".into() } else { "A".into() }, path: f[2].into(), from: Some(f[1].into()) }),
                'A' | 'M' | 'D' | 'T' if f.len() >= 2 => Some(FileChange { st: if code == 'T' { "M".into() } else { code.to_string() }, path: f[1].into(), from: None }),
                _ => None,
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Tests — run with `cargo test` inside src-tauri/. They create throwaway repos.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn sh(dir: &Path, args: &[&str]) {
        let o = git_command(dir).args(args).output().unwrap();
        assert!(o.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&o.stderr));
    }

    /// A bare "origin" plus a clone with one commit on main.
    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let tmp = tempfile::tempdir().unwrap();
        let origin = tmp.path().join("origin.git");
        let work = tmp.path().join("work");
        sh(tmp.path(), &["init", "--bare", "-b", "main", origin.to_str().unwrap()]);
        sh(tmp.path(), &["clone", origin.to_str().unwrap(), work.to_str().unwrap()]);
        sh(&work, &["config", "user.name", "Test"]);
        sh(&work, &["config", "user.email", "t@example.com"]);
        sh(&work, &["switch", "-c", "main"]);
        fs::write(work.join("a.txt"), "one\n").unwrap();
        sh(&work, &["add", "."]);
        sh(&work, &["commit", "-m", "first"]);
        sh(&work, &["push", "-u", "origin", "main"]);
        (tmp, origin, work)
    }

    #[test]
    fn status_parsing() {
        let z = "M  a.txt\0 M b.txt\0MM c.txt\0R  new.txt\0old.txt\0?? d.txt\0UU e.txt\0";
        let v = parse_status(z);
        assert_eq!(v.len(), 7);
        assert_eq!(v[0], WorkFile { path: "a.txt".into(), st: "M".into(), from: None, staged: true });
        assert!(!v[1].staged);
        assert!(v[2].staged && !v[3].staged && v[3].path == "c.txt");
        assert_eq!(v[4].from.as_deref(), Some("old.txt"));
        assert_eq!(v[5].st, "A");
        assert_eq!(v[6].st, "U");
    }

    #[test]
    fn track_parsing() {
        assert_eq!(parse_track("[ahead 2, behind 1]"), (Some(2), Some(1), false));
        assert_eq!(parse_track("[behind 3]"), (Some(0), Some(3), false));
        assert_eq!(parse_track(""), (Some(0), Some(0), false));
        assert_eq!(parse_track("[gone]"), (None, None, true));
    }

    #[test]
    fn snapshot_commit_push_flow() {
        let (_t, _origin, work) = setup();
        let mut r = Repo::open(work.to_str().unwrap()).unwrap();
        let s = r.snapshot();
        assert_eq!(s.head.branch.as_deref(), Some("main"));
        assert_eq!(s.commits.len(), 1);
        assert!(s.remotes.contains_key("origin/main"));
        assert_eq!(s.branches["main"].upstream.as_deref(), Some("origin/main"));

        fs::write(work.join("a.txt"), "two\n").unwrap();
        fs::write(work.join("b.txt"), "new\n").unwrap();
        assert_eq!(r.status().len(), 2);
        let c = r.commit(CommitOptions { message: "second".into(), amend: false, all: true });
        assert!(c.ok, "{:?}", c.log);
        assert_eq!(c.notice.as_ref().unwrap().key, "n.committed");
        let s = r.snapshot();
        assert_eq!(s.branches["main"].ahead, Some(1));
        let p = r.push(None);
        assert!(p.ok, "{:?}", p.log);
        assert_eq!(p.notice.unwrap().key, "n.pushed");
        assert_eq!(r.snapshot().branches["main"].ahead, Some(0));
    }

    #[test]
    fn rejected_push_then_sync() {
        let (tmp, origin, work) = setup();
        // a teammate pushes first
        let other = tmp.path().join("other");
        sh(tmp.path(), &["clone", origin.to_str().unwrap(), other.to_str().unwrap()]);
        sh(&other, &["config", "user.name", "Mate"]);
        sh(&other, &["config", "user.email", "m@example.com"]);
        fs::write(other.join("c.txt"), "mate\n").unwrap();
        sh(&other, &["add", "."]);
        sh(&other, &["commit", "-m", "teammate"]);
        sh(&other, &["push"]);

        let mut r = Repo::open(work.to_str().unwrap()).unwrap();
        fs::write(work.join("d.txt"), "mine\n").unwrap();
        assert!(r.commit(CommitOptions { message: "mine".into(), amend: false, all: true }).ok);
        let p = r.push(None);
        assert!(!p.ok);
        assert_eq!(p.notice.unwrap().key, "n.pushRejected");
        let f = r.fetch(true);
        assert_eq!(f.notice.unwrap().vars["n"], "1");
        let s = r.sync();
        assert!(s.ok, "{:?}", s.log);
        let snap = r.snapshot();
        assert_eq!(snap.branches["main"].ahead, Some(0));
        assert_eq!(snap.branches["main"].behind, Some(0));
        // merge commit has two parents
        let head = &snap.commits[&snap.branches["main"].tip];
        assert_eq!(head.parents.len(), 2);
    }

    #[test]
    fn branches_stash_tags_reset() {
        let (_t, _origin, work) = setup();
        let mut r = Repo::open(work.to_str().unwrap()).unwrap();
        assert!(r.create_branch("feature/x", "main", true).ok);
        fs::write(work.join("x.txt"), "x\n").unwrap();
        assert!(r.commit(CommitOptions { message: "x".into(), amend: false, all: true }).ok);
        assert!(r.checkout("main", "local").ok);
        let m = r.merge("feature/x");
        assert_eq!(m.notice.unwrap().key, "n.ff");
        let tip = r.snapshot().branches["main"].tip.clone();
        assert!(r.tag("v1.0.0", &tip, "first release").ok);
        assert_eq!(r.snapshot().tags["v1.0.0"], tip);
        assert!(r.delete_ref("feature/x", "local", false).ok);

        fs::write(work.join("a.txt"), "dirty\n").unwrap();
        assert!(r.stash_push().ok);
        assert!(r.status().is_empty());
        let s = r.snapshot();
        assert_eq!(s.stashes.len(), 1);
        assert!(r.stash_apply(&s.stashes[0].id, true).ok);
        assert_eq!(r.status().len(), 1);
        assert!(r.discard(vec!["a.txt".into()]).ok);
        assert!(r.status().is_empty());

        let first = r.snapshot().commits.values().find(|c| c.msg == "first").unwrap().sha.clone();
        assert!(r.reset(&first, "mixed").ok);
        assert_eq!(r.status().len(), 1);
        assert_eq!(commit_files_names(&r, &first), vec!["a.txt"]);
    }

    fn commit_files_names(r: &Repo, sha: &str) -> Vec<String> {
        r.commit_files(sha).into_iter().map(|f| f.path).collect()
    }

    #[test]
    fn conflicts_are_reported_and_abortable() {
        let (_t, _origin, work) = setup();
        let mut r = Repo::open(work.to_str().unwrap()).unwrap();
        assert!(r.create_branch("other", "main", true).ok);
        fs::write(work.join("a.txt"), "other\n").unwrap();
        assert!(r.commit(CommitOptions { message: "o".into(), amend: false, all: true }).ok);
        assert!(r.checkout("main", "local").ok);
        fs::write(work.join("a.txt"), "main\n").unwrap();
        assert!(r.commit(CommitOptions { message: "m".into(), amend: false, all: true }).ok);
        let m = r.merge("other");
        assert!(!m.ok);
        assert_eq!(m.notice.as_ref().unwrap().key, "n.conflicts");
        assert!(r.snapshot().work.iter().any(|f| f.st == "U"));
        assert_eq!(r.snapshot().in_progress.as_deref(), Some("merge"));
        assert!(r.abort("merge").ok);
        assert!(r.snapshot().in_progress.is_none());
    }

    #[test]
    fn init_and_diff() {
        let tmp = tempfile::tempdir().unwrap();
        let dest = tmp.path().join("fresh");
        std::env::set_var("GIT_AUTHOR_NAME", "T");
        std::env::set_var("GIT_AUTHOR_EMAIL", "t@e.com");
        std::env::set_var("GIT_COMMITTER_NAME", "T");
        std::env::set_var("GIT_COMMITTER_EMAIL", "t@e.com");
        let (p, res) = init(dest.to_str().unwrap(), "main", true).unwrap();
        assert!(res.ok, "{:?}", res.log);
        let r = Repo::open(&p).unwrap();
        assert_eq!(r.snapshot().commits.len(), 1);
        fs::write(dest.join("README.md"), "# fresh\nmore\n").unwrap();
        fs::write(dest.join("new.txt"), "hello\n").unwrap();
        assert!(r.diff("README.md", "work", false).contains("+more"));
        assert!(r.diff("new.txt", "work", true).contains("+hello"));
    }

    #[test]
    fn auth_failures_offer_github_sign_in() {
        let out = |e: &str| Out { code: 128, stdout: String::new(), stderr: e.into() };
        let n = auth_notice(&out("fatal: could not read Username for 'https://github.com': terminal prompts disabled")).unwrap();
        assert_eq!((n.key.as_str(), n.actions.clone()), ("n.authFailed", vec!["signIn".to_string()]));
        let ssh = auth_notice(&out("git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.")).unwrap();
        assert!(ssh.actions.is_empty());
        let other_host = auth_notice(&out("fatal: Authentication failed for 'https://gitlab.com/a/b.git/'")).unwrap();
        assert!(other_host.actions.is_empty());
        assert!(auth_notice(&out("error: unable to unlink old 'a.txt': Permission denied")).is_none());
    }
}
