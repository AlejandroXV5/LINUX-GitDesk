// GitDesk self-update: check against origin/main on boot, offer to pull + rebuild +
// reinstall (see src-tauri/src/update.rs) when a newer commit exists.
import { Updater, type UpdateInfo } from '../backend/update';
import { t } from '../core/settings';
import { esc } from '../core/util';
import { appLog, dialog, toast, type DialogApi } from './core';

const errText = (e: unknown) => String((e as Error)?.message ?? e);

export async function checkForUpdate(){
  try {
    const info = await Updater.check();
    if (!info) return;
    appLog(`update: ${info.latest} available — ${info.message}`);
    toast(t('upd.available', { msg: info.message }), { label: t('upd.update'), fn: () => dlgUpdate(info) });
  } catch (e){
    appLog(`update: check failed — ${errText(e)}`);
  }
}

function appendLog(d: DialogApi, line: string){
  const box = d.$<HTMLElement>('#updLog');
  box.hidden = false;
  box.insertAdjacentHTML('beforeend', `<div>${esc(line)}</div>`);
  box.scrollTop = box.scrollHeight;
}

async function beginUpdate(d: DialogApi){
  d.$$('.dlg-foot .btn').forEach(b => ((b as HTMLButtonElement).disabled = true));
  d.$<HTMLElement>('#updStatus').textContent = t('upd.updating');
  const foot = d.el.querySelector('.dlg-foot')!;
  try {
    await Updater.install(line => appendLog(d, line));
    d.$<HTMLElement>('#updStatus').textContent = t('upd.done');
    foot.innerHTML = `<button class="btn btn-primary" id="updRestart">${esc(t('upd.restart'))}</button>`;
    d.$('#updRestart').addEventListener('click', () => { Updater.restart(); });
  } catch (e){
    d.$<HTMLElement>('#updStatus').textContent = '';
    appendLog(d, errText(e));
    foot.innerHTML = `<button class="btn btn-primary" id="updClose">${esc(t('dl.close'))}</button>`;
    d.$('#updClose').addEventListener('click', d.close);
  }
}

export function dlgUpdate(info: UpdateInfo){
  dialog({
    title: t('upd.title'),
    body: `<p style="margin:0">${esc(t('upd.body', { msg: info.message }))}</p>` +
      `<div class="hint" id="updStatus"></div>` +
      `<div class="diff" id="updLog" hidden style="max-height:220px"></div>`,
    actions: [{ label: t('dl.cancel') }, { label: t('upd.updateBtn'), primary: true, fn: d => { beginUpdate(d); return false; } }]
  });
}
