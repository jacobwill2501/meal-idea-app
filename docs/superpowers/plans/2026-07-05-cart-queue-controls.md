# Cart Queue Pause/Skip/Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user see what the "Send to Cart" browser-extension automation is doing right now, pause it in place, resume it, and skip the item it's currently stuck on — without clearing the whole queue.

**Architecture:** Add a `paused` boolean and a `'skipped'` result status to the existing `cartQueue` object already stored in `chrome.storage.local`. The content script (`amazon-cart.js`) checks `paused` before taking any action. The popup (`popup.js`/`popup.html`/`popup.css`) adds a queue-level status line + Pause/Resume button, an "In progress" per-item label, and a Skip button — all built on the read/render/write cycle the popup already uses via `chrome.storage.onChanged`.

**Tech Stack:** Plain (non-module) browser-extension scripts loaded via `manifest.json` content_scripts and `popup.html` `<script>` tags. Jest + jsdom for the one file that already has automated coverage (`amazon-cart.js`); manual verification via the popup's own DevTools console for `popup.js`, matching this repo's existing test coverage boundary (see `docs/superpowers/specs/2026-07-05-cart-queue-controls-design.md`).

## Global Constraints

- Don't change the meaning of any existing `results[i].status` value (`'added' | 'ambiguous' | 'not_found'`) — only add new ones (`'skipped'`), per the design doc's data model section.
- `currentIndex` keeps meaning "first unresolved index" — don't introduce a second index concept.
- No new dependencies. No build-step changes.
- Match existing code style in each file: 2-space indent, semicolons, plain (non-strict, non-module) scripts with top-level `const`/`function` declarations, comments only where they explain a non-obvious "why" (this repo's existing files are already good examples — follow their voice).
- Cancel/pause is "stop in place," not "clear the queue" (that's the existing Clear Extension Data button) — confirmed with the user during brainstorming.
- Skip only ever applies to the current in-progress item — no jump-ahead-to-arbitrary-item UI, confirmed with the user during brainstorming.

---

### Task 1: Content script honors a `paused` flag

**Files:**
- Modify: `extension/content-scripts/amazon-cart.js:214-220` (start of `processCurrentItem`)
- Test: `extension/content-scripts/amazon-cart.test.js` (add a new test to the existing `describe` block)

**Interfaces:**
- Consumes: nothing new — reads `queue.paused` off the same `cartQueue` object `processCurrentItem(queue, pinned)` already receives.
- Produces: the guard clause other tasks rely on conceptually (popup tasks assume that setting `cartQueue.paused = true` actually stops the content script from acting) — no new exported function, just this behavior.

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe('amazon-cart reload-loop regression', ...)` block in `extension/content-scripts/amazon-cart.test.js` (after the existing test, before the closing `});` of the describe block):

```js
  test('does not click or navigate when the queue is paused', () => {
    const clickSpy = jest.fn();
    renderSearchResultsPage(clickSpy);
    store.cartQueue.paused = true;

    require('./amazon-cart.js');
    jest.advanceTimersByTime(800);

    expect(clickSpy).not.toHaveBeenCalled();
    expect(store.cartQueue.attempted).toBeUndefined();
    expect(store.cartQueue.results[0]).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest extension/content-scripts/amazon-cart.test.js -t "does not click or navigate when the queue is paused"`
Expected: FAIL — `clickSpy` was called once (the guard doesn't exist yet, so the script proceeds to click as normal).

- [ ] **Step 3: Add the pause guard**

In `extension/content-scripts/amazon-cart.js`, in `processCurrentItem`, add the guard immediately after the existing malformed/complete check (right after the `if (!Array.isArray(items) || currentIndex >= items.length) { ... return; }` block, before the `if (Array.isArray(queue.results) && queue.results[currentIndex])` block):

```js
  if (queue.paused) {
    // Paused: take no action (no click, no navigation) until the popup
    // clears this flag. Resuming re-navigates the tab to pick processing
    // back up, since a paused tab may be sitting idle on a stale page.
    return;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest extension/content-scripts/amazon-cart.test.js`
Expected: PASS — all 2 tests in this file pass (the original reload-loop regression test, plus the new pause test).

- [ ] **Step 5: Commit**

```bash
git add extension/content-scripts/amazon-cart.js extension/content-scripts/amazon-cart.test.js
git commit -m "feat: content script honors a paused flag on the cart queue"
```

---

### Task 2: Popup queue-level status line + Pause/Resume button

**Files:**
- Modify: `extension/popup.html:36-49` (`#automated-mode` section)
- Modify: `extension/popup.css` (append new rules)
- Modify: `extension/popup.js:11-19` (element lookups), `extension/popup.js:172-181` (start of `renderCartQueue`), `extension/popup.js:295-320` (near `navigateTabToItem`/`startCartQueue`), `extension/popup.js:381` (event wiring area)

**Interfaces:**
- Consumes: `queue.paused` (from Task 1), `queue.currentIndex`, `queue.items` — all already on the `cartQueue` object.
- Produces: nothing new consumed by later tasks (Tasks 3 and 4 render inside the same `renderCartQueue` function but don't call anything defined here).

- [ ] **Step 1: Add the status line and toggle button to the popup markup**

In `extension/popup.html`, replace the `#automated-mode` section's header:

```html
      <section id="automated-mode" class="section" hidden>
        <div class="section-header">
          <h2>Send to Cart (Experimental)</h2>
          <div class="section-header-actions">
            <button id="send-to-cart-btn" class="btn btn-primary" type="button">
              Send to Whole Foods Cart
            </button>
            <button
              id="queue-toggle-btn"
              class="btn btn-secondary"
              type="button"
              hidden
            >
              Pause
            </button>
          </div>
        </div>
        <p id="queue-status" class="queue-status" hidden></p>
        <p class="hint">
          Best-effort automation against amazon.com's live page. It can fail
          or misfire if Amazon changes their page. Use "Open in Whole Foods"
          above as the reliable fallback for anything that doesn't work.
        </p>
        <ul id="cart-queue-list" class="item-list"></ul>
      </section>
```

- [ ] **Step 2: Add CSS for the new elements**

Append to `extension/popup.css`:

```css
.section-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.queue-status {
  margin: 4px 0 0;
  font-size: 11.5px;
  color: #666;
}
```

- [ ] **Step 3: Wire up the element lookups and status renderer in popup.js**

In `extension/popup.js`, add two new element lookups next to the existing ones (after `const cartQueueListEl = document.getElementById('cart-queue-list');`):

```js
const queueToggleBtn = document.getElementById('queue-toggle-btn');
const queueStatusEl = document.getElementById('queue-status');
```

Add a new function above `renderCartQueue`:

```js
function renderQueueStatus(queue) {
  const active = queue && Array.isArray(queue.items) && queue.currentIndex < queue.items.length;

  if (!active) {
    queueStatusEl.hidden = true;
    queueToggleBtn.hidden = true;
    return;
  }

  queueStatusEl.hidden = false;
  queueStatusEl.textContent = queue.paused ? 'Paused' : 'Running';
  queueToggleBtn.hidden = false;
  queueToggleBtn.textContent = queue.paused ? 'Resume' : 'Pause';
}
```

Call it at the very start of `renderCartQueue`, right after the `cartQueueListEl.innerHTML = '';` line:

```js
function renderCartQueue(queue, pinned) {
  cartQueueListEl.innerHTML = '';
  renderQueueStatus(queue);

  if (!queue || !Array.isArray(queue.items)) {
```

- [ ] **Step 4: Add the toggle handler**

Add this function in `extension/popup.js`, near `retryItem` (both read-modify-write the queue the same way):

```js
function toggleQueuePause() {
  chrome.storage.local.get(CART_QUEUE_KEY, (result) => {
    const queue = result[CART_QUEUE_KEY];
    if (!queue || !Array.isArray(queue.items) || queue.currentIndex >= queue.items.length) {
      return;
    }

    const paused = !queue.paused;
    const updatedQueue = { ...queue, paused };

    chrome.storage.local.set({ [CART_QUEUE_KEY]: updatedQueue }, () => {
      if (!paused && queue.tabId != null) {
        // Resuming: the tab may be idle on a stale page (it no-oped while
        // paused), so re-navigate it to the current item to kick
        // processing off again.
        navigateTabToItem(queue.tabId, queue.items[queue.currentIndex]);
      }
    });
  });
}
```

Wire it up near the other event listeners (after `sendToCartBtn.addEventListener('click', startCartQueue);`):

```js
queueToggleBtn.addEventListener('click', toggleQueuePause);
```

- [ ] **Step 5: Manual verification**

There's no existing automated test coverage for `popup.js` (it's DOM-wiring code with no unit tests in this repo today — the design doc's Testing section calls this out explicitly). Verify by hand:

1. Run `npm run build` (rebuilds `public/bundle.js` — not required for the extension itself, but keep the repo's build in sync; the extension loads its own files directly).
2. Load the unpacked extension in Chrome (`chrome://extensions` → Developer mode → "Load unpacked" → select the `extension/` folder) if not already loaded.
3. Open the extension popup, right-click inside it, choose "Inspect" to get a DevTools console scoped to the popup page.
4. In that console, run:
   ```js
   chrome.storage.local.set({
     cartQueue: {
       items: [{ name: 'turkey', quantity: 1 }, { name: 'milk', quantity: 2 }],
       results: [],
       currentIndex: 0,
       tabId: 1,
     },
   });
   ```
5. Confirm the popup now shows a "Running" status line and a "Pause" button under "Send to Cart (Experimental)".
6. Click "Pause". Confirm the status flips to "Paused" and the button now reads "Resume".
7. In the console, run `chrome.storage.local.get('cartQueue', console.log)` and confirm `paused: true` is set.
8. Click "Resume". Confirm the status flips back to "Running" and the button reads "Pause" again.

- [ ] **Step 6: Commit**

```bash
git add extension/popup.html extension/popup.css extension/popup.js
git commit -m "feat: add queue status line and pause/resume control to popup"
```

---

### Task 3: Per-item "In progress" status label

**Files:**
- Modify: `extension/popup.js:93-104` (`statusLabel`), `extension/popup.js:184-186` (status derivation inside `renderCartQueue`'s `forEach`)
- Modify: `extension/popup.css` (append new rules)

**Interfaces:**
- Consumes: `queue.currentIndex`, `queue.paused` (from Task 1/2), `results[index]` — all already available inside `renderCartQueue`.
- Produces: the `status === 'in_progress'` / `status === 'paused'` values that Task 4's Skip button condition also checks — Task 4 must use these exact string values.

- [ ] **Step 1: Extend statusLabel with the two new labels**

In `extension/popup.js`, update `statusLabel`:

```js
function statusLabel(status) {
  switch (status) {
    case 'added':
      return 'Added';
    case 'ambiguous':
      return 'Ambiguous';
    case 'not_found':
      return 'Not found';
    case 'in_progress':
      return 'In progress';
    case 'paused':
      return 'Paused';
    default:
      return 'Pending';
  }
}
```

- [ ] **Step 2: Derive the in-progress/paused status per item**

In `extension/popup.js`, inside `renderCartQueue`'s `queue.items.forEach((item, index) => { ... })`, replace:

```js
    const result = results[index];
    const status = result ? result.status : 'pending';
```

with:

```js
    const result = results[index];
    const isCurrent = !result && index === queue.currentIndex;
    const status = result
      ? result.status
      : isCurrent
      ? (queue.paused ? 'paused' : 'in_progress')
      : 'pending';
```

- [ ] **Step 3: Add CSS for the two new statuses**

Append to `extension/popup.css`:

```css
.status-in_progress {
  background: #e6f0ff;
  color: #1a56c4;
}

.status-paused {
  background: #f0f0f0;
  color: #666;
}
```

- [ ] **Step 4: Manual verification**

Using the same popup DevTools console approach as Task 2:

1. Set a queue with `currentIndex: 0` and no results (as in Task 2's Step 5.4). Confirm the first item ("turkey") shows an "In progress" badge (light blue) and the second ("milk") shows "Pending" (gray).
2. Run `chrome.storage.local.set({ cartQueue: { items: [...], results: [], currentIndex: 0, tabId: 1, paused: true } })` (same items, `paused: true` added). Confirm "turkey" now shows a "Paused" badge instead of "In progress".

- [ ] **Step 5: Commit**

```bash
git add extension/popup.js extension/popup.css
git commit -m "feat: show an in-progress/paused badge on the current queue item"
```

---

### Task 4: Skip current item button

**Files:**
- Modify: `extension/popup.js:229-245` (retry/manual button block inside `renderCartQueue`'s `forEach`), plus a new `skipItem` function near `retryItem`
- Modify: `extension/popup.css` (append one new rule)

**Interfaces:**
- Consumes: `status === 'in_progress' || status === 'paused'` (the exact string values Task 3 introduced) to decide when to show the Skip button; `navigateTabToItem(tabId, item)` (existing function).
- Produces: the `'skipped'` result status value — nothing later in this plan consumes it, but it's part of the data model from the design doc.

- [ ] **Step 1: Add the skip-forward index helper and skipItem function**

In `extension/popup.js`, add both near `retryItem`:

```js
function firstUnresolvedIndex(items, results, fromIndex) {
  let idx = fromIndex;
  while (idx < items.length && results[idx]) {
    idx += 1;
  }
  return idx;
}

function skipItem(index) {
  chrome.storage.local.get(CART_QUEUE_KEY, (result) => {
    const queue = result[CART_QUEUE_KEY];
    if (!queue || !Array.isArray(queue.items) || !queue.items[index]) {
      return;
    }

    const item = queue.items[index];
    const results = Array.isArray(queue.results) ? queue.results.slice() : [];
    results[index] = { name: item.name, quantity: item.quantity, status: 'skipped' };

    const nextIndex = firstUnresolvedIndex(queue.items, results, index + 1);
    const updatedQueue = { ...queue, results, currentIndex: nextIndex };

    chrome.storage.local.set({ [CART_QUEUE_KEY]: updatedQueue }, () => {
      if (!queue.paused && nextIndex < queue.items.length && queue.tabId != null) {
        navigateTabToItem(queue.tabId, queue.items[nextIndex]);
      }
    });
  });
}
```

- [ ] **Step 2: Show the Skip button on the current item**

In `extension/popup.js`, inside `renderCartQueue`'s `forEach`, right after the existing block that adds Retry/Open-manually buttons (the `if (status === 'ambiguous' || status === 'not_found') { ... }` block), add:

```js
    if (status === 'in_progress' || status === 'paused') {
      const skipBtn = document.createElement('button');
      skipBtn.type = 'button';
      skipBtn.className = 'btn btn-secondary btn-small';
      skipBtn.textContent = 'Skip';
      skipBtn.addEventListener('click', () => skipItem(index));
      actions.appendChild(skipBtn);
    }
```

- [ ] **Step 3: Add CSS for the skipped status**

Append to `extension/popup.css`:

```css
.status-skipped {
  background: #f3f0ff;
  color: #5b3fa8;
}
```

- [ ] **Step 4: Manual verification**

Using the same popup DevTools console approach as Tasks 2-3:

1. Set a queue with `currentIndex: 0`, two items, no results, `tabId` pointing at a real open tab (or any number — the tab-update call will just no-op/error harmlessly if the tab doesn't exist, which is fine for this check).
2. Confirm a "Skip" button appears next to the "In progress" item, and does NOT appear next to the "Pending" second item.
3. Click "Skip". Confirm: the first item now shows a "Skipped" badge (purple), the second item now shows "In progress", and running `chrome.storage.local.get('cartQueue', console.log)` shows `results[0].status === 'skipped'` and `currentIndex === 1`.
4. Repeat with `paused: true` set on the queue before clicking Skip — confirm Skip still works (marks skipped, advances `currentIndex`) but does not attempt to navigate the tab (no visible tab change, since the handler's `!queue.paused` check short-circuits the navigation).

- [ ] **Step 5: Commit**

```bash
git add extension/popup.js extension/popup.css
git commit -m "feat: add a skip button for the in-progress queue item"
```
