# ADR 0005 — A visible offline queue, and layouts as CSS

**Status:** accepted · **Date:** 2026-08

## Two decisions that share a principle: make the mechanism visible.

### Offline mutations queue in IndexedDB, not in Background Sync

Mutations made without a network are appended to an IndexedDB queue that the
page owns, and replayed oldest-first on reconnect. Background Sync was rejected
because its queue is invisible: the student cannot see what is pending, cannot
retry one item, and cannot discard a change they no longer want. A queue you
cannot inspect is indistinguishable from data loss.

Replay stops at the first *network* failure (the connection went away again) but
continues past a *rejection* — a 4xx is a permanent answer about one change, so
it is parked as `failed`/`conflict` for review rather than blocking everything
behind it. Each queued mutation carries a client-generated idempotency key, so a
replay after an ambiguous failure cannot apply twice.

The header shows four distinct states — synced, syncing, offline with a count,
and needs-review — because conflating them is how "it looked fine" becomes "it
was never saved".

### Dashboard layouts are emitted as a stylesheet, not resolved in JavaScript

Widget order, width and visibility differ per breakpoint and are stored per
breakpoint. The obvious implementation — read the layout, pick one with
`matchMedia` after mount — flashes the desktop arrangement on a phone for one
frame, every single load.

Instead the server renders one list of widgets and emits a small stylesheet with
three media-query blocks setting `order`, `grid-column` and `display` per
widget. The first paint is correct at any width, the layout survives with
JavaScript disabled, and switching breakpoints is free. The subtlety worth
knowing: a widget absent from a breakpoint's layout must be explicitly hidden at
that width, or it inherits `order: 0` and jumps to the top.
