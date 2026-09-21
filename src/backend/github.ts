import { invoke } from '@tauri-apps/api/core';
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

/** Errors the UI explains itself instead of showing the raw message. */
export const NO_HELPER = 'no-helper';

// In the browser (npm run dev) there's no git: a pretend account shows the flow.
const DEMO: Account = { login: 'octocat', name: 'The Octocat', email: '583231+octocat@users.noreply.github.com', avatar: '', url: 'https://github.com/octocat' };
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
  }
};
