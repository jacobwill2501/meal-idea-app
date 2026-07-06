# Cart queue pause/skip/visibility — design

## Context

The extension's "Send to Cart (Experimental)" mode drives an Amazon tab
through a queue of grocery items, clicking "Add to Cart" for each one
(`extension/content-scripts/amazon-cart.js`) and rendering per-item status in
the popup (`extension/popup.js`). On 2026-07-05 a live run got stuck
repeatedly adding "turkey" to the cart. Root cause (fixed separately): the
only place progress was persisted (`recordResult`) ran in a `setTimeout`
*after* the add-to-cart click; if that click caused the page to reload, the
pending timer was destroyed before it could save, so the next content-script
load saw the item as unresolved and clicked again — forever. That's now
fixed by persisting an `attempted` marker before the click, and treating
"already attempted, page reloaded, still unresolved" as a completed add
rather than clicking again.

This spec covers a separate, related request surfaced during that incident:
there was no way to see what the automation was doing, no way to stop it,
and no way to tell it to skip an item and move on. This adds that
visibility and control.

## Requirements

- Show which item the automation is currently acting on (distinct from
  items it hasn't reached yet).
- Let the user pause the queue (stop it from taking further action) and
  resume it later.
- Let the user skip the item currently in progress and move the queue on to
  the next one, without clicking anything on the real page.

Explicitly out of scope (per user decision during brainstorming):
- Cancel does not mean "clear the queue" — that's already covered by the
  existing "Clear extension data" button. Pause only stops it in place.
- Skip only applies to the current in-progress item — no jumping ahead to
  an arbitrary later item.

## Data model

`cartQueue` (in `chrome.storage.local`) gains one field:

- `paused: boolean` (default falsy/absent = running).

`results[i].status` gains one new value: `'skipped'`, alongside the
existing `'added' | 'ambiguous' | 'not_found'`.

No other shape changes. `currentIndex` continues to mean "first unresolved
index," as it does today.

## Content script (`amazon-cart.js`)

`processCurrentItem` checks `queue.paused` first, before any of the
existing logic, and returns immediately if true — no click, no navigation.

Known, accepted limitation: if the user pauses while a page is already in
its 800ms pre-click wait, that click will still fire once before the pause
takes effect on the *next* page load. Cancelling in-flight timers via a
storage-change listener would close this gap but isn't justified by the
"stop/pause only" (not "abort instantly") requirement confirmed with the
user.

## Popup (`popup.js` / `popup.html` / `popup.css`)

**Queue-level status + Pause/Resume button**, shown in the
`#automated-mode` section header next to "Send to Whole Foods Cart":

- Label reads "Running", "Paused", or "Done" based on `queue.paused` and
  whether `currentIndex >= items.length`.
- Button toggles: "Pause" sets `paused: true`. "Resume" sets `paused:
  false` and calls the existing `navigateTabToItem(queue.tabId,
  items[currentIndex])` so a paused, possibly-idle tab picks processing
  back up (mirrors what `retryItem` already does).
- Hidden once the queue is done, same as today's `sendToCartBtn` re-enable
  behavior.

**Per-item status**, in `renderCartQueue`:

- The item at `index === queue.currentIndex` with no recorded result shows
  **"In progress"** (or "Paused" if `queue.paused`) instead of today's
  generic "Pending". A new `.status-in_progress` / reuse of `.status-pending`
  CSS class with an extra visual cue (existing `.item-status` styling
  pattern) marks this.
- All other unresolved items keep showing "Pending".

**Skip button**, in `renderCartQueue`:

- Appears only on the in-progress item (same condition as above).
- On click: reads the queue, sets `results[currentIndex] = { name,
  quantity, status: 'skipped' }`, advances `currentIndex` forward past any
  already-resolved slots (same walk used by `recordResult`'s
  `firstUnresolvedIndex`, duplicated locally in popup.js — it's a 4-line
  loop, not worth sharing across a module boundary that doesn't otherwise
  exist between content script and popup), persists the queue, and — if
  not paused and a next item exists — calls `navigateTabToItem` for it.

## Testing

- `extension/lib/matcher.js`-style unit tests aren't applicable here (no
  chrome/DOM-coupled logic warrants it beyond what the existing
  `amazon-cart.test.js` regression test already covers for the click/reload
  path).
- Manual verification: start a queue, pause mid-flight, confirm the tab
  stops acting on reload; resume and confirm it picks back up; skip the
  in-progress item and confirm it's marked skipped and the queue advances
  without any click happening on the Amazon tab.
