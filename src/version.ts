import { inTauri } from './backend/tauri';

// The desktop app asks Tauri for its version: CI builds set it to 0.1.<run number>
// (see .github/workflows/build.yml), so a constant here would stay behind after every
// update. This one is only shown by the browser demo.
const DEMO_VERSION = '0.1.0';

/** The running build: its version and the commit it was built from ('' if unknown). */
export const build = { version: DEMO_VERSION, commit: '' };

/** Reads the installed build's version and commit — call once at startup. */
export async function loadBuildInfo(){
  if (!inTauri()) return;
  const [{ getVersion }, { invoke }] = await Promise.all([import('@tauri-apps/api/app'), import('@tauri-apps/api/core')]);
  build.version = await getVersion().catch(() => DEMO_VERSION);
  build.commit = await invoke<string>('app_commit').catch(() => '');
}
