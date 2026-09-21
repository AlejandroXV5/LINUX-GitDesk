import type { FileChange, OpResult, PullRequest, Snapshot } from '../core/model';

/**
 * Everything the UI can ask of a repository. Two implementations:
 * - TauriBackend: runs the real `git` CLI through Rust commands (src-tauri/src/git.rs)
 * - MockBackend:  an in-memory repository (the prototype's), used in the browser
 *                 and for the "demo repository" inside the app.
 * `path` is a filesystem path for Tauri and `demo://<name>` for the mock.
 */
export interface GitBackend {
  readonly kind: 'tauri' | 'mock';
  open(path: string): Promise<Snapshot>;
  snapshot(path: string): Promise<Snapshot>;
  clone(url: string, dest: string): Promise<{ path: string; result: OpResult }>;
  init(dest: string, defaultBranch: string, readme: boolean): Promise<{ path: string; result: OpResult }>;

  commitFiles(path: string, sha: string): Promise<FileChange[]>;
  stashFiles(path: string, id: string): Promise<FileChange[]>;
  compareFiles(path: string, a: string, b: string): Promise<FileChange[]>;
  /** ctx: 'work' | 'staged' | <sha> | 'stash:<id>' | 'cmp:<a>..<b>' — returns a unified diff */
  diff(path: string, file: string, ctx: string, untracked: boolean): Promise<string>;

  fetch(path: string, prune: boolean): Promise<OpResult>;
  pull(path: string): Promise<OpResult>;
  push(path: string, branch?: string | null): Promise<OpResult>;
  sync(path: string): Promise<OpResult>;
  commit(path: string, opts: { message: string; amend: boolean; all: boolean }): Promise<OpResult>;
  stage(path: string, files: string[]): Promise<OpResult>;
  unstage(path: string, files: string[]): Promise<OpResult>;
  discard(path: string, files: string[]): Promise<OpResult>;
  discardAll(path: string): Promise<OpResult>;
  checkout(path: string, target: string, kind: string): Promise<OpResult>;
  createBranch(path: string, name: string, from: string, checkout: boolean): Promise<OpResult>;
  deleteRef(path: string, target: string, kind: string, force: boolean): Promise<OpResult>;
  merge(path: string, target: string): Promise<OpResult>;
  rebase(path: string, onto: string): Promise<OpResult>;
  reset(path: string, sha: string, mode: 'soft' | 'mixed' | 'hard'): Promise<OpResult>;
  cherryPick(path: string, sha: string): Promise<OpResult>;
  revert(path: string, sha: string): Promise<OpResult>;
  abort(path: string, op: string): Promise<OpResult>;
  tag(path: string, name: string, sha: string, msg: string): Promise<OpResult>;
  stashPush(path: string): Promise<OpResult>;
  stashApply(path: string, id: string, pop: boolean): Promise<OpResult>;
  stashDrop(path: string, id: string): Promise<OpResult>;
  worktreeAdd(path: string, dir: string, branch: string, from: string): Promise<OpResult>;
  worktreeRemove(path: string, dir: string): Promise<OpResult>;
  submoduleAdd(path: string, url: string, dir: string): Promise<OpResult>;
  submoduleRemove(path: string, dir: string): Promise<OpResult>;
  setIdentity(path: string, name: string, email: string): Promise<OpResult>;

  prList(path: string): Promise<PullRequest[]>;
  prCreate(path: string, source: string, target: string, title: string, body: string, draft: boolean): Promise<OpResult>;
  prMerge(path: string, id: number, close: boolean): Promise<OpResult>;

  /** Demo-only helpers used by Tools → Simulate. */
  simulateEdit?(path: string): string;
  simulateTeammate?(path: string): { who: string; b: string } | null;
}
