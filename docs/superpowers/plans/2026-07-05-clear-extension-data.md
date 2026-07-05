# Clear Extension Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Clear extension data" button to the bottom of the extension popup that removes the `groceryExport` and `cartQueue` keys from `chrome.storage.local`, giving the user a one-click way to reset stuck/stale popup state.

**Architecture:** Pure markup + one event-listener change. A new footer section is added to `extension/popup.html` below the existing "Open in Whole Foods" and "Send to Cart" sections; its button calls `chrome.storage.local.remove(['groceryExport', 'cartQueue'])` from `extension/popup.js`. No new rendering logic is needed — the existing `chrome.storage.onChanged` listener in `popup.js` already handles the resulting `newValue: undefined` change events correctly (verified by reading the file; see spec). `extension/popup.css` gets a small utility-section style so the new control reads as a reset action, not a primary one.

**Tech Stack:** Vanilla JS (Manifest V3 Chrome extension), plain HTML/CSS, no build step, no bundler. No Jest coverage exists for `popup.js`/`popup.html` (only `extension/lib/matcher.js` has unit tests) — verification for this feature is manual, live in a loaded extension, per existing project convention.

## Global Constraints

- The clear action MUST call exactly `chrome.storage.local.remove(['groceryExport', 'cartQueue'])` — never `chrome.storage.local.clear()`, and the array passed must never include `'pinnedProducts'`.
- `pinnedProducts` must never be read, written, or removed by this feature, in any task.
- No confirmation dialog/prompt before clearing.
- The new section must be placed below both `#assisted-mode` and `#automated-mode` in `extension/popup.html`, and must always be visible (not hidden/shown by the existing `hidden`-attribute toggling that `renderExport` does to those two sections).
- No new rendering logic beyond the click handler itself — do not add new branches to `renderExport`, `renderCartQueue`, or the `chrome.storage.onChanged` listener.

---

### Task 1: Add the "Clear extension data" section to the popup markup

**Files:**
- Modify: `extension/popup.html:36-50`

**Interfaces:**
- Produces: a new `<section id="clear-data-section">` containing `<button id="clear-data-btn">`, both consumed by Task 2's `popup.js` changes.

- [ ] **Step 1: Insert the new section**

Open `extension/popup.html`. The file currently ends its body content like this (lines 36–50):

```html
      <section id="automated-mode" class="section" hidden>
        <div class="section-header">
          <h2>Send to Cart (Experimental)</h2>
          <button id="send-to-cart-btn" class="btn btn-primary" type="button">
            Send to Whole Foods Cart
          </button>
        </div>
        <p class="hint">
          Best-effort automation against amazon.com's live page. It can fail
          or misfire if Amazon changes their page. Use "Open in Whole Foods"
          above as the reliable fallback for anything that doesn't work.
        </p>
        <ul id="cart-queue-list" class="item-list"></ul>
      </section>
    </div>
```

Replace it with (adding the new section between `</section>` and the closing `</div>`):

```html
      <section id="automated-mode" class="section" hidden>
        <div class="section-header">
          <h2>Send to Cart (Experimental)</h2>
          <button id="send-to-cart-btn" class="btn btn-primary" type="button">
            Send to Whole Foods Cart
          </button>
        </div>
        <p class="hint">
          Best-effort automation against amazon.com's live page. It can fail
          or misfire if Amazon changes their page. Use "Open in Whole Foods"
          above as the reliable fallback for anything that doesn't work.
        </p>
        <ul id="cart-queue-list" class="item-list"></ul>
      </section>

      <section id="clear-data-section" class="section section-utility">
        <button id="clear-data-btn" class="btn btn-muted" type="button">
          Clear extension data
        </button>
        <p class="hint">
          Clears the cached grocery export and any in-progress cart queue
          from this extension. Your saved grocery list in the app is not
          affected, and learned product pins are kept.
        </p>
      </section>
    </div>
```

Note this section has no `hidden` attribute and is not referenced by any `id`-based `hidden` toggling in `popup.js` — it must always render, regardless of whether `#empty-state`, `#assisted-mode`, or `#automated-mode` are currently shown or hidden.

