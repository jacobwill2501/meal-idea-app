# Learning Item→Product Matcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Chrome extension's automated Whole Foods cart mode guess the right product heuristically and permanently learn from the user's manual resolutions, so recurring grocery lists converge toward one-click cart fills.

**Architecture:** A pure scoring module (`extension/lib/matcher.js`, Jest-tested) decides auto-add vs. ambiguous from captured search candidates. `amazon-cart.js` captures the top-5 candidates on every search evaluation and routes pinned items to the stable product-page add path (`/dp/<ASIN>`). The popup shows captured candidates as a picker; picking one writes a pin to `chrome.storage.local.pinnedProducts` and re-runs the item.

**Tech Stack:** Plain JS Chrome Extension (Manifest V3, no bundler), Jest 30 (jsdom) for the pure module only. No new dependencies.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-05-learning-cart-matcher-design.md`.
- No new failure mode may throw out of a content script; every branch degrades to `ambiguous` (with captured candidates when available) or `not_found`.
- All extension state lives in `chrome.storage.local` (page navigations tear down content scripts). Keys: `groceryExport`, `cartQueue`, and new `pinnedProducts`.
- Keep the extension's existing callback style for `chrome.storage` (no async/await migration).
- `extension/` has no bundler: content scripts are classic scripts. `matcher.js` must work both as a classic script (global `GroceryMatcher`) and as a CommonJS module for Jest.
- Amazon DOM selectors remain unverified placeholders; keep the existing header-comment discipline in `amazon-cart.js` and existence checks before every DOM query.
- Commit style: lowercase type prefixes (`feat:`, `test:`, `fix:`, `chore:`, `docs:`), body trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Work directly on `main`; run `git pull origin main` before starting and push after each task's commit.

---

### Task 1: Pure matching module `extension/lib/matcher.js` (TDD)

**Files:**
- Create: `extension/lib/matcher.js`
- Test: `extension/lib/matcher.test.js`

**Interfaces:**
- Consumes: nothing (pure, dependency-free).
- Produces (used by Tasks 2–5 via the `GroceryMatcher` global, and by Jest via `require`):
  - `normalizeTokens(name: string) -> string[]` — lowercase, punctuation stripped, stop-words removed.
  - `normalizeKey(name: string) -> string` — `normalizeTokens(name).join(' ')`; the canonical `pinnedProducts` key.
  - `scoreTitle(itemTokens: string[], title: string) -> number` — fraction of item tokens present in the title, 0–1.
  - `pickBest(itemName: string, candidates: Array<{asin: string, title: string|null}>) -> { decision: 'auto_add'|'ambiguous', best: candidate|null, scored: Array<{candidate, score}> }`.

- [ ] **Step 1: Write the failing tests**

Create `extension/lib/matcher.test.js`:

```js
const { normalizeTokens, normalizeKey, scoreTitle, pickBest } = require('./matcher');

describe('normalizeTokens', () => {
  test('lowercases, strips punctuation, drops stop words', () => {
    expect(normalizeTokens('Fresh Chicken-Breast, of the day')).toEqual(['chicken', 'breast', 'day']);
  });

  test('handles empty and non-string input', () => {
    expect(normalizeTokens('')).toEqual([]);
    expect(normalizeTokens(null)).toEqual([]);
    expect(normalizeTokens(undefined)).toEqual([]);
  });
});

describe('normalizeKey', () => {
  test('same key for spacing/case/punctuation variants', () => {
    expect(normalizeKey('Chicken Breast')).toBe('chicken breast');
    expect(normalizeKey('  chicken   breast ')).toBe('chicken breast');
    expect(normalizeKey('chicken, breast')).toBe('chicken breast');
  });
});

describe('scoreTitle', () => {
  test('full overlap scores 1', () => {
    expect(scoreTitle(['chicken', 'breast'], 'Boneless Skinless Chicken Breast 2lb')).toBe(1);
  });

  test('partial overlap scores fractionally', () => {
    expect(scoreTitle(['chicken', 'breast'], 'Chicken Thighs Family Pack')).toBe(0.5);
  });

  test('empty item tokens score 0', () => {
    expect(scoreTitle([], 'Anything')).toBe(0);
  });
});

