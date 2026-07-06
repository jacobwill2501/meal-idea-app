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

- Nothing runs on the app's pages automatically. The popup shows an
  **Upload grocery list** button whenever the active tab is the
  meal-idea-app; it is enabled only while the app's Grocery List tab is
  active (detected by probing for the `#grocery-export-data` element with
  `chrome.scripting.executeScript`). Clicking it reads that element's JSON
  and stores it in `chrome.storage.local` under `groceryExport`. Edit your
  list in the app, click upload again to refresh the copy.
- `popup.js` reads `groceryExport` from storage and renders it; the
  stored copy only changes when you click **Upload grocery list** (or
  **Clear extension data**).
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

## Learning: it gets better every run

Automated mode now learns your product choices:

- **First encounter:** the extension scores search results against your item
  name. A single clear match is added automatically; anything uncertain is
  marked *Ambiguous* with the top candidates captured.
- **Teach it once:** in the popup, ambiguous items show those candidates —
  click the product you want. That choice is **pinned** (stored in
  `chrome.storage.local` under `pinnedProducts`) and the item is re-added
  immediately via its product page.
- **Every run after:** pinned items skip the matching heuristic and are added
  from their product page (`amazon.com/dp/<ASIN>`), the most stable
  automation path. Only new list items ever hit the search heuristic.
- **Corrections:** auto-added items show a *Wrong item?* link to re-pick and
  pin (remove the wrong product from your cart manually). Pinned rows show a
  📌 with an *Unpin* control if a product goes stale.

Pins live only in this browser profile and are lost if the extension is
removed.

## Cart queue architecture (v0.2.0)

All `cartQueue` state is owned by the background service worker
(`background.js`). Content scripts and the popup never write it directly:

- Content script → worker: `cs:pageReady` (what page am I on, what should I
  do), `cs:requestClick` (permission to click — granted at most once per
  item, ever), `cs:reportResult`.
- Popup → worker: `popup:start`, `popup:toggle`, `popup:skip`, `popup:retry`.
- Every mutation runs under a lock in the worker, so interleaved
  read-modify-write cycles (the cause of the 2026-07 re-add loops and the
  Pause button not sticking) cannot clobber each other.
- Pause **parks the queue tab** on the WFM storefront — navigation is what
  reliably stops a runaway page (it's why Skip worked when Pause didn't).
- Diagnostic logging: filter the tab console for `[wf-cart:cs]` and the
  service-worker console for `[wf-cart:bg]`. If a runaway add ever recurs,
  those lines show exactly which click was granted and why.

## Live verification checklist (still open)

Run one small queue against a live, logged-in amazon.com session and check:

1. **WFM cart routing:** with `almBrandId=VUZHIFdob2xlIEZvb2Rz` on search
   (`&i=wholefoods`) and product (`&fpw=alm`) URLs, do added items land in
   the *Whole Foods* cart (not the main Amazon cart)? If not, capture the
   URL of a search you reach by hand from the WFM storefront and update
   `lib/urls.js` to match it.
2. **Selectors:** do `[data-component-type="s-search-result"]`,
   `button[name="submit.addToCart"]`, `#add-to-cart-button`, and
   `#quantity` still match? Iterate in `content-scripts/amazon-cart.js`.
3. **Runaway watch:** after one item auto-adds, watch the cart count for
   ~30s. If it keeps climbing with no `[wf-cart:cs] clicking` log lines,
   the page itself is looping (quantity-stepper feedback) — the fix then
   belongs in `setQuantity`, and Pause will still stop it by parking.

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
