Four button kinds, used exactly for these purposes and never interchanged.

- **Primary** (`brand-solid` fill, `ink-inverse` text) — the one committing action in a panel: `Commit All`. At most one primary button visible at a time.
- **Secondary** (outline, `border-control`) — a supporting action beside a primary one: `Amend`.
- **Ghost** (no fill, no border) — a low-emphasis action inside dense rows or toolbars where a border would add noise: `Discard`.
- **Danger** (`status-deleted` text and outline) — an irreversible action: `Delete Branch`, `Discard Changes`. Never filled solid; the outline keeps it from dominating the panel until it's deliberately chosen.
- **Icon button** (28×16 hit target, `btn-icon`) — toolbar actions: Fetch, Pull, Push, Stash. `.active` tints the glyph `brand` for a toggled-on state (e.g. auto-fetch enabled); the small dot is the unread/outgoing-count indicator, colored by what changed (`status-modified` for outgoing commits).

Disabled buttons drop straight to `ink-disabled` text with no border or fill change beyond that — GitDesk never grays out a whole button shape, only its label, so the row stays visually calm. Every button shows the `focus-ring` token on keyboard focus, drawn outside its own edge.