describe('pickBest', () => {
  const c = (asin, title) => ({ asin, title });

  test('auto_add when top contains all tokens and beats runner-up by clear margin', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Boneless Chicken Breast'),
      c('A2', 'Pork Chops'),
    ]);
    expect(result.decision).toBe('auto_add');
    expect(result.best.asin).toBe('A1');
  });

  test('auto_add with a single all-token candidate (no runner-up)', () => {
    const result = pickBest('milk', [c('A1', 'Whole Milk Gallon')]);
    expect(result.decision).toBe('auto_add');
    expect(result.best.asin).toBe('A1');
  });

  test('ambiguous when runner-up is within the margin', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Organic Chicken Breast'),
      c('A2', 'Chicken Breast Tenders'),
    ]);
    expect(result.decision).toBe('ambiguous');
    expect(result.best).toBeNull();
  });

  test('ambiguous when top result lacks a token, even alone', () => {
    const result = pickBest('almond milk', [c('A1', 'Whole Milk Gallon')]);
    expect(result.decision).toBe('ambiguous');
  });

  test('ambiguous on empty candidates and skips ASIN-less candidates', () => {
    expect(pickBest('milk', []).decision).toBe('ambiguous');
    expect(pickBest('milk', [{ asin: null, title: 'Whole Milk' }]).decision).toBe('ambiguous');
  });

  test('scored list is sorted descending and covers all valid candidates', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Pork Chops'),
      c('A2', 'Boneless Chicken Breast'),
    ]);
    expect(result.scored.map((s) => s.candidate.asin)).toEqual(['A2', 'A1']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest extension/lib/matcher.test.js`
Expected: FAIL — `Cannot find module './matcher'`.

- [ ] **Step 3: Write the implementation**

Create `extension/lib/matcher.js`:

```js
// Pure matching heuristics for pairing a grocery item name with Amazon
// search-result candidates. No DOM or chrome.* usage so it can be
// unit-tested with Jest; content scripts consume it via the
// GroceryMatcher global (loaded before them in manifest.json).

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'or', 'with', 'for', 'fresh',
]);

// Ambiguous unless the runner-up trails the top score by at least this much.
const CLEAR_MARGIN = 0.25;

function normalizeTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

function normalizeKey(name) {
  return normalizeTokens(name).join(' ');
}

function scoreTitle(itemTokens, title) {
  if (!Array.isArray(itemTokens) || itemTokens.length === 0) return 0;
  const titleTokens = new Set(normalizeTokens(title));
  const hits = itemTokens.filter((token) => titleTokens.has(token)).length;
  return hits / itemTokens.length;
}

