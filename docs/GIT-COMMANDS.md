# Mapa de acciones → comandos git

Todas las llamadas incluyen `-c color.ui=false -c core.quotepath=false` y el entorno descrito en ARCHITECTURE.md. Lo que ejecuta cada acción se ve en el panel **Output**.

| Acción en la UI | Comando(s) |
|---|---|
| Abrir / refrescar | `rev-parse --show-toplevel`, `for-each-ref refs/heads refs/remotes refs/tags`, `log --topo-order --branches --remotes --tags HEAD -n2000`, `status --porcelain=v1 -z --untracked-files=all`, `stash list`, `worktree list --porcelain` |
| Fetch | `fetch --all [--prune]` |
| Pull | `pull --no-rebase --no-edit` |
| Push (rama con upstream) | `push <remoto> <rama>:<destino>` |
| Push (rama nueva) | `push --set-upstream <remoto> <rama>` |
| Sync | `fetch`, `pull --no-rebase --no-edit`, `push` |
| Commit Staged / Commit All | `commit -m <msg>` (Commit All hace antes `add --all`) |
| Amend | `commit --amend -m <msg>` |
| Stage / Unstage | `add -- <archivos>` / `restore --staged -- <archivos>` (`rm --cached` si aún no hay commits) |
| Discard | `restore -- <archivos>`; archivos nuevos: `clean -f -- <archivos>` |
| Discard all | `restore --worktree -- .` + `clean -fd` |
| Checkout rama local | `switch <rama>` |
| Checkout rama remota | `switch --track origin/<rama>` (o `switch <rama>` si ya existe) |
| Checkout commit / tag | `switch --detach <ref>` |
| Nueva rama | `switch -c <nombre> <desde>` o `branch --no-track <nombre> <desde>` |
| Eliminar rama local / remota / tag | `branch -d` (`-D` forzado) / `push <remoto> --delete <rama>` / `tag -d` |
| Merge into current | `merge --no-edit <ref>` |
| Rebase onto | `rebase <ref>` |
| Reset (keep / delete changes) | `reset --mixed <sha>` / `reset --hard <sha>` (`--soft` disponible) |
| Cherry-pick | `cherry-pick <sha>` |
| Revert | `revert --no-edit <sha>` |
| Abort merge / rebase / cherry-pick / revert | `merge --abort`, `rebase --abort`, `cherry-pick --abort`, `revert --abort` |
| New tag | `tag <nombre> <sha>` o `tag -a <nombre> -m <msg> <sha>` |
| Stash all | `stash push --include-untracked` |
| Apply / Pop / Drop stash | `stash apply|pop|drop stash@{n}` |
| Ver cambios de commit / stash | `show --format= --name-status -M <sha>` / `stash show --name-status --include-untracked` |
| Diff | `diff -M -- <f>`, `diff --cached -M -- <f>`, `show <sha> -- <f>`, `diff --no-index /dev/null <f>` (nuevos) |
| Compare with… | `diff --name-status -M <b> <a>` |
| Worktree | `worktree add -b <rama> <ruta> <desde>` / `worktree remove <ruta>` |
| Submódulos | `submodule add <url> <ruta>` / `rm -f <ruta>` |
| Clonar / Nuevo | `clone --progress <url> <destino>` / `init -b <rama>` (+ README y commit inicial opcional) |
| Nombre y correo (Opciones) | `config --global user.name|user.email` |
| Pull Requests | `gh pr list --json …`, `gh pr create`, `gh pr merge` / `gh pr close` |
