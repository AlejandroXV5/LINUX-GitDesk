GitDesk is a Git client for the Linux desktop: a window a developer keeps open for hours, not a marketing surface. Every rule below optimizes for that — scanning a long commit graph at a glance, trusting a status color without reading its label, losing zero vertical space to decoration.

## Content fundamentals

Write in Git's own vocabulary, exactly as `git` and the ecosystem use it — commit, branch, tag, remote, stash, fetch, pull, push, merge, rebase, amend, HEAD, upstream, working tree, staged/unstaged. Never soften or rename a Git term for approachability ("save" for commit, "update" for pull): a developer's muscle memory depends on the real word.

Labels are nouns or imperative verbs, never full sentences: `Commit All`, not `Commit all your changes`. Empty states say exactly what is true and nothing more — `There are no unstaged changes in the working directory`, not `You're all caught up! 🎉`. Counts are exact numbers, never "a few" or "several." No emoji, anywhere, including in commit templates or empty states.

Errors name the Git operation and the reason (`Push rejected — remote has newer commits. Pull before pushing.`), never a generic "Something went wrong."

## Visual foundations

**Color.** `surface-100` is the window behind everything; `surface-200` is every panel — sidebar, changes panel, graph panel, menu bar, toolbar, status bar all share one flat plane, with `border-subtle` as the only line between them. Reserve `surface-300` for things that float above that plane: dropdowns, the commit-message textarea, context menus. A row shows three states in order of commitment — `surface-hover` on mouse-over, `surface-selected` when chosen but the panel isn't focused, `accent-selected-bg` (with `ink-inverse` text) when chosen and focused. Never use `border-control` for a decorative divider or `border-subtle` for a control's own edge — the first must clear 3:1 against its surface, the second is exempt because it carries no interactive meaning.

Status colors are fixed, cross-theme signals a developer reads without a label: `status-added` green, `status-modified` amber, `status-deleted` red, `status-renamed` violet, `status-warning` for stashes. The same five hues drive the commit-graph lanes (`graph-1`…`graph-5`), with `graph-1` always the current branch's line so it reads first in a busy graph. Never use a status color for anything decorative — if it's colored added-green, it means an added file, full stop.

**Typography.** One family, `sans`, does every UI surface at three working sizes: `title` (15px) for panel headers, `body` (13px) for everything a person reads line by line, `caption` (12px) for metadata that's secondary by design — timestamps, authors, paths. `label` (11px, set in caps by the markup, never a CSS transform) marks column headers and section eyebrows only. `code` (`mono`, 12px) is reserved for anything that must align character-for-character or be copy-pasted verbatim: commit SHAs, full refs, diff text — never for a branch name shown in the tree, which stays `body`.

GitDesk ships no font files: `sans` resolves to Cantarell on GNOME, Noto Sans on KDE, Ubuntu on Ubuntu — the system already installed matters more than a downloaded one, and it's the one thing that makes a Git client feel like it belongs on the desktop it's running on. `mono` follows the same logic for code fonts already on the machine, with JetBrains Mono as the one web fallback worth loading when nothing local exists.

**Spacing and density.** The scale is deliberately tight — `space-3` (8px) is a tree or list row's vertical padding, `space-4` (12px) its horizontal padding — because the working surface is a graph of hundreds of commits and a tree of dozens of branches; density is the feature, not a constraint to work around. Use `space-6`/`space-7` only between sections and major regions, never inside a row.

**Borders over shadows.** Panels meet at a `border-subtle` hairline, not a drop shadow — this is a flat, tiled window, not a stack of cards. `shadow-sm` and `shadow-md` exist only for things that must visually detach from that plane because they float over it: a context menu, the branch-switcher popover, a pressed toolbar button's inset. Nothing else in GitDesk casts a shadow.

**Radius.** Square by default (`radius-none`) for anything that is a row in a list — trees, tables, the changes list — because a rounded row breaks the sense of a continuous scrolling surface. `radius-sm` is for discrete controls (buttons, inputs, checkboxes, badges); `radius-full` only for circles — avatars and status dots.

## Iconography

Every icon in GitDesk is an inline vector — a `<path>` built on a 16×16 grid at 1.5px stroke weight, using `currentColor` so a single icon inherits `ink`, `ink-secondary`, `brand` or any status color from its context with no extra markup. GitDesk carries no icon font and no image sprite: a stroke-based glyph set stays crisp at any zoom and recolors for free across both themes, which a raster or colored-SVG icon set cannot do. Keep every icon two-tone at most in concept — a filled dot plus an outline, never a multi-color illustration — so it reads instantly at 16px next to a line of `body` text.