function pickBest(itemName, candidates) {
  const itemTokens = normalizeTokens(itemName);
  const list = Array.isArray(candidates) ? candidates : [];
  const scored = list
    .filter((candidate) => candidate && candidate.asin)
    .map((candidate) => ({ candidate, score: scoreTitle(itemTokens, candidate.title || '') }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || itemTokens.length === 0) {
    return { decision: 'ambiguous', best: null, scored };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  const clearMargin = !runnerUp || runnerUp.score <= top.score - CLEAR_MARGIN;

  if (top.score === 1 && clearMargin) {
    return { decision: 'auto_add', best: top.candidate, scored };
  }
  return { decision: 'ambiguous', best: null, scored };
}

const GroceryMatcher = { normalizeTokens, normalizeKey, scoreTitle, pickBest };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroceryMatcher;
}
if (typeof globalThis !== 'undefined') {
  globalThis.GroceryMatcher = GroceryMatcher;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/lib/matcher.test.js`
Expected: PASS, all tests green.

Then run the full suite to confirm nothing else broke: `npx jest`
Expected: all suites pass (the pre-existing `src/` suites plus this one).

- [ ] **Step 5: Commit**

```bash
git add extension/lib/matcher.js extension/lib/matcher.test.js
git commit -m "feat: add pure item-title matching module for cart automation

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Candidate capture + heuristic auto-add in `amazon-cart.js`

**Files:**
- Modify: `extension/manifest.json` (amazon content-script entry)
- Modify: `extension/content-scripts/amazon-cart.js`

**Interfaces:**
- Consumes: `GroceryMatcher.pickBest(itemName, candidates)` global from Task 1.
- Produces (relied on by Tasks 4–5): `cartQueue.results[i]` entries now shaped
  `{ name, quantity, status, candidates?: Array<{asin, title, price, imageUrl}>, addedAsin?: string }`.
  `candidates` is present on `ambiguous` results (picker source) and on heuristic `added` results
  (wrong-item correction source). `addedAsin` is present on `added` results.

- [ ] **Step 1: Load the matcher before `amazon-cart.js` in the manifest**

In `extension/manifest.json`, change the amazon.com content-script entry:

```json
    {
      "matches": ["https://www.amazon.com/*"],
      "js": ["lib/matcher.js", "content-scripts/amazon-cart.js"],
      "run_at": "document_idle"
    }
```

- [ ] **Step 2: Generalize `recordResult` to carry extra fields**

In `extension/content-scripts/amazon-cart.js`, replace the existing `recordResult` and the three
`mark*` helpers (`markNotFound`, `markAmbiguous`, `markAdded`) with:

```js
function recordResult(queue, index, status, extra) {
  const results = Array.isArray(queue.results) ? queue.results.slice() : [];
  const item = queue.items[index];
  results[index] = { name: item.name, quantity: item.quantity, status, ...(extra || {}) };

  const nextIndex = index + 1;
  const updatedQueue = {
    ...queue,
    results,
    currentIndex: nextIndex,
  };

  saveQueue(updatedQueue, () => {
    if (nextIndex < queue.items.length) {
      window.location.href = wholeFoodsSearchUrl(queue.items[nextIndex].name);
    }
    // Otherwise the queue is complete; nothing further to navigate to.
  });
}

function markNotFound(queue, index, extra) {
  recordResult(queue, index, 'not_found', extra);
}
```

(The `markAmbiguous`/`markAdded` helpers go away; the search flow below calls `recordResult`
directly with its extras.)

- [ ] **Step 3: Add candidate capture**

Add below `findSearchResults()`:

```js
// Best-effort: extract comparable candidate data from search-result
// containers. data-asin is among Amazon's more stable attributes, but all
// inner selectors here are unverified placeholders.
function captureCandidates(resultEls) {
  return resultEls
    .slice(0, 5)
    .map((el) => {
      const asin = el.getAttribute('data-asin');
      if (!asin) return null;
      const titleEl = el.querySelector('h2 a span, h2 span');
      const priceEl = el.querySelector('.a-price .a-offscreen');
      const imgEl = el.querySelector('img.s-image');
      return {
        asin,
        title: titleEl ? titleEl.textContent.trim() : null,
        price: priceEl ? priceEl.textContent.trim() : null,
        imageUrl: imgEl ? imgEl.src : null,
      };
    })
    .filter(Boolean);
}
```

- [ ] **Step 4: Replace the search-page decision logic**

In `processCurrentItem`, replace the entire body of the outer `setTimeout` (the block that starts
with `const results = findSearchResults();` and currently contains the `results.length > 1 →
markAmbiguous` branch) with:

```js
    const results = findSearchResults();

    if (results.length === 0) {
      markNotFound(queue, currentIndex);
      return;
    }

    const candidates = captureCandidates(results);
    const { decision, best } = GroceryMatcher.pickBest(item.name, candidates);

    if (decision !== 'auto_add') {
      recordResult(queue, currentIndex, 'ambiguous', { candidates });
      return;
    }

    const resultEl = results.find((el) => el.getAttribute('data-asin') === best.asin);
    const addToCartControl = findAddToCartControl(resultEl);

    if (!addToCartControl) {
      // Confident match but no way to add it from the search page — let the
      // user resolve it from the popup picker instead of failing outright.
      recordResult(queue, currentIndex, 'ambiguous', { candidates });
      return;
    }

    setQuantity(resultEl, item.quantity || 1);

    try {
      addToCartControl.click();
    } catch (err) {
      console.warn('[amazon-cart] add-to-cart click failed:', err);
      markNotFound(queue, currentIndex, { candidates });
      return;
    }

    // Give the click a moment to register (cart update, confirmation
    // modal, etc.) before we consider the item added.
    setTimeout(() => {
      recordResult(queue, currentIndex, 'added', { candidates, addedAsin: best.asin });
    }, SETTLE_DELAY_MS);
```

- [ ] **Step 5: Static checks**

Run: `node --check extension/content-scripts/amazon-cart.js && node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"`
Expected: no output from `--check`, then `manifest ok`.

Also run `npx jest` — expected: all pass (no src/ files touched).

- [ ] **Step 6: Commit**

```bash
git add extension/manifest.json extension/content-scripts/amazon-cart.js
git commit -m "feat: capture search candidates and auto-add confident matches

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Pinned product-page add path in `amazon-cart.js`

**Files:**
- Modify: `extension/content-scripts/amazon-cart.js`

**Interfaces:**
- Consumes: `GroceryMatcher.normalizeKey(name)` (Task 1); `recordResult(queue, index, status, extra)` (Task 2).
- Produces (relied on by Task 4): reads `chrome.storage.local.pinnedProducts` shaped
  `{ [normalizedItemName]: { asin: string, title: string|null, pinnedAt: string } }`; a pinned
  item bypasses search and is added from `https://www.amazon.com/dp/<ASIN>`.

- [ ] **Step 1: Add the pinned-store key and product-page helpers**

Below the existing `const CART_QUEUE_KEY = 'cartQueue';` add:

```js
const PINNED_KEY = 'pinnedProducts';
```

Below `isOnSearchPageFor` add:

```js
function productPageUrl(asin) {
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
}

function isOnProductPageFor(asin) {
  return window.location.pathname.includes(`/dp/${asin}`);
}
```

- [ ] **Step 2: Add the pinned-item processor**

Add above `processCurrentItem`:

```js
// Pinned items skip search entirely: the product page's add-to-cart
// controls (#add-to-cart-button, #quantity) are far more stable than
// search-results markup. Selectors still unverified pending live use.
function processPinnedItem(queue, index, item, pin) {
  if (!isOnProductPageFor(pin.asin)) {
    window.location.href = productPageUrl(pin.asin);
    return;
  }

  setTimeout(() => {
    const addBtn = document.getElementById('add-to-cart-button');
    if (!addBtn) {
      // Product gone or page layout unrecognized — surface for manual
      // recovery (popup offers retry / open manually / unpin).
      recordResult(queue, index, 'not_found', { pinnedAsin: pin.asin });
      return;
    }

    const qtySelect = document.getElementById('quantity');
    const quantity = item.quantity || 1;
    if (qtySelect && qtySelect.tagName === 'SELECT') {
      const optionExists = Array.from(qtySelect.options).some(
        (opt) => opt.value === String(quantity)
      );
      if (optionExists) {
        qtySelect.value = String(quantity);
        qtySelect.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    try {
      addBtn.click();
    } catch (err) {
      console.warn('[amazon-cart] pinned add-to-cart click failed:', err);
      recordResult(queue, index, 'not_found', { pinnedAsin: pin.asin });
      return;
    }

    setTimeout(() => {
      recordResult(queue, index, 'added', { addedAsin: pin.asin });
    }, SETTLE_DELAY_MS);
  }, SETTLE_DELAY_MS);
}
```

- [ ] **Step 3: Route pinned items in `processCurrentItem` and `init`**

Change `processCurrentItem`'s signature to `function processCurrentItem(queue, pinned)` and,
directly after the existing `if (!item || !item.name) { ... }` guard, insert:

```js
  const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
  if (pin && pin.asin) {
    processPinnedItem(queue, currentIndex, item, pin);
    return;
  }
```

Replace `init` with:

```js
function init() {
  chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
    const queue = result[CART_QUEUE_KEY];
    const pinned = result[PINNED_KEY] || {};
    if (!queue || !Array.isArray(queue.items) || queue.items.length === 0) {
      return;
    }
    if (queue.currentIndex >= queue.items.length) {
      // Already complete, nothing to do on this load.
      return;
    }
    processCurrentItem(queue, pinned);
  });
}
```

- [ ] **Step 4: Static checks**

Run: `node --check extension/content-scripts/amazon-cart.js && npx jest`
Expected: clean `--check`, all Jest suites pass.

- [ ] **Step 5: Commit**

```bash
git add extension/content-scripts/amazon-cart.js
git commit -m "feat: add pinned product-page add path for learned items

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Popup candidate picker — resolve ambiguous items and pin

**Files:**
- Modify: `extension/popup.html`
- Modify: `extension/popup.js`
- Modify: `extension/popup.css`

**Interfaces:**
- Consumes: `GroceryMatcher.normalizeKey` (Task 1); `cartQueue.results[i].candidates` (Task 2);
  `pinnedProducts` shape (Task 3); existing `retryItem(index)` in `popup.js`.
- Produces (relied on by Task 5): `pinAndRerun(index, candidate)` and a
  `renderCandidatePicker(item, index, candidates)` element builder; `renderCartQueue(queue, pinned)`
  now takes the pinned map as its second argument; `loadCartQueue()` reads both keys.

- [ ] **Step 1: Load the matcher in the popup page**

In `extension/popup.html`, change the script include at the bottom to load the matcher first:

```html
    <script src="lib/matcher.js"></script>
    <script src="popup.js"></script>
```

- [ ] **Step 2: Add pin plumbing to `popup.js`**

Below `const CART_QUEUE_KEY = 'cartQueue';` add:

```js
const PINNED_KEY = 'pinnedProducts';
```

Add these functions above `renderCartQueue`:

```js
function pinAndRerun(index, candidate) {
  chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
    const queue = result[CART_QUEUE_KEY];
    if (!queue || !Array.isArray(queue.items) || !queue.items[index]) {
      return;
    }
    const pinned = result[PINNED_KEY] || {};
    const key = GroceryMatcher.normalizeKey(queue.items[index].name);
    pinned[key] = {
      asin: candidate.asin,
      title: candidate.title || null,
      pinnedAt: new Date().toISOString(),
    };
    chrome.storage.local.set({ [PINNED_KEY]: pinned }, () => {
      retryItem(index);
    });
  });
}

