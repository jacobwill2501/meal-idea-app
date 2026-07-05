# Clear Extension Data Control

## Problem

The extension's popup mirrors two pieces of `chrome.storage.local` state that can go stale or
get stuck: the `groceryExport` snapshot read from the app tab, and the `cartQueue` used by the
automated "Send to Cart" flow. Today the only way to reset either is to manually clear extension
storage via `chrome://extensions` or wait for the app tab to re-mutate the export element. Users
need a one-click way, from inside the popup itself, to blow away this local cache/view state
without touching anything they've taught the extension.

## Decision (made with the user)

Add a small "Clear extension data" button to the bottom of the popup that removes exactly two
`chrome.storage.local` keys: `groceryExport` and `cartQueue`.

**Hard requirement, confirmed twice with the user: `pinnedProducts` must never be touched by
this control.** `pinnedProducts` holds the user's learned item→product mappings (see
`docs/superpowers/specs/2026-07-05-learning-cart-matcher-design.md`) built up over repeated use.
Those mappings are expensive to rebuild (each one required resolving an ambiguous match by hand)
and are conceptually different from `groceryExport`/`cartQueue`, which are disposable, ephemeral
mirrors of transient state. The clear operation must call
`chrome.storage.local.remove(['groceryExport', 'cartQueue'])` — a two-key removal, never
`chrome.storage.local.clear()` and never a call that includes `pinnedProducts`.

## UI placement

A new section at the very bottom of `extension/popup.html`, below both existing sections:

1. `#assisted-mode` ("Open in Whole Foods")
2. `#automated-mode` ("Send to Cart (Experimental)")
3. **New:** a small utility/reset section containing a single "Clear extension data" button.

This section is visually a footer-style utility control, not a primary action — it should read
as distinct from the two feature sections above it (e.g. lighter weight, smaller, separated by
the same kind of top border/spacing the existing `.section` class already uses). It is not
gated behind the empty-state/has-data branching that `#assisted-mode` and `#automated-mode` use
(see below) — it should always be visible regardless of whether there's export data, since it's
useful to clear a stuck `cartQueue` even when `groceryExport` is currently empty.

## Behavior

On click, the handler calls:

```js
chrome.storage.local.remove(['groceryExport', 'cartQueue']);
```

No confirmation dialog. This is a deliberate choice, not an oversight: this control only resets
the extension's local cache/view of the grocery list and the in-progress cart automation queue.
It does not touch the user's actual saved grocery list, which lives in Firebase and is managed by
`src/services/groceryService.js` in the main app — nothing about the user's real data is at risk.
The action is also instantly reversible in the common case: reloading the app tab (or making any
edit to the grocery list) re-populates `groceryExport` within moments (see caveat below), and a
cleared `cartQueue` is regenerated the next time the user clicks "Send to Cart."

## Rendering — no new logic required

Verified directly against `extension/popup.js`: the existing `chrome.storage.onChanged` listener
at the bottom of the file already handles removed keys correctly, because `chrome.storage.local`
fires a change event with `newValue: undefined` when a key is removed via `.remove()`:

```js
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes[EXPORT_KEY]) {
    renderExport(changes[EXPORT_KEY].newValue);
  }
  if (changes[CART_QUEUE_KEY] || changes[PINNED_KEY]) {
    loadCartQueue();
  }
});
```

- `renderExport(undefined)` already falls into the `!exportData` branch (`popup.js` lines 73–79),
  which un-hides `#empty-state`, hides `#assisted-mode` and `#automated-mode`, and resets
  `exportMetaEl` to `"No export data yet."` — the same empty state the popup shows on first
  install before any export has ever synced. No new empty-state handling is needed.
- `loadCartQueue()` re-reads `[CART_QUEUE_KEY, PINNED_KEY]` from storage and calls
  `renderCartQueue(undefined, pinned)`, which hits the `!queue` branch (`popup.js` lines 174–177):
  it clears `cartQueueListEl.innerHTML` and leaves `sendToCartBtn` enabled. The queue list
  visually empties out with no extra code.

Because both keys are removed in the same `.remove()` call, both listeners fire from the same
underlying storage change and the popup ends up fully consistent after a single render pass. This
means the new feature needs **no new rendering logic** in `popup.js` beyond the click handler
itself — it is a pure consumer of code paths that already exist and are already exercised by
other flows (first install, and `retryItem`/`unpinItem` re-renders).

## Caveat: interaction with the app tab's MutationObserver (expected behavior, not a bug)

If the meal-idea-app tab is still open in the background when "Clear extension data" is clicked,
the popup will show the empty state — but only until the content script re-syncs. Per
`extension/content-scripts/app-reader.js`, the mirroring is driven by a `MutationObserver` on the
hidden `#grocery-export-data` element's parent, which only fires `readExportData()` again when
that DOM subtree actually mutates (`childList`/`characterData` changes). The observer does not
poll, and there is no periodic or on-focus re-read.

Consequently: **`groceryExport` stays cleared in the popup until the underlying grocery list
changes again** — either because the user edits the list in the app tab (any add/remove/check
triggers React to re-render `#grocery-export-data`, which fires the observer), or because the app
tab is reloaded (the initial `readExportData()` call on script injection re-populates it
immediately from whatever is currently in the DOM). This is intended: the clear button empties
the extension's *cache*, and the cache is naturally refilled the next time there's something new
to mirror. It should be documented as expected behavior, not treated as a bug to fix — no keep-
alive polling or forced re-read is being added as part of this feature.

## Files touched (for implementation, in a later session)

- `extension/popup.html` — new bottom section markup with the "Clear extension data" button.
- `extension/popup.js` — a `click` listener on the new button calling
  `chrome.storage.local.remove(['groceryExport', 'cartQueue'])`. No other changes to `popup.js`
  are required (see Rendering section above).
- `extension/popup.css` — minor styling for the new footer/utility section so it reads as
  visually distinct from the two primary-action sections above it.

## Testing

This is a small, purely DOM/`chrome.storage` interaction with no pure-logic surface to unit test
in Jest (unlike `extension/lib/matcher.js`, which has real branching logic worth covering).
Verification is manual, live in the loaded extension:

1. With a populated `groceryExport` and a non-empty `cartQueue` in storage, open the popup and
   click "Clear extension data".
2. Confirm the popup immediately shows the empty state (`#empty-state` visible, `#assisted-mode`
   and `#automated-mode` hidden) and the cart queue list is empty.
3. Inspect `chrome.storage.local` (via the extension's service worker DevTools or
   `chrome.storage.local.get(null, console.log)`) and confirm `groceryExport` and `cartQueue` are
   both absent, and `pinnedProducts` is present and unchanged from before the click.
4. With the app tab still open in the background, confirm the popup stays in the empty state
   until an edit is made to the grocery list in the app (or the app tab is reloaded), at which
   point `groceryExport` reappears and the popup renders it normally.

## Out of scope

- Any confirmation/undo UI for the clear action.
- Clearing or otherwise touching `pinnedProducts`.
- Forcing the content script to re-sync on demand (e.g. a "refresh" button, polling, or
  responding to tab focus) — the existing mutation-driven sync is left as-is.
- Any change to how the app itself stores or manages the grocery list in Firebase.
