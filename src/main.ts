import './styles/tokens.css';
import './styles/app.css';
import { inTauri } from './backend/tauri';
import { hasRepo } from './core/model';
import { store, $ } from './core/util';
import { appLog, isNarrow, setBusyListener, setDockVisible, setLogListener } from './ui/core';
import { setupAutoFetch } from './ui/dialogs';
import { wire } from './ui/events';
import { renderAll, renderBusy, renderDock, renderOutput } from './ui/render';
import { DEMO, openRepo } from './ui/session';
import { loadAccount } from './ui/account';
import { checkForUpdate } from './ui/update';
import { S } from './core/settings';
import { VERSION } from './version';
import './ui/actions'; // registers the info-bar action runner

setBusyListener(() => { renderBusy(); if (hasRepo()) renderDock(); });
setLogListener(renderOutput);
setDockVisible(() => (isNarrow() ? $('#app').classList.contains('drawer-dock') : S.showDock));

async function boot(){
  // Inside Tauri the window manager draws the title bar; the in-page one is for the browser demo.
  if (inTauri()) $('#app').classList.add('in-tauri');
  wire();
  appLog(`GitDesk ${VERSION} — ${inTauri() ? 'desktop' : 'browser (demo backend)'}`);
  renderAll();
  setupAutoFetch();
  loadAccount(); // git credential fill, never prompts — doesn't block opening the repository
  checkForUpdate();
  if (!inTauri()){ await openRepo(DEMO); return; }
  const { invoke } = await import('@tauri-apps/api/core');
  const fromCli = await invoke<string | null>('startup_repo').catch(() => null);
  const last = fromCli || store.get<string | null>('gitdesk-last', null);
  if (last) await openRepo(last);
}
boot();