function renderCandidatePicker(item, index, candidates) {
  const picker = document.createElement('ul');
  picker.className = 'candidate-list';

  candidates.forEach((candidate) => {
    const li = document.createElement('li');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'candidate';
    btn.addEventListener('click', () => pinAndRerun(index, candidate));

    if (candidate.imageUrl) {
      const img = document.createElement('img');
      img.src = candidate.imageUrl;
      img.alt = '';
      btn.appendChild(img);
    }

    const label = document.createElement('span');
    label.className = 'candidate-title';
    label.textContent = candidate.title || candidate.asin;
    btn.appendChild(label);

    if (candidate.price) {
      const price = document.createElement('span');
      price.className = 'candidate-price';
      price.textContent = candidate.price;
      btn.appendChild(price);
    }

    li.appendChild(btn);
    picker.appendChild(li);
  });

  return picker;
}
```

- [ ] **Step 3: Wire the picker into ambiguous rows**

In `renderCartQueue`, change the signature to `function renderCartQueue(queue, pinned)` (Task 5
uses `pinned`; accept it now so the call sites are final). The existing loop appends `info` and
`actions` to the row at its very end (`li.appendChild(info); li.appendChild(actions);`) — the
picker must come after those so it renders below the row's name and buttons. Directly after
`li.appendChild(actions);` (and before `cartQueueListEl.appendChild(li);`), add:

```js
    if (status === 'ambiguous' && result && Array.isArray(result.candidates) && result.candidates.length > 0) {
      li.appendChild(renderCandidatePicker(item, index, result.candidates));
    }
