Every text control shares one shell — `surface-300`, a `border-control` edge, `radius-sm`, 28px tall, `body`-size text — so a filter box, a dropdown and a text field never compete for attention against each other.

- **Filter** adds a leading 14px search glyph in `ink-secondary`; the input itself has no border of its own, it sits inside the shell. Used at the top of the branch tree and the commit graph.
- **Select** (repository/branch dropdown) is the same shell with a trailing chevron; opens a `surface-300` + `shadow-md` popover, never inline-expands.
- **Textarea** (the commit-message box) is the one exception to 28px — it grows to at least 72px because a commit message is the one thing in GitDesk meant to be composed, not scanned. Its placeholder repeats the field's requirement inline (`Enter a message  <Required>`) instead of a separate error state, since the primary button already disables until it's filled.
- **Disabled** drops to `ink-disabled` text on `surface-200` (one step back from the interactive `surface-300`), signaling "not editable" without hiding the value — used for a detached-HEAD ref or a locked field.

Focus is always the `focus-ring` token drawn just inside the control's own edge, replacing the border rather than stacking outside it, since these controls sit close together in narrow panels.
