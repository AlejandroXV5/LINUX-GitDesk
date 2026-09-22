export const $ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T => r.querySelector(s) as T;
export const $$ = <T extends Element = HTMLElement>(s: string, r: ParentNode = document): T[] => Array.from(r.querySelectorAll(s)) as T[];

export const esc = (s: unknown): string =>
  String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

export const short = (s?: string | null): string => (s ? s.slice(0, 8) : '');
export const s7 = (s?: string | null): string => short(s).slice(0, 7);
export const firstLine = (m: string): string => String(m).split('\n')[0];
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export const dirOf = (p: string) => (p.indexOf('/') >= 0 ? p.slice(0, p.lastIndexOf('/')) : '');
export const baseOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

export const store = {
  get<T>(k: string, d: T): T {
    try {
      const v = localStorage.getItem(k);
      return v == null ? d : (JSON.parse(v) as T);
    } catch {
      return d;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* storage unavailable — settings just won't persist */
    }
  }
};

/** `git@github.com:org/repo.git` or `https://…/repo.git` → browsable https URL. */
export function webUrl(remote: string): string {
  if (!remote) return '';
  let u = remote.trim().replace(/\.git$/, '');
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(u);
  if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
  // drop embedded credentials (https://user:token@host) so they never reach logs or browser history
  return u.replace(/^https?:\/\/[^@/]*@/, 'https://').replace(/^http:\/\//, 'https://');
}