```

Candidate-less ambiguous rows keep today's Retry / Open manually actions unchanged.

- [ ] **Step 4: Read both keys everywhere the queue is rendered**

Replace `loadCartQueue` with:

```js
function loadCartQueue() {
  chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
    renderCartQueue(result[CART_QUEUE_KEY], result[PINNED_KEY] || {});
  });
}
```

In the `chrome.storage.onChanged` listener, replace the `changes[CART_QUEUE_KEY]` branch with:

```js
  if (changes[CART_QUEUE_KEY] || changes[PINNED_KEY]) {
    loadCartQueue();
  }
```

- [ ] **Step 5: Picker styles**

Append to `extension/popup.css`:

```css
.candidate-list {
  list-style: none;
  margin: 6px 0 0;
  padding: 0;
  width: 100%;
}

.candidate-list li + li {
  margin-top: 4px;
}

.candidate {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px;
  border: 1px solid #ddd;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
  text-align: left;
  font: inherit;
}

.candidate:hover {
  border-color: #2e7d32;
  background: #f4faf4;
}

.candidate img {
  width: 32px;
  height: 32px;
  object-fit: contain;
  flex: none;
}

.candidate-title {
  flex: 1;
  font-size: 12px;
  line-height: 1.3;
}

.candidate-price {
  flex: none;
  font-size: 12px;
  font-weight: 600;
}
```

- [ ] **Step 6: Static checks**

Run: `node --check extension/popup.js && npx jest`
Expected: clean `--check`, all Jest suites pass.

- [ ] **Step 7: Commit**

```bash
git add extension/popup.html extension/popup.js extension/popup.css
git commit -m "feat: pick-and-pin candidate resolver for ambiguous cart items

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Wrong-item correction, pinned indicator, and unpin

