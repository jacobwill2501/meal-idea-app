# Manual Grocery Upload — Design

**Date:** 2026-07-06
**Status:** Approved (user: "good")

## Problem

The extension mirrored the app's grocery list automatically via a content
script (`app-reader.js`) with a MutationObserver. This broke silently —
most likely because reloading the extension (v0.2.0) orphaned the content
script in the already-open app tab, so its `chrome.storage` writes failed
until a page refresh. The user also explicitly wants pickup to be manual:
an "Upload grocery list" button, and **no automatic pickup, ever**.

## Decision

Replace automatic mirroring with on-demand injection from the popup
(`chrome.scripting.executeScript`). Delete `app-reader.js` and its
`content_scripts` manifest entry. The upload button becomes the only
writer of the `groceryExport` storage key (besides "Clear extension
data", which removes it).

Rejected alternative: keeping a message-driven content script (no
observer). It needs no new permission but retains the orphaned-context
failure mode and keeps resident code on the page for no benefit.

## Behavior

- The upload section is **visible only when the active tab is on the
  meal-idea-app** (`https://jacobwill2501.github.io/meal-idea-app/*` or
  `http://localhost:3000/*`). On any other page it is hidden entirely.
- The app is an SPA, so the URL does not identify the Grocery List tab.
  The popup probes the page for `#grocery-export-data` (rendered only
  while the Grocery List tab is active):
  - Element present → button **enabled**.
  - Element absent → button **disabled** (user picked disabled-button over
    hint-text or hiding).
- Clicking the button injects a self-contained reader, parses the
  element's JSON, and writes it to `chrome.storage.local.groceryExport`.
  The popup's existing rendering (item list, assisted mode, send-to-cart)
  updates through the same storage key and `storage.onChanged` path it
  uses today — no downstream changes.
- Read failures (element vanished between probe and click, invalid JSON)
  surface as a short message under the button.

## Components

| Unit | Responsibility |
|------|----------------|
| `extension/lib/export-reader.js` | `readGroceryExport()` — closure-free function suitable for `executeScript`; reads `#grocery-export-data` from its executing document; returns `{ok: true, data}` or `{ok: false, error}` (`'not-found'`, `'invalid-json'`). Unit-tested in jsdom. |
| `extension/popup.js` | Active-tab check (URL prefix match), probe + button state, upload click handler, error line. Thin handlers; logic stays in the lib. |
| `extension/popup.html` | Upload section markup (button + error line), loads `lib/export-reader.js`. |
| `extension/manifest.json` | Remove the app-pages `content_scripts` entry; add `"scripting"` permission; bump version to 0.3.0. |
| `extension/content-scripts/app-reader.js` | Deleted. |

## Error handling

- Not on the app → section hidden (no probe attempted).
- Probe or injection fails (e.g., page still loading) → button disabled.
- Read returns `{ok: false}` → error line: "Couldn't read the grocery
  list — make sure the Grocery List tab is open, then try again."

## Testing

- jsdom unit tests for `readGroceryExport()`: happy path, missing
  element, invalid JSON.
- Popup wiring follows the existing untested-popup pattern (thin
  handlers over tested lib code).
- Live check (manual): button hidden off-app, disabled on other app
  tabs, enabled on Grocery List tab, upload renders items.
