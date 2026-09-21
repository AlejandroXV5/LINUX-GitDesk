import { invoke } from '@tauri-apps/api/core';
import type { FileChange, OpResult, PullRequest, Snapshot } from '../core/model';
import type { GitBackend } from './types';

/** True when running inside the Tauri shell (false in a plain browser via `npm run dev`). */
export const inTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const op = (cmd: string, args: Record<string, unknown>) => invoke<OpResult>(cmd, args);

export const TauriBackend: GitBackend = {
  kind: 'tauri',
  open: path => invoke<Snapshot>('repo_open', { path }),
  snapshot: path => invoke<Snapshot>('repo_snapshot', { path }),
  clone: async (url, dest) => { const [path, result] = await invoke<[string, OpResult]>('repo_clone', { url, dest }); return { path, result }; },
  init: async (dest, defaultBranch, readme) => { const [path, result] = await invoke<[string, OpResult]>('repo_init', { dest, defaultBranch, readme }); return { path, result }; },

  commitFiles: (path, sha) => invoke<FileChange[]>('commit_files', { path, sha }),
  stashFiles: (path, id) => invoke<FileChange[]>('stash_files', { path, id }),
  compareFiles: (path, a, b) => invoke<FileChange[]>('compare_files', { path, a, b }),
  diff: (path, file, ctx, untracked) => invoke<string>('diff', { path, file, ctx, untracked }),

  fetch: (path, prune) => op('git_fetch', { path, prune }),
  pull: path => op('git_pull', { path }),
  push: (path, branch) => op('git_push', { path, branch: branch ?? null }),
  sync: path => op('git_sync', { path }),
  commit: (path, opts) => op('git_commit', { path, opts }),
  stage: (path, files) => op('git_stage', { path, files }),
  unstage: (path, files) => op('git_unstage', { path, files }),
  discard: (path, files) => op('git_discard', { path, files }),
  discardAll: path => op('git_discard_all', { path }),
  checkout: (path, target, kind) => op('git_checkout', { path, target, kind }),
  createBranch: (path, name, from, checkout) => op('git_create_branch', { path, name, from, checkout }),
  deleteRef: (path, target, kind, force) => op('git_delete_ref', { path, target, kind, force }),
  merge: (path, target) => op('git_merge', { path, target }),
  rebase: (path, onto) => op('git_rebase', { path, onto }),
  reset: (path, sha, mode) => op('git_reset', { path, sha, mode }),
  cherryPick: (path, sha) => op('git_cherry_pick', { path, sha }),
  revert: (path, sha) => op('git_revert', { path, sha }),
  abort: (path, o) => op('git_abort', { path, op: o }),
  tag: (path, name, sha, msg) => op('git_tag', { path, name, sha, msg }),
  stashPush: path => op('git_stash_push', { path }),
  stashApply: (path, id, pop) => op('git_stash_apply', { path, id, pop }),
  stashDrop: (path, id) => op('git_stash_drop', { path, id }),
  worktreeAdd: (path, dir, branch, from) => op('git_worktree_add', { path, dir, branch, from }),
  worktreeRemove: (path, dir) => op('git_worktree_remove', { path, dir }),
  submoduleAdd: (path, url, dir) => op('git_submodule_add', { path, url, dir }),
  submoduleRemove: (path, dir) => op('git_submodule_remove', { path, dir }),
  setIdentity: (path, name, email) => op('git_set_identity', { path, name, email }),

  prList: path => invoke<PullRequest[]>('pr_list', { path }),
  prCreate: (path, source, target, title, body, draft) => op('pr_create', { path, source, target, title, body, draft }),
  prMerge: (path, id, close) => op('pr_merge', { path, id, close })
};

/** Native folder picker (Tauri) — returns null in the browser or when cancelled. */
export async function pickFolder(title: string): Promise<string | null> {
  if (!inTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const r = await open({ directory: true, multiple: false, title });
  return typeof r === 'string' ? r : null;
}
export async function openExternal(url: string): Promise<boolean> {
  if (!inTauri()) return false;
  const { openUrl } = await import('@tauri-apps/plugin-opener');
  await openUrl(url);
  return true;
}
export async function setWindowTitle(title: string) {
  document.title = title;
  if (!inTauri()) return;
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setTitle(title);
  } catch { /* title permission missing — harmless */ }
}
export async function closeWindow(): Promise<boolean> {
  if (!inTauri()) return false;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  await getCurrentWindow().close();
  return true;
}