**Files:**
- Modify: `extension/popup.js`
- Modify: `extension/popup.css`

**Interfaces:**
- Consumes: `pinAndRerun(index, candidate)`, `renderCandidatePicker(item, index, candidates)`,
  `renderCartQueue(queue, pinned)`, `loadCartQueue()` from Task 4; `pinnedProducts` shape from Task 3.
- Produces: `unpinItem(itemName)`; final popup behavior per spec.

- [ ] **Step 1: Add `unpinItem`**

Add below `pinAndRerun` in `extension/popup.js`:

```js
function unpinItem(itemName) {
  chrome.storage.local.get(PINNED_KEY, (result) => {
    const pinned = result[PINNED_KEY] || {};
    delete pinned[GroceryMatcher.normalizeKey(itemName)];
    chrome.storage.local.set({ [PINNED_KEY]: pinned });
    // storage.onChanged re-renders the queue with the pin removed.
  });
}
```

- [ ] **Step 2: Pinned indicator + unpin control on every queue row**

In `renderCartQueue`, inside the `queue.items.forEach((item, index) => { ... })` loop, after
`info.appendChild(qtyEl);`, add:

```js
    const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
    if (pin) {
      const pinEl = document.createElement('span');
      pinEl.className = 'pin-indicator';
      pinEl.textContent = `\u{1F4CC} ${pin.title || pin.asin}`;

      const unpinBtn = document.createElement('button');
      unpinBtn.type = 'button';
      unpinBtn.className = 'btn-link';
      unpinBtn.textContent = 'Unpin';
      unpinBtn.addEventListener('click', () => unpinItem(item.name));
      pinEl.appendChild(unpinBtn);

      info.appendChild(pinEl);
    }
```

- [ ] **Step 3: "Wrong item?" correction on added rows**

Still inside the loop, directly after Task 4's ambiguous-picker append (i.e., after
`li.appendChild(actions);` and the `status === 'ambiguous'` picker block, before
`cartQueueListEl.appendChild(li);`), add:

