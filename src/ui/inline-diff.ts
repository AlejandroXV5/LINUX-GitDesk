import { R, type FileChange, type WorkFile } from '../core/model';
import { t } from '../core/settings';
import { $, esc, s7 } from '../core/util';
import { diffTableHtml, parseDiff } from './diff-format';
import { B, P } from './session';

type Selection = { file: FileChange | WorkFile; context: string; repo: string };
let selection: Selection | null = null;
let request = 0;
const contextLabel = (context: string) => context === 'work' ? t('dl.diffWork')
  : context === 'staged' ? t('dk.staged')
  : R.commits[context] ? t('dl.diffCommit', { sha: s7(context) }) : context;

export function showHistory(){
  $('#graphPane').classList.remove('showing-diff');
  $('#historyContent').hidden = false;
  $('#inlineDiff').hidden = true;
  $('#historyTab').classList.add('active');
  $('#diffTab').classList.remove('active');
  $('#historyTab').setAttribute('aria-selected', 'true');
  $('#diffTab').setAttribute('aria-selected', 'false');
}

export function showSelectedDiff(){
  if (!selection) return;
  $('#graphPane').classList.add('showing-diff');
  $('#historyContent').hidden = true;
  $('#inlineDiff').hidden = false;
  $('#historyTab').classList.remove('active');
  $('#diffTab').classList.add('active');
  $('#historyTab').setAttribute('aria-selected', 'false');
  $('#diffTab').setAttribute('aria-selected', 'true');
}

export function currentDiff(){ return selection; }

/** A new repository invalidates the previously selected file and its async diff. */
export function syncInlineDiff(){
  const missingWorkFile = selection && (selection.context === 'work' || selection.context === 'staged')
    && !R.work.some(f => f.path === selection!.file.path && f.staged === (selection!.context === 'staged'));
  if (selection && (selection.repo !== R.path || missingWorkFile)){
    selection = null;
    request++;
    ($('#diffTab') as HTMLButtonElement).disabled = true;
    showHistory();
  } else if (selection){
    $('#inlineDiffContext').textContent = contextLabel(selection.context);
    for (const action of ['stage', 'unstage', 'discard']){
      const button = $(`#inlineDiffActions [data-inline-act="${action}"]`);
      if (button) button.textContent = t('dk.' + action);
    }
  }
}

export async function openInlineDiff(file: FileChange | WorkFile, context: string){
  const repo = R.path, id = ++request;
  selection = { file, context, repo };
  ($('#diffTab') as HTMLButtonElement).disabled = false;
  showSelectedDiff();
  $('#inlineDiffName').textContent = file.path;
  $('#inlineDiffContext').textContent = contextLabel(context);
  $('#inlineDiffAdded').textContent = '';
  $('#inlineDiffDeleted').textContent = '';
  $('#inlineDiffBody').innerHTML = `<div class="hint" style="padding:16px">${esc(t('st.loading'))}</div>`;
  $('#inlineDiffActions').innerHTML = context === 'work'
    ? `<button class="btn btn-secondary" data-inline-act="discard">${esc(t('dk.discard'))}</button><button class="btn btn-primary" data-inline-act="stage">${esc(t('dk.stage'))}</button>`
    : context === 'staged'
      ? `<button class="btn btn-primary" data-inline-act="unstage">${esc(t('dk.unstage'))}</button>` : '';
  try {
    const text = await B().diff(P(), file.path, context, context === 'work' && file.st === 'A');
    if (id !== request || repo !== R.path) return;
    const rows = parseDiff(text);
    $('#inlineDiffAdded').textContent = '+' + rows.filter(r => r.k === 'add').length;
    $('#inlineDiffDeleted').textContent = '−' + rows.filter(r => r.k === 'del').length;
    $('#inlineDiffBody').innerHTML = diffTableHtml(rows);
  } catch (error){
    if (id !== request || repo !== R.path) return;
    $('#inlineDiffBody').innerHTML = `<div class="hint err" style="padding:16px">${esc(String((error as Error)?.message ?? error))}</div>`;
  }
}