- [ ] **Step 2: Sanity-check the markup**

Run:

```bash
node -e "require('fs').readFileSync('extension/popup.html', 'utf8')" && echo "readable"
```

Then visually confirm in the file that `<section id="clear-data-section">` closes properly and sits between `</section>` (end of `automated-mode`) and the final `</div>` that closes `#app`. There is no automated HTML linter in this repo for the extension, so this is a manual read-through, not a command with pass/fail output.

- [ ] **Step 3: Commit**

```bash
git add extension/popup.html
git commit -m "feat: add clear-extension-data section markup to popup"
```

---

### Task 2: Wire the click handler in popup.js

**Files:**
- Modify: `extension/popup.js:1-19` (const declarations)
- Modify: `extension/popup.js:376-390` (event listener registration area)

**Interfaces:**
- Consumes: `#clear-data-btn` from Task 1's markup; `EXPORT_KEY` (`'groceryExport'`) and `CART_QUEUE_KEY` (`'cartQueue'`) constants already defined at the top of `popup.js` (lines 6–7).
- Produces: nothing new consumed by later tasks — this is the terminal behavior.

- [ ] **Step 1: Add the element reference**

In `extension/popup.js`, the existing element lookups are:

```js
const exportMetaEl = document.getElementById('export-meta');
const emptyStateEl = document.getElementById('empty-state');
const assistedModeEl = document.getElementById('assisted-mode');
const openAllBtn = document.getElementById('open-all-btn');
const itemListEl = document.getElementById('item-list');
const automatedModeEl = document.getElementById('automated-mode');
const sendToCartBtn = document.getElementById('send-to-cart-btn');
const cartQueueListEl = document.getElementById('cart-queue-list');
```

Add one more line directly after `cartQueueListEl`:

```js
const exportMetaEl = document.getElementById('export-meta');
const emptyStateEl = document.getElementById('empty-state');
const assistedModeEl = document.getElementById('assisted-mode');
const openAllBtn = document.getElementById('open-all-btn');
const itemListEl = document.getElementById('item-list');
const automatedModeEl = document.getElementById('automated-mode');
const sendToCartBtn = document.getElementById('send-to-cart-btn');
const cartQueueListEl = document.getElementById('cart-queue-list');
const clearDataBtn = document.getElementById('clear-data-btn');
```

- [ ] **Step 2: Add the click listener**

Find the existing listener registrations near the bottom of the file:

```js
sendToCartBtn.addEventListener('click', startCartQueue);

// Keep the popup in sync if the export or cart queue changes while the
// popup is open (e.g. amazon-cart.js reports progress on a step).
chrome.storage.onChanged.addListener((changes, areaName) => {
```

Insert a new listener between them:

```js
sendToCartBtn.addEventListener('click', startCartQueue);

clearDataBtn.addEventListener('click', () => {
  chrome.storage.local.remove([EXPORT_KEY, CART_QUEUE_KEY]);
});

// Keep the popup in sync if the export or cart queue changes while the
// popup is open (e.g. amazon-cart.js reports progress on a step).
chrome.storage.onChanged.addListener((changes, areaName) => {
```

This is the entire behavior change. Do not add an `if (confirm(...))` guard — the spec explicitly calls for no confirmation dialog. Do not add `PINNED_KEY` to the array passed to `.remove()`.

- [ ] **Step 3: Confirm the file still parses**

```bash
node --check extension/popup.js && echo "syntax OK"
```

Expected output: `syntax OK`.

- [ ] **Step 4: Commit**

```bash
git add extension/popup.js
git commit -m "feat: wire clear-extension-data button to storage.local.remove"
```

---

### Task 3: Style the new utility section

**Files:**
- Modify: `extension/popup.css` (append new rules; no existing rules are removed)

**Interfaces:**
- Consumes: `#clear-data-section` / `.section-utility` and `#clear-data-btn` / `.btn-muted` selectors from Task 1's markup.

- [ ] **Step 1: Append the new rules**

Open `extension/popup.css`. It currently ends with:

```css
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

Append after it:

```css

.section-utility {
  margin-top: 16px;
  padding-top: 10px;
  border-top: 1px solid #e0e0e0;
  text-align: center;
}

