//! Tauri entry point: every `#[tauri::command]` below is callable from the
//! frontend with `invoke('<name>', {...})` (see src/backend/tauri.ts).
//!
//! Commands are `async` so Tauri runs them off the UI thread — git can take
//! seconds on a large repository or a slow network.

mod git;
mod github;

use git::{CommitOptions, FileChange, OpResult, PullRequest, Repo, Snapshot};
use github::Account;

type R<T> = Result<T, String>;

fn repo(path: &str) -> R<Repo> {
    Repo::open(path)
}

/// A repository passed on the command line: `gitdesk ~/src/project`.
#[tauri::command]
fn startup_repo() -> Option<String> {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'))?;
    let p = std::fs::canonicalize(arg).ok()?;
    Some(p.to_string_lossy().into_owned())
}

#[tauri::command]
async fn repo_open(path: String) -> R<Snapshot> {
    Ok(repo(&path)?.snapshot())
}

#[tauri::command]
async fn repo_snapshot(path: String) -> R<Snapshot> {
    Ok(repo(&path)?.snapshot())
}

#[tauri::command]
async fn repo_clone(url: String, dest: String) -> R<(String, OpResult)> {
    git::clone(&url, &dest)
}

#[tauri::command]
async fn repo_init(dest: String, default_branch: String, readme: bool) -> R<(String, OpResult)> {
    git::init(&dest, &default_branch, readme)
}

#[tauri::command]
async fn commit_files(path: String, sha: String) -> R<Vec<FileChange>> {
    Ok(repo(&path)?.commit_files(&sha))
}

#[tauri::command]
async fn stash_files(path: String, id: String) -> R<Vec<FileChange>> {
    Ok(repo(&path)?.stash_files(&id))
}

#[tauri::command]
async fn compare_files(path: String, a: String, b: String) -> R<Vec<FileChange>> {
    Ok(repo(&path)?.compare_files(&a, &b))
}

#[tauri::command]
async fn diff(path: String, file: String, ctx: String, untracked: bool) -> R<String> {
    Ok(repo(&path)?.diff(&file, &ctx, untracked))
}

#[tauri::command]
async fn git_fetch(path: String, prune: bool) -> R<OpResult> {
    Ok(repo(&path)?.fetch(prune))
}

#[tauri::command]
async fn git_pull(path: String) -> R<OpResult> {
    Ok(repo(&path)?.pull())
}

#[tauri::command]
async fn git_push(path: String, branch: Option<String>) -> R<OpResult> {
    Ok(repo(&path)?.push(branch))
}

#[tauri::command]
async fn git_sync(path: String) -> R<OpResult> {
    Ok(repo(&path)?.sync())
}

#[tauri::command]
async fn git_commit(path: String, opts: CommitOptions) -> R<OpResult> {
    Ok(repo(&path)?.commit(opts))
}

#[tauri::command]
async fn git_stage(path: String, files: Vec<String>) -> R<OpResult> {
    Ok(repo(&path)?.stage(files))
}

#[tauri::command]
async fn git_unstage(path: String, files: Vec<String>) -> R<OpResult> {
    Ok(repo(&path)?.unstage(files))
}

#[tauri::command]
async fn git_discard(path: String, files: Vec<String>) -> R<OpResult> {
    Ok(repo(&path)?.discard(files))
}

#[tauri::command]
async fn git_discard_all(path: String) -> R<OpResult> {
    Ok(repo(&path)?.discard_all())
}

#[tauri::command]
async fn git_checkout(path: String, target: String, kind: String) -> R<OpResult> {
    Ok(repo(&path)?.checkout(&target, &kind))
}

#[tauri::command]
async fn git_create_branch(path: String, name: String, from: String, checkout: bool) -> R<OpResult> {
    Ok(repo(&path)?.create_branch(&name, &from, checkout))
}

#[tauri::command]
async fn git_delete_ref(path: String, target: String, kind: String, force: bool) -> R<OpResult> {
    Ok(repo(&path)?.delete_ref(&target, &kind, force))
}

#[tauri::command]
async fn git_merge(path: String, target: String) -> R<OpResult> {
    Ok(repo(&path)?.merge(&target))
}

#[tauri::command]
async fn git_rebase(path: String, onto: String) -> R<OpResult> {
    Ok(repo(&path)?.rebase(&onto))
}