```js
    if (status === 'added' && result && Array.isArray(result.candidates) && result.candidates.length > 0) {
      const wrongBtn = document.createElement('button');
      wrongBtn.type = 'button';
      wrongBtn.className = 'btn-link';
      wrongBtn.textContent = 'Wrong item?';
      actions.appendChild(wrongBtn);

      const picker = renderCandidatePicker(item, index, result.candidates);
      picker.hidden = true;

      const note = document.createElement('p');
      note.className = 'hint';
      note.textContent =
        'Picking a product pins it and re-adds this item. Remove the wrong product from your cart manually.';
      note.hidden = true;

      wrongBtn.addEventListener('click', () => {
        picker.hidden = !picker.hidden;
        note.hidden = picker.hidden;
      });

      li.appendChild(note);
      li.appendChild(picker);
    }
```

(Added rows from the pinned path have `addedAsin` but no `candidates`, so they intentionally get
no "Wrong item?" toggle — the Unpin control from Step 2 is their correction path.)

- [ ] **Step 4: Styles for the new controls**

Append to `extension/popup.css`:

```css
.pin-indicator {
  display: block;
  font-size: 11px;
  color: #555;
  margin-top: 2px;
}

.btn-link {
  background: none;
  border: none;
  padding: 0;
  margin-left: 6px;
  color: #2e7d32;
  font-size: 11px;
  cursor: pointer;
  text-decoration: underline;
}
```

- [ ] **Step 5: Static checks**

Run: `node --check extension/popup.js && npx jest`
Expected: clean `--check`, all Jest suites pass.

- [ ] **Step 6: Commit**

```bash
git add extension/popup.js extension/popup.css
git commit -m "feat: wrong-item correction and unpin controls in popup

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: README update + final verification

**Files:**
- Modify: `extension/README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: user-facing docs for the learning loop.

- [ ] **Step 1: Document the learning behavior**

In `extension/README.md`, add a section after the automated-mode description (adapt heading
levels to the existing file):

```markdown
## Learning: it gets better every run

Automated mode now learns your product choices:

- **First encounter:** the extension scores search results against your item
  name. A single clear match is added automatically; anything uncertain is
  marked *Ambiguous* with the top candidates captured.
- **Teach it once:** in the popup, ambiguous items show those candidates —
  click the product you want. That choice is **pinned** (stored in
  `chrome.storage.local` under `pinnedProducts`) and the item is re-added
  immediately via its product page.
- **Every run after:** pinned items skip search entirely and are added from
  their product page (`amazon.com/dp/<ASIN>`), the most stable automation
  path. Only new list items ever hit the search heuristic.
- **Corrections:** auto-added items show a *Wrong item?* link to re-pick and
  pin (remove the wrong product from your cart manually). Pinned rows show a
  📌 with an *Unpin* control if a product goes stale.

Pins live only in this browser profile and are lost if the extension is
removed.
```

- [ ] **Step 2: Full static verification**

Run:

```bash
node --check extension/lib/matcher.js
node --check extension/content-scripts/amazon-cart.js
node --check extension/popup.js
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"
npx jest
```

Expected: all clean; Jest fully green.

- [ ] **Step 3: Commit and push**

```bash
git add extension/README.md
git commit -m "docs: document the learning loop in extension README

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Report the manual verification list**

These cannot be automated and must be reported to the user as remaining manual steps:

1. Reload the unpacked extension (`chrome://extensions` → refresh icon) — no manifest/console errors.
2. Run "Send to Whole Foods Cart" on a real list: confirm confident matches auto-add and uncertain ones show candidate pickers in the popup.
3. Pick a candidate for an ambiguous item: confirm it pins, re-runs via `/dp/<ASIN>`, and lands in the Whole Foods cart.
4. Re-run the whole queue: confirm previously pinned items add without ever hitting a search page.
5. Confirm "Wrong item?" re-pick and "Unpin" behave as described.
6. Expect selector iteration: all Amazon DOM selectors remain unverified placeholders.