.btn-muted {
  background: none;
  border: none;
  padding: 4px 8px;
  font-size: 11.5px;
  color: #888;
  cursor: pointer;
  text-decoration: underline;
}

.btn-muted:hover {
  color: #555;
}
```

`.section-utility` reuses the same top-border/spacing language as `.section` (used by `#assisted-mode`/`#automated-mode`) so it reads as part of the same visual rhythm, but the muted, centered, underlined button (`.btn-muted`) deliberately contrasts with `.btn-primary`/`.btn-secondary` so it doesn't compete with "Send to Whole Foods Cart" as a primary action.

- [ ] **Step 2: Confirm the file still parses**

```bash
node --check extension/popup.css 2>&1 | grep -v "^$" || echo "no JS syntax to check — visually verify braces balance"
```

CSS has no `node --check` equivalent; instead visually confirm every rule added in Step 1 has a matching `{`/`}` pair (there are three rules: `.section-utility`, `.btn-muted`, `.btn-muted:hover`).

- [ ] **Step 3: Commit**

```bash
git add extension/popup.css
git commit -m "style: add utility-section styling for clear-extension-data button"
```

---

### Task 4: Manual verification in a loaded extension

**Files:**
- None (verification only, no code changes)

- [ ] **Step 1: Load the updated extension**

```bash
open -a "Google Chrome" "chrome://extensions"
```

In the browser: enable **Developer mode** if not already on, then click **Load unpacked** and select the `extension/` directory (or click the reload icon on the existing loaded extension if it's already installed from a prior session).

- [ ] **Step 2: Populate storage with test data**

Open the meal-idea-app tab (local dev server or the deployed app), add at least one item to the grocery list so `groceryExport` mirrors into storage, then click the extension's toolbar icon to open the popup. Confirm the new "Clear extension data" section is visible at the bottom, below "Send to Cart (Experimental)".

Click "Send to Whole Foods Cart" once so a `cartQueue` entry also exists in storage (it's fine if items end up `not_found`/`ambiguous` — the queue object existing is what matters here).

- [ ] **Step 3: Click "Clear extension data" and confirm the reset**

Click the new button. Confirm, without closing/reopening the popup:
- `#empty-state` becomes visible with its "No grocery export found..." text.
- The "Open in Whole Foods" and "Send to Cart (Experimental)" sections both hide.
- The cart queue list under "Send to Cart" (if it was visible) is empty.
- No confirmation dialog appeared before the clear happened.

- [ ] **Step 4: Confirm `pinnedProducts` is untouched**

Before this step, if no pin exists yet, create one: from a `cartQueue` with an `ambiguous` item, click a candidate to pin it (per the existing teach flow), then repeat Step 3's clear. Open the extension's service worker DevTools (`chrome://extensions` → the extension card → "service worker" link, or the popup's own DevTools via right-click → Inspect) and run:

```js
chrome.storage.local.get(null, console.log)
```

Expected: the logged object has no `groceryExport` key, no `cartQueue` key, and still has a `pinnedProducts` key with the pin created above intact.

- [ ] **Step 5: Confirm the app-tab re-sync caveat**

With the app tab still open in the background after clearing, confirm the popup stays in the empty state (re-open the popup and check — it should still show "No grocery export found..."). Then edit the grocery list in the app tab (add or remove an item). Re-open the popup and confirm `groceryExport` has reappeared and the popup renders it normally again. This confirms the `MutationObserver`-driven re-sync in `extension/content-scripts/app-reader.js` behaves as documented in the spec (re-sync only on DOM mutation, not on a timer).

- [ ] **Step 6: No commit for this task**

This task is verification only; nothing to stage or commit. If any step fails, fix the relevant file from Task 1–3 and re-run this task's steps from Step 3.

## Verification

1. All four tasks' steps above pass, in order.
2. `git log --oneline -4` shows three feature/style commits from Tasks 1–3 (Task 4 makes no commit).
3. `chrome.storage.local.get(null, console.log)` after a clear shows `pinnedProducts` present and `groceryExport`/`cartQueue` absent, per Task 4 Step 4.