#[tauri::command]
async fn git_reset(path: String, sha: String, mode: String) -> R<OpResult> {
    Ok(repo(&path)?.reset(&sha, &mode))
}

#[tauri::command]
async fn git_cherry_pick(path: String, sha: String) -> R<OpResult> {
    Ok(repo(&path)?.cherry_pick(&sha))
}

#[tauri::command]
async fn git_revert(path: String, sha: String) -> R<OpResult> {
    Ok(repo(&path)?.revert(&sha))
}

#[tauri::command]
async fn git_abort(path: String, op: String) -> R<OpResult> {
    let allowed = ["merge", "rebase", "cherry-pick", "revert"];
    if !allowed.contains(&op.as_str()) {
        return Err(format!("cannot abort '{op}'"));
    }
    Ok(repo(&path)?.abort(&op))
}

#[tauri::command]
async fn git_tag(path: String, name: String, sha: String, msg: String) -> R<OpResult> {
    Ok(repo(&path)?.tag(&name, &sha, &msg))
}

#[tauri::command]
async fn git_stash_push(path: String) -> R<OpResult> {
    Ok(repo(&path)?.stash_push())
}

#[tauri::command]
async fn git_stash_apply(path: String, id: String, pop: bool) -> R<OpResult> {
    Ok(repo(&path)?.stash_apply(&id, pop))
}

#[tauri::command]
async fn git_stash_drop(path: String, id: String) -> R<OpResult> {
    Ok(repo(&path)?.stash_drop(&id))
}

#[tauri::command]
async fn git_worktree_add(path: String, dir: String, branch: String, from: String) -> R<OpResult> {
    Ok(repo(&path)?.worktree_add(&dir, &branch, &from))
}

#[tauri::command]
async fn git_worktree_remove(path: String, dir: String) -> R<OpResult> {
    Ok(repo(&path)?.worktree_remove(&dir))
}

#[tauri::command]
async fn git_submodule_add(path: String, url: String, dir: String) -> R<OpResult> {
    Ok(repo(&path)?.submodule_add(&url, &dir))
}

#[tauri::command]
async fn git_submodule_remove(path: String, dir: String) -> R<OpResult> {
    Ok(repo(&path)?.submodule_remove(&dir))
}

#[tauri::command]
async fn git_set_identity(path: String, name: String, email: String) -> R<OpResult> {
    Ok(repo(&path)?.set_identity(&name, &email))
}

#[tauri::command]
async fn pr_list(path: String) -> R<Vec<PullRequest>> {
    repo(&path)?.pr_list()
}

#[tauri::command]
async fn pr_create(path: String, source: String, target: String, title: String, body: String, draft: bool) -> R<OpResult> {
    Ok(repo(&path)?.pr_create(&source, &target, &title, &body, draft))
}

#[tauri::command]
async fn pr_merge(path: String, id: u64, close: bool) -> R<OpResult> {
    Ok(repo(&path)?.pr_merge(id, close))
}

/// The GitHub account git has a credential for (never prompts).
#[tauri::command]
async fn github_account() -> R<Option<Account>> {
    github::current()
}

/// Sign in through git's credential helper. It can wait minutes for the browser
/// sign-in, so it runs on a blocking thread instead of an async worker.
#[tauri::command]
async fn github_sign_in() -> R<Account> {
    tauri::async_runtime::spawn_blocking(github::sign_in).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn github_sign_out() -> R<()> {
    github::sign_out()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            startup_repo,
            repo_open,
            repo_snapshot,
            repo_clone,
            repo_init,
            commit_files,
            stash_files,
            compare_files,
            diff,
            git_fetch,
            git_pull,
            git_push,
            git_sync,
            git_commit,
            git_stage,
            git_unstage,
            git_discard,
            git_discard_all,
            git_checkout,
            git_create_branch,
            git_delete_ref,
            git_merge,
            git_rebase,
            git_reset,
            git_cherry_pick,
            git_revert,
            git_abort,
            git_tag,
            git_stash_push,
            git_stash_apply,
            git_stash_drop,
            git_worktree_add,
            git_worktree_remove,
            git_submodule_add,
            git_submodule_remove,
            git_set_identity,
            pr_list,
            pr_create,
            pr_merge,
            github_account,
            github_sign_in,
            github_sign_out
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitDesk");
}
