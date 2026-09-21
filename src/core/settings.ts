import { L } from './i18n';
import { store } from './util';

export interface Settings {
  lang: 'en' | 'es';
  theme: 'auto' | 'light' | 'dark';
  userName: string;
  email: string;
  defaultBranch: string;
  /** 'off' or a number of seconds */
  autoFetch: string;
  prune: boolean;
  avatars: boolean;
  dateFmt: 'relative' | 'absolute';
  confirmDelete: boolean;
  pushAfterCommit: boolean;
  showSidebar: boolean;
  showDock: boolean;
  showOutput: boolean;
  /** Drag-resized panel widths, in px — see the #sidebarResize / #dockResize handles. */
  sidebarWidth: number;
  dockWidth: number;
}

const DEFAULTS: Settings = {
  lang: (navigator.language || 'en').toLowerCase().startsWith('es') ? 'es' : 'en',
  theme: 'auto',
  userName: '',
  email: '',
  defaultBranch: 'main',
  autoFetch: 'off',
  prune: true,
  avatars: true,
  dateFmt: 'relative',
  confirmDelete: true,
  pushAfterCommit: false,
  showSidebar: true,
  showDock: true,
  showOutput: true,
  sidebarWidth: 272,
  dockWidth: 372
};

export const S: Settings = Object.assign({}, DEFAULTS, store.get<Partial<Settings>>('gitdesk-settings', {}));
export const saveSettings = () => store.set('gitdesk-settings', S);

/** Translate a key; `{name}` placeholders are filled from `v`. Missing keys fall back to English. */
export function t(k: string, v?: Record<string, unknown>): string {
  let s = L[S.lang]?.[k] ?? L.en[k] ?? k;
  if (v) s = s.replace(/\{(\w+)\}/g, (m, n) => (v[n] != null ? String(v[n]) : m));
  return s;
}
/** Singular/plural word: w(2, 'commit', 'commits') → "commits" in the current language. */
export const w = (n: number, one: string, many: string) => t(n === 1 ? 'w.' + one : 'w.' + many);
export const locale = () => (S.lang === 'es' ? 'es' : 'en');

/** Fill the plural helpers a notice template may use ({c}, {ch}, {br}) from {n}. */
export function withPlurals(vars: Record<string, string>): Record<string, string> {
  if (vars.n == null) return vars;
  const n = Number(vars.n);
  return { c: w(n, 'commit', 'commits'), ch: w(n, 'change', 'changes'), br: w(n, 'branch', 'branches'), ...vars };
}
