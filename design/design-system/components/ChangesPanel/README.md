The Git Changes dock, laid out the way Visual Studio's is: every sync action for the branch you're on lives in one bar at the top, next to the branch it acts on.

**Branch bar.** A branch selector (click to switch or create a branch) followed by four icon buttons — Fetch, Pull, Push, Sync — and a `…` overflow (Stash All, Undo Last Commit, New Pull Request, Git settings). Directly under it, `⇅ outgoing / incoming` counts (click for the same four actions as a menu) and a `View all commits` link that returns the graph to the current branch. The four sync buttons are disabled together while any operation runs, and a 2px `brand` progress line slides under the dock header.

**Info bar.** One notice at a time, between the counts and the message box, colored only by its icon and — for errors — its border in `status-deleted`. Every notice names what happened and offers the next Git step as links: `Commit 3c42cd6 created locally. Push · Sync`, `Push rejected … Pull · Sync`. It replaces toasts while the dock is open; when the dock is hidden the same text goes to a toast.

**Commit box.** A textarea with a `#` button in its corner (typing `#` opens the same picker) that links work items into Related Items. The primary is a split button: the label reads `Commit Staged` when anything is staged and `Commit All` otherwise; the arrow opens `… and Push`, `… and Sync` and `Stash All`. `Amend` pre-fills the last commit's message. Ctrl+Enter commits.

**Lists.** Related Items, Staged Changes (only when non-empty, with Unstage All `−`), Changes (Discard All `↶`, Stage All `+`), Stashes. File rows reveal diff / discard / stage on hover; click opens the diff, double-click stages or unstages, right-click gives the full menu. A stash row opens its files with Apply, Pop and Drop.
