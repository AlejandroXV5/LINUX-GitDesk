# Roadmap

## v0.1 (este código)
- [x] Vista general tipo Visual Studio: ramas, historial con gráfico y Git Changes acoplado
- [x] Fetch / Pull / Push / Sync, commit, amend, stage/unstage, discard
- [x] Ramas, tags, merge, rebase, reset, cherry-pick, revert, abort
- [x] Stashes, worktrees, submódulos, comparar ramas, diff de archivos
- [x] Pull Requests vía `gh`
- [x] Español / inglés, tema claro / oscuro / sistema, Opciones
- [x] Paquetes .deb / .rpm / .AppImage

## Siguiente
- [ ] Editor de conflictos de 3 vías (hoy se resuelven en el editor y se hace stage)
- [ ] Stage por fragmentos (hunks) y por líneas dentro del visor de diff
- [ ] Progreso en vivo de clone/fetch/push (eventos Tauri en lugar de esperar al final)
- [ ] Rebase interactivo (squash, reword, reordenar)
- [ ] Blame y historial por archivo
- [ ] Paginación del historial (> 2000 commits) y vigilancia de archivos con `notify` en lugar de sondeo
- [ ] Integración con GitLab / Azure DevOps para work items y PR
- [ ] Firmado de commits (GPG / SSH) desde Opciones
- [ ] Varias ventanas / pestañas de repositorio
- [ ] Publicación en Flathub
