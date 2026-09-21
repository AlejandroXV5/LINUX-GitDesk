# Arquitectura

GitDesk es una app Tauri v2. La interfaz es HTML/CSS/TypeScript servida por Vite y renderizada en WebKitGTK; el backend en Rust expone comandos que ejecutan el binario `git` del sistema.

```
┌──────────────── WebView (TypeScript) ────────────────┐      invoke()      ┌──────── Rust (src-tauri) ────────┐
│ ui/events → ui/actions → ui/session.doOp()           │ ─────────────────▶ │ lib.rs  #[tauri::command]         │
│        ▲                         │                   │                    │   └─ git.rs  Repo::fetch/commit…  │
│  ui/render ◀── core/model (R) ◀──┘ snapshot()        │ ◀───────────────── │        └─ std::process::Command   │
└──────────────────────────────────────────────────────┘   Snapshot/OpResult └──────────── git ────────────────┘
```

## Frontend

- **`backend/types.ts`** define `GitBackend`, la interfaz que usa toda la UI. Hay dos implementaciones:
  - `TauriBackend` (`backend/tauri.ts`): llama a los comandos de Rust con `invoke`.
  - `MockBackend` (`backend/mock.ts`): repositorio en memoria para el navegador y el modo demo (`demo://gitdesk`).
  - `B(path)` en `ui/session.ts` elige la implementación: demo si la ruta empieza con `demo://` o si no se está dentro de Tauri.
- **`core/model.ts`** guarda el repositorio abierto en `R`: el `Snapshot` que devuelve el backend más el estado de UI (selección, carpetas abiertas, secciones colapsadas, mensaje de commit…). `setRepo()` conserva el estado de UI entre refrescos del mismo repositorio.
- **Flujo de una operación**: `act.push()` → `doOp(statusKey, () => B().push(P()))` → muestra el indicador de progreso, escribe el log en *Output*, aplica el `notice` (barra de información en Git Changes) y vuelve a pedir `snapshot()`.
- **Notices** se guardan como clave i18n + variables (`n.pushed`, `{b: 'main'}`) y se traducen al renderizar, así cambian de idioma al instante. Pueden llevar acciones (`push`, `pull`, `sync`, `stash`, `mergeAbort`…) que se muestran como enlaces.
- **Gráfico de commits** (`ui/render.ts`): algoritmo de carriles que dibuja un SVG por fila con los colores `--graph-N` de los tokens.
- **Refresco automático**: al recuperar el foco de la ventana, cada 10 s, y *auto-fetch* según Opciones.
- **Persistencia local** (`localStorage`): `gitdesk-settings`, `gitdesk-recent`, `gitdesk-last`.

## Backend (Rust)

- `git.rs` contiene `Repo` con una función por operación. Todas pasan por `Repo::run()` / `raw()`, que:
  - fijan `LC_ALL=C` (para poder interpretar la salida), `GIT_TERMINAL_PROMPT=0`, `GCM_INTERACTIVE=never` y `GIT_EDITOR=true` (nunca se bloquea esperando al usuario);
  - añaden `-c color.ui=false -c core.quotepath=false`;
  - registran el comando y su salida en el `OpResult.log` que se muestra en *Output*.
- `snapshot()` lee refs con `for-each-ref`, el historial con `git log --topo-order` (máximo 2000 commits; si hay más, `truncated = true`), `status --porcelain=v1 -z`, stashes, worktrees, submódulos y si hay un merge/rebase/cherry-pick/revert en curso.
- Los errores se traducen a notices: push rechazado, fallo de autenticación, conflictos, checkout bloqueado por cambios locales, rama sin fusionar, etc.
- `lib.rs` declara los comandos `#[tauri::command]` (asíncronos, se ejecutan fuera del hilo de la UI) y `startup_repo()` para abrir la ruta pasada como argumento.
- Pull Requests usan `gh` (GitHub CLI); si no está instalado se devuelve `gh-missing`.
- `github.rs` es la cuenta de GitHub, sin app OAuth propia: `github_account` hace `git credential fill` sin interacción al arrancar; `github_sign_in` lo repite con `GCM_INTERACTIVE=auto` para que Git Credential Manager abra el inicio de sesión en el navegador, y luego hace `approve` (o `reject` si GitHub devuelve 401); `github_sign_out` hace `reject`. El perfil (`GET /user`) y el avatar se leen con el `curl` del sistema. Sin un helper capaz de iniciar sesión, devuelve `no-helper`.
- Los fallos de autenticación HTTPS contra github.com (fetch, pull, push, clone) generan `n.authFailed` con la acción `signIn`.

## Pruebas

`cargo test` (en `src-tauri`) crea repositorios temporales reales (incluido un remoto *bare* y un segundo clon) y prueba: parseo de status y tracking, commit + push, push rechazado + sync, ramas / stash / tags / reset, conflictos + abort, init + diff.

## Seguridad

- CSP restrictiva en `tauri.conf.json`; sin recursos externos.
- Capacidades mínimas: título/cerrar ventana, diálogo de carpetas y abrir URLs externas.
- Los argumentos se pasan a `git` como vector (sin shell), así que no hay inyección de comandos.
- El token de GitHub nunca llega al WebView: solo lo usa Rust, y se le pasa a `curl` por stdin (`--config -`), no como argumento visible en la lista de procesos. El avatar vuelve como `data:` URI, así que la CSP no cambia.
