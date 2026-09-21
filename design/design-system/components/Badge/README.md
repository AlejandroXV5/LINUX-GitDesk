Three ways GitDesk shows a small fact without a full label.

- **Count pill** (`radius-full`, mono numerals) — ahead/behind counts next to a branch, the stash count. Ahead is `status-added`, behind is `status-deleted`; a neutral count (submodule count, filter match count) stays `ink-secondary`.
- **Status glyph** — the single bold letter next to a changed file: `A` added, `M` modified, `D` deleted, `R` renamed. The letter alone carries the color; never pair it with a colored background, which would fail contrast for the smaller-weight letters against a mid-tone fill.
- **Status dot** (`radius-full`, 8px, solid fill) — an unlabeled indicator where space is tightest: the outgoing-commits dot on the Push toolbar icon, a stash marker in the tree.

All three read the same five-color status vocabulary as the commit graph and the changes list — a developer learns the color once.
