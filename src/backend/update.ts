import { invoke } from '@tauri-apps/api/core';
import { inTauri } from './tauri';

/** GitDesk has no release channel — this is commit `latest` on GitHub's `main`. */
export interface UpdateInfo {
  current: string;
  latest: string;
  /** First line of the latest commit's message. */
  message: string;
}

export const Updater = {
  /** `null` when up to date, or outside Tauri (the browser demo has no self-update). */
  check: (): Promise<UpdateInfo | null> => (inTauri() ? invoke<UpdateInfo | null>('app_check_update') : Promise.resolve(null)),

  /** Pulls, rebuilds and reinstalls GitDesk; `onProgress` gets a log line per phase. */
  async install(onProgress: (line: string) => void): Promise<void> {
    if (!inTauri()) return;
    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<string>('update-progress', e => onProgress(e.payload));
    try { await invoke<void>('app_update'); } finally { unlisten(); }
  },

  restart: (): Promise<void> => (inTauri() ? invoke<void>('app_restart') : Promise.resolve())
};
