# Grocery List to Whole Foods Cart (Chrome Extension)

A Manifest V3 Chrome extension that pushes your `meal-idea-app` grocery list
into a Whole Foods cart on amazon.com. There is no official Whole
Foods/Amazon cart API for third parties, so this works by reading a JSON
export the app already renders and then either opening scoped Amazon search
tabs for you (assisted mode) or attempting to drive amazon.com's own page
directly (automated mode).

## Loading the extension (unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked**.
4. Select this `extension/` directory.
5. Open the meal-idea-app grocery list, either the deployed app at
   `https://jacobwill2501.github.io/meal-idea-app` or locally at
   `http://localhost:3000`, and click the extension's toolbar icon.

## How it works

- `content-scripts/app-reader.js` runs on the app's pages. It reads the
  hidden `#grocery-export-data` element, parses its JSON, and mirrors it
  into `chrome.storage.local` under `groceryExport`. A `MutationObserver`
  keeps this in sync live as you edit your list — no reload needed.
- `popup.js` reads `groceryExport` from storage and renders it.
- `content-scripts/amazon-cart.js` runs on amazon.com and drives the
  automated cart flow described below.

## Two modes

### Assisted mode (the reliable one)

For each grocery item, the popup shows a quantity and an "Open in Whole
Foods" button that opens
`https://www.amazon.com/s?k=<item name>&i=wholefoods` in a new tab — a
stable, scrape-free search URL scoped to Whole Foods results. An "Open all"
button does this for every item at once. You then click "Add to cart"
yourself on each resulting page.

This mode never touches amazon.com's DOM, needs only the `tabs`
permission, and can't break just because Amazon changes their page markup.
It alone satisfies the "get my groceries into the cart in a few clicks"
bar, and is the one to trust.

### Automated mode (best-effort, expect rough edges)

A "Send to Whole Foods Cart" button seeds a `cartQueue` object into
`chrome.storage.local` (`{ items, results, currentIndex }`) and opens/reuses
an amazon.com tab. `amazon-cart.js` then works through the queue one item
at a time: navigate to that item's Whole-Foods-scoped search, look for a
matching result, try to click its "Add to cart" control (adjusting quantity
if a control for that exists), and record the outcome as `added`,
`ambiguous` (multiple/uncertain matches), or `not_found` (no result or no
add-to-cart control). Because every step is a real page navigation that
tears down and reloads the content script, all of this state lives in
`chrome.storage.local`, not in-memory JS.

The popup subscribes to `chrome.storage.onChanged` and renders live
per-item status, with a **Retry** action and an **Open manually** escape
hatch (falls back to the assisted-mode search URL) for anything marked
`ambiguous` or `not_found`.

## Risks

- **No official API.** This is UI automation against amazon.com's live,
  unversioned DOM. It is inherently fragile — Amazon can change markup,
  flows, or behavior at any time without notice, and this extension will
  need ongoing maintenance to keep working.
- **Terms of use.** Automated interaction with amazon.com may run against
  Amazon's Conditions of Use around automated cart manipulation, and may
  trigger CAPTCHAs or other bot detection. This is a known, accepted
  trade-off for this project, not an oversight — use automated mode at
  your own discretion, and prefer assisted mode when in doubt.
- **Unverified selectors.** The DOM selectors in `amazon-cart.js` were
  written without a live, logged-in amazon.com session to inspect. They are
  placeholders pending real iteration against the live site, and are
  written defensively (existence checks before every query, default to
  `not_found` on uncertainty) so failures degrade gracefully into "use
  assisted mode for this one" rather than throwing or silently misfiring.
