import { invoke } from '@tauri-apps/api/core';
import type { Issue } from '../core/model';
import { sleep } from '../core/util';
import { inTauri } from './tauri';

/**
 * The GitHub account is the github.com credential git already uses for Push/Pull
 * (see src-tauri/src/github.rs). Signing in runs git's credential helper — Git
 * Credential Manager opens GitHub's sign-in in the browser. The token stays in Rust.
 */
export interface Account {
  login: string;
  name: string;
  /** Public profile email, or the account's noreply address. */
  email: string;
  /** `data:` URI, or '' when the picture couldn't be downloaded. */
  avatar: string;
  url: string;
}

/** A repository the signed-in user can clone — see src-tauri/src/github.rs. */
export interface GhRepo {
  name: string;
  fullName: string;
  private: boolean;
  cloneUrl: string;
  description: string;
}

/** Errors the UI explains itself instead of showing the raw message. */
export const NO_HELPER = 'no-helper';

// In the browser (npm run dev) there's no git: a pretend account shows the flow.
const DEMO: Account = { login: 'octocat', name: 'The Octocat', email: '583231+octocat@users.noreply.github.com', avatar: '', url: 'https://github.com/octocat' };
const DEMO_REPOS: GhRepo[] = [
  { name: 'spoon-knife', fullName: 'octocat/Spoon-Knife', private: false, cloneUrl: 'https://github.com/octocat/Spoon-Knife.git', description: 'This repo is for demonstration purposes only.' },
  { name: 'hello-world', fullName: 'octocat/Hello-World', private: false, cloneUrl: 'https://github.com/octocat/Hello-World.git', description: 'My first repository on GitHub!' },
  { name: 'secret-lab', fullName: 'octocat/secret-lab', private: true, cloneUrl: 'https://github.com/octocat/secret-lab.git', description: '' }
];
/** Issues of the demo repository — real repositories load theirs from GitHub. */
export const DEMO_ISSUES: Issue[] = [
  { number: 58, title: 'Token expiry is not refreshed after sleep' },
  { number: 61, title: 'OAuth login flow' },
  { number: 64, title: 'Rate-limit fetches against origin' },
  { number: 66, title: 'Sidebar filter loses focus on refresh' },
  { number: 71, title: 'Spanish translation for the UI' }
];
let demoSignedIn = false;

export const GitHub = {
  current: (): Promise<Account | null> => (inTauri() ? invoke<Account | null>('github_account') : Promise.resolve(demoSignedIn ? DEMO : null)),
  async signIn(): Promise<Account> {
    if (inTauri()) return invoke<Account>('github_sign_in');
    await sleep(1200); demoSignedIn = true; return DEMO;
  },
  async signOut(): Promise<void> {
    if (inTauri()) return invoke<void>('github_sign_out');
    demoSignedIn = false;
  },
  async repos(): Promise<GhRepo[]> {
    if (inTauri()) return invoke<GhRepo[]>('github_repos');
    await sleep(400); return demoSignedIn ? DEMO_REPOS : [];
  },
  /** Open issues of `owner/name`; works signed out for public repositories. */
  async issues(repo: string): Promise<Issue[]> {
    if (inTauri()) return invoke<Issue[]>('github_issues', { repo });
    await sleep(300); return DEMO_ISSUES;
  }
};
