import { esc } from '../core/util';

export interface DiffRow { k: string; o: number | ''; n: number | ''; t: string }

/** Parse a unified diff into rows with old/new line numbers. */
export function parseDiff(text: string): DiffRow[] {
  const rows: DiffRow[] = []; let o = 0, n = 0;
  for (const line of text.split('\n')){
    if (/^(diff --git|index |--- |\+\+\+ )/.test(line)) continue;
    if (/^(new file|deleted file|rename |similarity|old mode|new mode|Binary)/.test(line)){ rows.push({ k: 'meta', o: '', n: '', t: line }); continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (h){ o = +h[1]; n = +h[2]; rows.push({ k: 'hunk', o: '', n: '', t: line }); continue; }
    if (line.startsWith('+')) rows.push({ k: 'add', o: '', n: n++, t: line });
    else if (line.startsWith('-')) rows.push({ k: 'del', o: o++, n: '', t: line });
    else if (line.startsWith(' ')) rows.push({ k: '', o: o++, n: n++, t: line });
    else if (line.startsWith('\\')) rows.push({ k: 'meta', o: '', n: '', t: line });
  }
  return rows;
}

export function diffTableHtml(rows: DiffRow[]): string {
  return rows.length
    ? `<table>${rows.map(r => `<tr class="${r.k}"><td class="ln">${r.o}</td><td class="ln">${r.n}</td><td>${esc(r.t)}</td></tr>`).join('')}</table>`
    : '<div class="hint" style="padding:8px">—</div>';
}
