# Learning Item→Product Matcher for the Whole Foods Cart Extension

## Problem

The extension's automated mode (`extension/content-scripts/amazon-cart.js`) currently marks an
item `ambiguous` whenever the Amazon search page returns more than one result — which is
essentially always. In practice nearly every item comes back ambiguous and the automation adds
almost nothing. The user wants the extension to (a) make a reasonable first guess, and (b) get
better every time it's used, converging toward one-click cart fills for a recurring grocery list.

## Decisions (made with the user)

- **Learning mode:** both — a heuristic makes the first guess automatically, and anything the
  user resolves or corrects manually is remembered as a pinned item→product mapping that
  overrides the heuristic forever after.
- **Teach flow:** pick-from-popup. The content script captures the top candidates from the
  search page; the popup shows them as a mini picker; clicking one pins it and re-runs the item.
- **Memory store:** `chrome.storage.local`, alongside the existing `groceryExport` and
  `cartQueue` keys. No new infrastructure.
- **Pinned add path:** product-page add. Pinned items navigate to `amazon.com/dp/<ASIN>` and use
  the product page's add-to-cart controls (`#add-to-cart-button`, `#quantity`), which are far
  more stable than search-results markup. The legacy bulk cart-add form
  (`/gp/aws/cart/add.html?ASIN.1=…`) was rejected for v1 because it is unverified whether it
  targets the Whole Foods cart vs. the regular Amazon cart (they are separate carts); it remains
  a possible future experiment.

## Components

### 1. Matching heuristic — `extension/lib/matcher.js` (new, pure JS)

A dependency-free scoring module usable from both the content script and Jest:

- `normalizeTokens(name)`: lowercase, strip punctuation, drop stop-words ("of", "and", "fresh",
  "the", "a", etc.), return the remaining meaningful tokens.
- `scoreTitle(itemTokens, title)`: fraction of item tokens present in the (normalized) product
  title. Range 0–1.
- `pickBest(itemName, candidates)`: given `[{asin, title, ...}]`, returns
  `{ decision: 'auto_add' | 'ambiguous', best, scored }`. `auto_add` requires the top candidate
  to contain **all** meaningful item tokens (score = 1) **and** beat the runner-up by a clear
  margin (runner-up score ≤ top − 0.25, or no runner-up). Anything less is `ambiguous`.

Exported with a `module.exports` guard so Jest can require it while the content script loads it
as a plain script (listed before `amazon-cart.js` in the manifest's `js` array).

### 2. Candidate capture — in `amazon-cart.js`

On every search-page evaluation (whether the outcome is `added` or `ambiguous`), capture the top
5 result candidates as `{asin, title, price, imageUrl}`:

- ASIN from the `data-asin` attribute on `[data-component-type="s-search-result"]` containers
  (comparatively stable Amazon markup).
- Title/price/image read defensively; missing fields are stored as `null` rather than skipping
  the candidate. A candidate without an ASIN is skipped.

Candidates are stored on that item's entry in `cartQueue.results[i].candidates`. For `added`
results, also record `cartQueue.results[i].addedAsin` so a wrong guess can be corrected later.
If capture fails entirely, the result keeps today's behavior and the popup falls back to the
existing "Open manually" link.

### 3. Pinned-mapping store — `chrome.storage.local` key `pinnedProducts`

```json
{ "<normalized item name>": { "asin": "B0...", "title": "365 Organic Milk...", "pinnedAt": "ISO" } }
```

Normalization for the key reuses `normalizeTokens` joined with spaces, so "Chicken Breast" and
"chicken breast " map to the same pin.

### 4. Queue processing changes — `amazon-cart.js`

At each item, look up `pinnedProducts` first:

- **Pinned:** navigate to `https://www.amazon.com/dp/<ASIN>`. On that page: set quantity via the
  `#quantity` select if present (existing `setQuantity` fallback discipline), click
  `#add-to-cart-button`, mark `added` with `addedAsin`. Missing button → `not_found` (never
  throw). The `isOnSearchPageFor` routing gains a sibling `isOnProductPageFor(asin)` check
  (`/dp/<ASIN>` in the path).
- **Unpinned:** search flow as today, but the multi-result branch now runs
  `pickBest` over captured candidates: `auto_add` → click that result's add-to-cart control and
  mark `added`; `ambiguous` → mark `ambiguous` with candidates attached. Zero results and
  missing-control cases keep their current `not_found` behavior.

All state stays in `chrome.storage.local` (page navigations tear down the content script), and
every new DOM read keeps the existing existence-check / default-to-`not_found` discipline.

### 5. Popup teach flow — `popup.js` / `popup.html` / `popup.css`

- **Ambiguous rows** expand to show the captured candidates (thumbnail, title, price). Clicking
  a candidate writes it into `pinnedProducts` and immediately re-runs that item via the existing
  `retryItem` mechanics — which now routes it through the pinned product-page path.
- **Added rows** get a subtle "wrong item?" affordance opening the same picker (from the run's
  captured candidates), so bad heuristic guesses are correctable. Picking a different product
  pins it and re-runs the item. (Removing the wrongly added product from the cart remains a
  manual step; the popup notes this.)
- **Pinned indicator:** rows whose item has a pin show 📌 plus the pinned product title, with an
  unpin control that deletes the mapping.
- Candidate-less ambiguous rows (capture failed) keep today's "Retry" / "Open manually" actions.

## The improvement loop

Run 1: the heuristic auto-adds unambiguous matches; the user resolves ambiguities once from the
popup. Run 2+: every previously resolved item goes straight through the stable product-page
path; only new items hit the search heuristic. The list of pins grows monotonically with use.

## Error handling

- No new failure mode may throw out of the content script; every branch degrades to
  `ambiguous` (with whatever candidates were captured) or `not_found`.
- Pinned adds that fail (product gone, button missing) mark `not_found`; the popup's existing
  escape hatches (retry, open manually) plus the unpin control cover recovery. A dead pin can be
  unpinned and re-resolved from fresh candidates.
- `chrome.storage` read/write callbacks keep the existing callback style used throughout the
  extension (no async/await migration in this change).

## Testing

- Jest unit tests for `extension/lib/matcher.js` only: token normalization, scoring, the
  `auto_add` vs `ambiguous` decision boundary (all-tokens + margin rule), and key normalization
  stability. Requires adding `extension/lib` to Jest's roots or letting the default glob find it.
- All DOM-dependent behavior (search capture, product-page add, popup picker) remains manual
  live iteration against a real logged-in amazon.com session, same as the existing extension
  code. Selectors stay flagged as unverified placeholders in code comments.

## Out of scope

- Bulk cart-add via `/gp/aws/cart/add.html` (future experiment; Whole Foods cart targeting
  unverified).
- Syncing pins across machines (`chrome.storage.sync`) or into Firestore.
- Automatically removing wrongly added products from the cart.
