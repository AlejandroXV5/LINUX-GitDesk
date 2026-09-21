// GitHub account: the menu-bar button, sign in / sign out and "use for commits".
// Signing in is git's own login (git credential fill → Git Credential Manager).
import { GitHub, NO_HELPER, type Account } from '../backend/github';
import { openExternal } from '../backend/tauri';
import { svg } from '../core/icons';
import { avClass, hasRepo, initials } from '../core/model';
import { S, saveSettings, t } from '../core/settings';
import { $, esc } from '../core/util';
import { appLog, confirmDlg, dialog, menuAt, toast } from './core';
import { renderAll } from './render';
import { B, P, doOp } from './session';

export let account: Account | null = null;
export let signingIn = false;

const GCM_INSTALL = 'https://github.com/git-ecosystem/git-credential-manager/blob/main/docs/install.md';
const errText = (e: unknown) => String((e as Error)?.message ?? e);
const usesIdentity = (a: Account) => S.userName === a.name && S.email === a.email;

async function openUrl(u: string){
  appLog(`xdg-open ${u}`);
  if (!(await openExternal(u))) toast(t('n.openBrowser', { url: u }));
}

/** At startup: does git already have a github.com credential? Never prompts. */
export async function loadAccount(){
  try { account = await GitHub.current(); }
  catch (e){ account = null; appLog(`github: ${errText(e)}`); }
  if (account) appLog(`github: signed in as ${account.login}`);
  renderAll();
}

export async function signIn(){
  if (signingIn) return;
  signingIn = true; renderAll();
  appLog('github: git credential fill (https://github.com)');
  try {
    const a = account = await GitHub.signIn();
    appLog(`github: signed in as ${a.login}`);
    toast(t('acc.signedIn', { login: a.login }), usesIdentity(a) ? null : { label: t('acc.useShort'), fn: useIdentity });
  } catch (e){
    const msg = errText(e), noHelper = msg === NO_HELPER;
    appLog(`github: sign in failed — ${msg}`);
    dialog({
      title: t('acc.failed'),
      body: `<p style="margin:0">${esc(noHelper ? t('acc.noHelper') : msg)}</p>`,
      actions: noHelper
        ? [{ label: t('dl.close') }, { label: t('acc.installGcm'), primary: true, fn: () => { openUrl(GCM_INSTALL); } }]
        : [{ label: t('dl.close'), primary: true }]
    });
  } finally {
    signingIn = false; renderAll();
  }
}

function signOut(){
  confirmDlg(t('acc.signOutTitle'), esc(t('acc.signOutBody')), t('acc.signOut'), true, async () => {
    try {
      await GitHub.signOut();
      account = null;
      appLog('github: git credential reject (https://github.com)');
      toast(t('acc.signedOut'));
    } catch (e){ toast(errText(e)); }
    renderAll();
  });
}

/** Commit as the GitHub user — same as saving name/email in Options (git config --global). */
function useIdentity(){
  if (!account) return;
  S.userName = account.name; S.email = account.email; saveSettings();
  if (hasRepo()) doOp('st.working', () => B().setIdentity(P(), S.userName, S.email));
  toast(t('acc.identitySet', { name: S.userName, email: S.email }));
}

export const accountPic = (a: Account) =>
  a.avatar ? `<img class="avatar" src="${esc(a.avatar)}" alt="">` : `<span class="avatar ${avClass(a.name)}">${esc(initials(a.name))}</span>`;

/** The menu-bar button: "Sign in", "Waiting for the browser…" or the signed-in account. */
export function renderAccount(){
  const b = $<HTMLButtonElement>('#accountBtn');
  const label = signingIn ? t('acc.waiting') : account ? account.login : t('acc.signIn');
  b.innerHTML = (signingIn ? svg('refresh') : account ? accountPic(account) : svg('user')) + `<span class="lbl">${esc(label)}</span>`;
  b.disabled = signingIn;
  b.classList.toggle('spin', signingIn);
  b.title = account && !signingIn ? `${account.name} (${account.login})` : t('acc.signInTip');
  b.setAttribute('aria-label', b.title);
}

export function accountMenu(anchor: HTMLElement){
  if (!account){ signIn(); return; }
  const a = account;
  menuAt(anchor, [
    { header: a.name === a.login ? a.login : `${a.name} · ${a.login}` },
    { label: t('acc.profile'), icon: 'ext', action: () => { openUrl(a.url); } },
    { label: t('acc.useIdentity'), icon: 'pencil', checked: usesIdentity(a), action: useIdentity },
    { divider: true },
    { label: t('acc.signOut'), icon: 'exit', action: signOut }
  ], true);
}
