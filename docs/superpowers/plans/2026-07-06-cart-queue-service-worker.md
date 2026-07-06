# Cart Queue Service Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the extension's experimental "send to Whole Foods cart" flow so a background service worker is the single owner of all queue state, fixing three reported bugs: items landing in the regular Amazon cart, a runaway re-add loop, and a Pause button that can't stop that loop.

**Architecture:** A new MV3 background service worker (`background.js`) owns every mutation of the `cartQueue` object in `chrome.storage.local`, serialized through a promise-chain lock so read-modify-write cycles can never interleave. The content script becomes a thin, message-driven executor: on each page load it reports in (`cs:pageReady`), receives at most one instruction, and must be granted permission (`cs:requestClick`, granted at most once per item, ever) before clicking anything. The popup sends commands (`popup:start/toggle/skip/retry`) instead of writing queue state. Pause now *parks the queue tab* (navigates it to the WFM storefront) — the same mechanism that made Skip work when Pause didn't — instead of relying on a storage flag surviving. All URLs gain the `almBrandId` Whole Foods store-context parameter so add-to-cart targets the WFM cart rather than the main Amazon cart.

**Tech Stack:** Chrome Extension Manifest V3 (service worker, storage, tabs), vanilla JS with UMD-style globals (`GroceryMatcher`, new `GroceryUrls`), Jest 30 + jsdom + babel-jest (already configured in root `package.json`).

## Global Constraints

- Manifest V3; no new npm dependencies; no build step for the extension (files are loaded as-is).
- Shared extension libs follow the existing `lib/matcher.js` pattern exactly: plain script defining a const object, exported via `module.exports` guard AND `globalThis.<Name>` (see `extension/lib/matcher.js:54-61`).
- All Jest tests run with the repo's existing config (`npx jest extension/` from repo root, jsdom environment, babel-jest transform).
- Storage keys stay `cartQueue` / `pinnedProducts` / `groceryExport`; the `cartQueue` object shape stays popup-render-compatible: `{ items, results, attempted, navAttempts, currentIndex, paused, tabId }` (popup rendering code reads `items`, `results`, `currentIndex`, `paused` and is not changed).
- Diagnostic logging: every decision point logs via a `log()` helper prefixed `[wf-cart:bg]` (worker), `[wf-cart:cs]` (content script), `[wf-cart:popup]` (popup) with an ISO timestamp so a future runaway loop is diagnosable from the console.
- The Whole Foods ALM brand id is the constant string `VUZHIFdob2xlIEZvb2Rz` (base64 of "UFG Whole Foods").
- Live-Amazon behavior (selectors, exact ALM URL params) remains unverified from this environment; the README gains a live-verification checklist rather than the code claiming correctness.

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `extension/lib/urls.js` | Pure WFM URL builders + page predicates (`GroceryUrls` global) |
| Create | `extension/lib/urls.test.js` | Unit tests for urls.js |
| Create | `extension/background.js` | Service worker: single writer for cartQueue, message handlers, tab navigation |
| Create | `extension/background.test.js` | Unit tests incl. click-grant idempotency and write-serialization regression tests |
| Rewrite | `extension/content-scripts/amazon-cart.js` | Thin message-driven DOM executor |
| Rewrite | `extension/content-scripts/amazon-cart.test.js` | Tests for the message-driven content script |
| Modify | `extension/popup.js` | Queue commands become runtime messages; drop direct queue writes |
| Modify | `extension/popup.html` | Load `lib/urls.js` before `popup.js` |
| Modify | `extension/manifest.json` | Register background service worker; bump version to 0.2.0 |
| Modify | `extension/README.md` | Architecture note + live-verification checklist |

---

### Task 1: `GroceryUrls` — WFM store-context URL library

**Files:**
- Create: `extension/lib/urls.js`
- Test: `extension/lib/urls.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces global `GroceryUrls` with:
  - `WHOLE_FOODS_ALM_BRAND_ID: string`
  - `wholeFoodsSearchUrl(itemName: string): string`
  - `wholeFoodsProductUrl(asin: string): string`
  - `wholeFoodsStorefrontUrl(): string`
  - `isSearchUrlFor(urlString: string, itemName: string): boolean`
  - `isProductUrlFor(urlString: string, asin: string): boolean`

- [ ] **Step 1: Write the failing tests**

Create `extension/lib/urls.test.js`:

```js
const GroceryUrls = require('./urls.js');

describe('GroceryUrls', () => {
  test('search URL carries the wholefoods index AND the ALM store context', () => {
    const url = new URL(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    expect(url.hostname).toBe('www.amazon.com');
    expect(url.pathname).toBe('/s');
    expect(url.searchParams.get('k')).toBe('avocados');
    expect(url.searchParams.get('i')).toBe('wholefoods');
    // Without almBrandId the page is not in the Whole Foods store context and
    // add-to-cart lands in the regular Amazon cart (bug #1, 2026-07-06).
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
  });

  test('search URL encodes item names', () => {
    const url = new URL(GroceryUrls.wholeFoodsSearchUrl('half & half'));
    expect(url.searchParams.get('k')).toBe('half & half');
  });

  test('product URL carries the ALM store context', () => {
    const url = new URL(GroceryUrls.wholeFoodsProductUrl('B001'));
    expect(url.pathname).toBe('/dp/B001');
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
    expect(url.searchParams.get('fpw')).toBe('alm');
  });

  test('storefront URL points at the WFM ALM storefront', () => {
    const url = new URL(GroceryUrls.wholeFoodsStorefrontUrl());
    expect(url.pathname).toBe('/alm/storefront');
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
  });

  test('isSearchUrlFor matches its own search URLs case-insensitively', () => {
    const url = GroceryUrls.wholeFoodsSearchUrl('Avocados');
    expect(GroceryUrls.isSearchUrlFor(url, 'avocados')).toBe(true);
    expect(GroceryUrls.isSearchUrlFor(url, 'turkey')).toBe(false);
    expect(GroceryUrls.isSearchUrlFor('https://www.amazon.com/gp/cart', 'avocados')).toBe(false);
    expect(GroceryUrls.isSearchUrlFor('not a url', 'avocados')).toBe(false);
  });

  test('isProductUrlFor matches /dp/ paths including slug-prefixed ones', () => {
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/dp/B001?fpw=alm', 'B001')).toBe(true);
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/Some-Slug/dp/B001', 'B001')).toBe(true);
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/dp/B002', 'B001')).toBe(false);
    expect(GroceryUrls.isProductUrlFor('not a url', 'B001')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest extension/lib/urls.test.js`
Expected: FAIL — `Cannot find module './urls.js'`

- [ ] **Step 3: Implement `extension/lib/urls.js`**

```js
// Pure URL builders and page predicates for shopping the Whole Foods (ALM)
// store on amazon.com. No DOM or chrome.* usage so it can be unit-tested
// with Jest; the popup, background service worker, and content scripts
// consume it via the GroceryUrls global (loaded before them).
//
// Amazon keeps a separate cart per ALM (Amazon Local Market) store. A
// search with only `i=wholefoods` scopes the *search index* but not the
// store context, so add-to-cart clicks land in the regular Amazon cart
// (the 2026-07-06 bug report). The `almBrandId` parameter is what puts a
// page in the Whole Foods store context. NOTE: not yet verified against a
// live logged-in session — see the README live-verification checklist.

const WHOLE_FOODS_ALM_BRAND_ID = 'VUZHIFdob2xlIEZvb2Rz'; // base64("UFG Whole Foods")

function wholeFoodsSearchUrl(itemName) {
  const query = encodeURIComponent(itemName);
  return `https://www.amazon.com/s?k=${query}&i=wholefoods&almBrandId=${WHOLE_FOODS_ALM_BRAND_ID}`;
}

function wholeFoodsProductUrl(asin) {
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}?almBrandId=${WHOLE_FOODS_ALM_BRAND_ID}&fpw=alm`;
}

function wholeFoodsStorefrontUrl() {
  return `https://www.amazon.com/alm/storefront?almBrandId=${WHOLE_FOODS_ALM_BRAND_ID}`;
}

function isSearchUrlFor(urlString, itemName) {
  let url;
  try {
    url = new URL(urlString);
  } catch (err) {
    return false;
  }
  if (!url.pathname.startsWith('/s')) return false;
  const k = url.searchParams.get('k') || '';
  return k.toLowerCase() === String(itemName || '').toLowerCase();
}

function isProductUrlFor(urlString, asin) {
  let url;
  try {
    url = new URL(urlString);
  } catch (err) {
    return false;
  }
  return url.pathname.includes(`/dp/${asin}`);
}

const GroceryUrls = {
  WHOLE_FOODS_ALM_BRAND_ID,
  wholeFoodsSearchUrl,
  wholeFoodsProductUrl,
  wholeFoodsStorefrontUrl,
  isSearchUrlFor,
  isProductUrlFor,
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroceryUrls;
}
if (typeof globalThis !== 'undefined') {
  globalThis.GroceryUrls = GroceryUrls;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/lib/urls.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/lib/urls.js extension/lib/urls.test.js
git commit -m "feat: GroceryUrls lib with Whole Foods ALM store-context URLs"
```

---

### Task 2: Service worker core — content-script-facing protocol

**Files:**
- Create: `extension/background.js`
- Test: `extension/background.test.js`

**Interfaces:**
- Consumes: `GroceryMatcher.normalizeKey(name)` from `lib/matcher.js`; all of `GroceryUrls` from Task 1.
- Produces the message protocol content scripts use (Task 4 depends on these exact shapes):
  - `{type:'cs:pageReady', url}` → `{action:'idle'|'scrapeSearch'|'addPinned', reason?, index?, item?, pin?}`
  - `{type:'cs:requestClick', index}` → `{granted: boolean, reason?}`
  - `{type:'cs:reportResult', index, status, extra}` → `{ok: boolean, reason?}`
- Also produces internal helpers Task 3 extends: `getState()`, `setQueue()`, `withQueueLock()`, `queueActive()`, `recordAndAdvance()`, `navigateQueueTab()`, `itemUrl()`, the `HANDLERS` map, and the `chrome.runtime.onMessage` dispatcher.

- [ ] **Step 1: Write the failing tests**

Create `extension/background.test.js`:

```js
// Tests drive the service worker through its chrome.runtime.onMessage
// listener with a fake chrome API, exactly as a real content script or
// popup would. The storage fake clones values (matching real storage
// semantics, see commit fafc47e) and supports deferring get() callbacks so
// tests can prove the mutation lock serializes interleaved read-modify-
// write cycles — the root cause of the 2026-07-06 re-add-loop bug.

require('./lib/matcher.js');
require('./lib/urls.js');
const GroceryUrls = globalThis.GroceryUrls;

function makeChromeFake(store) {
  const pendingGets = [];
  let deferGets = false;
  const chromeFake = {
    __listener: null,
    __tabUrls: {},
    __deadTabIds: new Set(),
    __amazonTabs: [],
    __nextTabId: 100,
    runtime: {
      lastError: undefined,
      onMessage: {
        addListener(fn) {
          chromeFake.__listener = fn;
        },
      },
    },
    storage: {
      local: {
        get(keys, callback) {
          const run = () => {
            const keyList = Array.isArray(keys) ? keys : [keys];
            const result = {};
            keyList.forEach((key) => {
              if (store[key] !== undefined) {
                result[key] = JSON.parse(JSON.stringify(store[key]));
              }
            });
            callback(result);
          };
          if (deferGets) pendingGets.push(run);
          else run();
        },
        set(obj, callback) {
          Object.keys(obj).forEach((key) => {
            store[key] = JSON.parse(JSON.stringify(obj[key]));
          });
          if (callback) callback();
        },
      },
    },
    tabs: {
      update: jest.fn((tabId, props, callback) => {
        if (chromeFake.__deadTabIds.has(tabId)) {
          chromeFake.runtime.lastError = { message: 'No tab with id' };
          if (callback) callback();
          chromeFake.runtime.lastError = undefined;
          return;
        }
        chromeFake.__tabUrls[tabId] = props.url;
        if (callback) callback();
      }),
      create: jest.fn((props, callback) => {
        const tab = { id: chromeFake.__nextTabId++ };
        if (props.url) chromeFake.__tabUrls[tab.id] = props.url;
        callback(tab);
      }),
      query: jest.fn((queryInfo, callback) => {
        callback(chromeFake.__amazonTabs);
      }),
    },
    deferGets() {
      deferGets = true;
    },
    flushGets() {
      deferGets = false;
      pendingGets.splice(0).forEach((run) => run());
    },
  };
  return chromeFake;
}

function sendMessage(chromeFake, message, sender) {
  return new Promise((resolve) => {
    const keepOpen = chromeFake.__listener(message, sender || {}, resolve);
    expect(keepOpen).toBe(true);
  });
}

const QUEUE_TAB = { tab: { id: 1 } };
const OTHER_TAB = { tab: { id: 2 } };

function baseQueue(overrides) {
  return {
    items: [
      { name: 'avocados', quantity: 3 },
      { name: 'turkey', quantity: 1 },
    ],
    results: [],
    attempted: {},
    navAttempts: {},
    currentIndex: 0,
    paused: false,
    tabId: 1,
    ...(overrides || {}),
  };
}

describe('background service worker', () => {
  let store;
  let chromeFake;

  beforeEach(() => {
    jest.resetModules();
    store = { cartQueue: baseQueue(), pinnedProducts: {} };
    chromeFake = makeChromeFake(store);
    global.chrome = chromeFake;
    require('./lib/matcher.js');
    require('./lib/urls.js');
    require('./background.js');
  });

  describe('cs:pageReady', () => {
    test('tells the queue tab to scrape when it is on the right search page', async () => {
      const url = GroceryUrls.wholeFoodsSearchUrl('avocados');
      const response = await sendMessage(chromeFake, { type: 'cs:pageReady', url }, QUEUE_TAB);
      expect(response).toMatchObject({
        action: 'scrapeSearch',
        index: 0,
        item: { name: 'avocados', quantity: 3 },
      });
    });

    test('ignores pages that are not the queue tab', async () => {
      const url = GroceryUrls.wholeFoodsSearchUrl('avocados');
      const response = await sendMessage(chromeFake, { type: 'cs:pageReady', url }, OTHER_TAB);
      expect(response).toMatchObject({ action: 'idle', reason: 'not-queue-tab' });
      expect(chromeFake.tabs.update).not.toHaveBeenCalled();
    });

    test('ignores everything while paused', async () => {
      store.cartQueue.paused = true;
      const url = GroceryUrls.wholeFoodsSearchUrl('avocados');
      const response = await sendMessage(chromeFake, { type: 'cs:pageReady', url }, QUEUE_TAB);
      expect(response).toMatchObject({ action: 'idle', reason: 'paused' });
      expect(chromeFake.tabs.update).not.toHaveBeenCalled();
    });

    test('navigates the queue tab to the current item search when on the wrong page', async () => {
      const response = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: 'https://www.amazon.com/gp/cart/view.html' },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ action: 'idle', reason: 'navigating' });
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('avocados'));
      expect(store.cartQueue.navAttempts[0]).toBe(1);
    });

    test('gives up after repeated page mismatches instead of navigating forever', async () => {
      store.cartQueue.navAttempts = { 0: 3 };
      const response = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: 'https://www.amazon.com/gp/cart/view.html' },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ action: 'idle', reason: 'nav-attempts-exhausted' });
      expect(store.cartQueue.results[0]).toMatchObject({
        status: 'not_found',
        reason: 'page-mismatch',
      });
      expect(store.cartQueue.currentIndex).toBe(1);
      // ...and it moved on to the next item.
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });

    test('a reload after a granted click records assumed-added instead of reprocessing', async () => {
      store.cartQueue.attempted = { 0: true };
      const url = GroceryUrls.wholeFoodsSearchUrl('avocados');
      const response = await sendMessage(chromeFake, { type: 'cs:pageReady', url }, QUEUE_TAB);
      expect(response).toMatchObject({ action: 'idle', reason: 'assumed-added' });
      expect(store.cartQueue.results[0]).toMatchObject({
        status: 'added',
        assumedFromPriorAttempt: true,
      });
      expect(store.cartQueue.currentIndex).toBe(1);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });

    test('routes a pinned item to its product page and then to addPinned', async () => {
      store.pinnedProducts = { avocados: { asin: 'B001', title: 'Avocado Bag' } };
      const wrongPage = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: GroceryUrls.wholeFoodsSearchUrl('avocados') },
        QUEUE_TAB
      );
      expect(wrongPage).toMatchObject({ action: 'idle', reason: 'navigating' });
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsProductUrl('B001'));

      const rightPage = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: GroceryUrls.wholeFoodsProductUrl('B001') },
        QUEUE_TAB
      );
      expect(rightPage).toMatchObject({
        action: 'addPinned',
        index: 0,
        pin: { asin: 'B001' },
      });
    });

    test('advances past an already-resolved current index', async () => {
      store.cartQueue.results = [{ name: 'avocados', quantity: 3, status: 'added' }];
      const response = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: GroceryUrls.wholeFoodsSearchUrl('avocados') },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ action: 'idle', reason: 'advanced-past-resolved' });
      expect(store.cartQueue.currentIndex).toBe(1);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });

    test('idles when there is no active queue', async () => {
      delete store.cartQueue;
      const response = await sendMessage(
        chromeFake,
        { type: 'cs:pageReady', url: GroceryUrls.wholeFoodsSearchUrl('avocados') },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ action: 'idle', reason: 'no-active-queue' });
    });
  });

  describe('cs:requestClick', () => {
    test('grants exactly once per item — the anti-re-add-loop guarantee', async () => {
      const first = await sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, QUEUE_TAB);
      expect(first).toEqual(expect.objectContaining({ granted: true }));
      expect(store.cartQueue.attempted[0]).toBe(true);

      const second = await sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, QUEUE_TAB);
      expect(second).toMatchObject({ granted: false, reason: 'already-attempted' });
    });

    test('serializes concurrent grant requests (lost-update regression)', async () => {
      // Two racing requesters (e.g. a stale timer plus a fresh load). With
      // non-atomic get→set and no lock, BOTH would read attempted={} and
      // both would be granted — the mechanism behind endless re-adds.
      chromeFake.deferGets();
      const p1 = sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, QUEUE_TAB);
      const p2 = sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, QUEUE_TAB);
      // Let the first handler start and issue its (deferred) storage get
      // before releasing the gets, so the race window is actually open.
      await Promise.resolve();
      await Promise.resolve();
      chromeFake.flushGets();
      const r1 = await p1;
      // The second handler only starts after the first finishes; its get()
      // is issued after flushGets() re-enabled immediate execution.
      const r2 = await p2;
      const grants = [r1, r2].filter((r) => r.granted);
      expect(grants).toHaveLength(1);
    });

    test('denies while paused, from the wrong tab, or for a stale index', async () => {
      store.cartQueue.paused = true;
      const paused = await sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, QUEUE_TAB);
      expect(paused).toMatchObject({ granted: false, reason: 'paused' });

      store.cartQueue.paused = false;
      const wrongTab = await sendMessage(chromeFake, { type: 'cs:requestClick', index: 0 }, OTHER_TAB);
      expect(wrongTab).toMatchObject({ granted: false, reason: 'not-queue-tab' });

      const staleIndex = await sendMessage(chromeFake, { type: 'cs:requestClick', index: 1 }, QUEUE_TAB);
      expect(staleIndex).toMatchObject({ granted: false, reason: 'stale-index' });

      expect(store.cartQueue.attempted).toEqual({});
    });
  });

  describe('cs:reportResult', () => {
    test('records the result, advances, and navigates to the next item', async () => {
      const response = await sendMessage(
        chromeFake,
        {
          type: 'cs:reportResult',
          index: 0,
          status: 'added',
          extra: { addedAsin: 'B001' },
        },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue.results[0]).toMatchObject({
        name: 'avocados',
        quantity: 3,
        status: 'added',
        addedAsin: 'B001',
      });
      expect(store.cartQueue.currentIndex).toBe(1);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });

    test('does not navigate onward when the queue is complete', async () => {
      store.cartQueue.currentIndex = 1;
      store.cartQueue.results = [{ name: 'avocados', quantity: 3, status: 'added' }];
      const response = await sendMessage(
        chromeFake,
        { type: 'cs:reportResult', index: 1, status: 'added', extra: {} },
        QUEUE_TAB
      );
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue.currentIndex).toBe(2);
      expect(chromeFake.tabs.update).not.toHaveBeenCalled();
    });

    test('rejects reports from the wrong tab or for a stale index', async () => {
      const wrongTab = await sendMessage(
        chromeFake,
        { type: 'cs:reportResult', index: 0, status: 'added', extra: {} },
        OTHER_TAB
      );
      expect(wrongTab).toMatchObject({ ok: false, reason: 'not-queue-tab' });

      const stale = await sendMessage(
        chromeFake,
        { type: 'cs:reportResult', index: 1, status: 'added', extra: {} },
        QUEUE_TAB
      );
      expect(stale).toMatchObject({ ok: false, reason: 'stale-index' });
      expect(store.cartQueue.results).toEqual([]);
    });

    test('recreates the queue tab if it was closed', async () => {
      chromeFake.__deadTabIds.add(1);
      await sendMessage(
        chromeFake,
        { type: 'cs:reportResult', index: 0, status: 'added', extra: {} },
        QUEUE_TAB
      );
      expect(store.cartQueue.tabId).toBe(100);
      expect(chromeFake.__tabUrls[100]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest extension/background.test.js`
Expected: FAIL — `Cannot find module './background.js'`

- [ ] **Step 3: Implement `extension/background.js`**

```js
// Background service worker: the single owner of all cartQueue mutations.
// Content scripts and the popup never write cartQueue to storage directly —
// they send messages here, and every handler runs under a promise-chain
// lock so read-modify-write cycles cannot interleave and clobber each
// other. Interleaved writes from multiple script instances were the root
// cause of the 2026-07-06 bug report (endless re-adds, Pause not sticking).
//
// State lives in chrome.storage.local because MV3 kills and restarts this
// worker at will; the lock covers concurrent messages within one worker
// life, and Chrome delivers messages to at most one live worker at a time.

/* global GroceryMatcher, GroceryUrls */
if (typeof importScripts === 'function') {
  importScripts('lib/matcher.js', 'lib/urls.js');
}

const CART_QUEUE_KEY = 'cartQueue';
const PINNED_KEY = 'pinnedProducts';
const MAX_NAV_ATTEMPTS = 3;

function log(...args) {
  console.info('[wf-cart:bg]', new Date().toISOString(), ...args);
}

function getState() {
  return new Promise((resolve) => {
    chrome.storage.local.get([CART_QUEUE_KEY, PINNED_KEY], (result) => {
      resolve({
        queue: result[CART_QUEUE_KEY] || null,
        pinned: result[PINNED_KEY] || {},
      });
    });
  });
}

function setQueue(queue) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [CART_QUEUE_KEY]: queue }, () => resolve(queue));
  });
}

let mutationChain = Promise.resolve();
function withQueueLock(fn) {
  const result = mutationChain.then(() => fn());
  mutationChain = result.catch((err) => {
    log('locked mutation failed:', err);
  });
  return result;
}

function queueActive(queue) {
  return Boolean(
    queue && Array.isArray(queue.items) && queue.currentIndex < queue.items.length
  );
}

function firstUnresolvedIndex(items, results, fromIndex) {
  let idx = fromIndex;
  while (idx < items.length && results[idx]) idx += 1;
  return idx;
}

function itemUrl(item, pinned) {
  const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
  if (pin && pin.asin) return GroceryUrls.wholeFoodsProductUrl(pin.asin);
  return GroceryUrls.wholeFoodsSearchUrl(item.name);
}

// Navigate the queue tab; if it has been closed, open a replacement and
// persist its id. Resolves with the (possibly updated) queue.
function navigateQueueTab(queue, url) {
  return new Promise((resolve) => {
    chrome.tabs.update(queue.tabId, { url }, () => {
      if (!chrome.runtime.lastError) {
        log('navigated tab', queue.tabId, '→', url);
        return resolve(queue);
      }
      log('queue tab gone, recreating:', chrome.runtime.lastError.message);
      chrome.tabs.create({ url, active: false }, (tab) => {
        const updated = { ...queue, tabId: tab.id };
        setQueue(updated).then(() => resolve(updated));
      });
    });
  });
}

// Record a result for `index`, advance currentIndex past everything
// already resolved, persist, and (unless paused or complete) navigate the
// queue tab to the next item. Callers hold the lock.
async function recordAndAdvance(queue, pinned, index, status, extra) {
  const item = queue.items[index];
  const results = Array.isArray(queue.results) ? queue.results.slice() : [];
  results[index] = {
    name: item ? item.name : null,
    quantity: item ? item.quantity : null,
    status,
    ...(extra || {}),
  };
  const nextIndex = firstUnresolvedIndex(queue.items, results, queue.currentIndex);
  let updated = { ...queue, results, currentIndex: nextIndex };
  await setQueue(updated);
  log('recorded item', index, 'as', status, '— next index', nextIndex);
  if (nextIndex < updated.items.length && !updated.paused) {
    updated = await navigateQueueTab(updated, itemUrl(updated.items[nextIndex], pinned));
  }
  return updated;
}

// Bounded page-mismatch navigation: if Amazon keeps redirecting us away
// from where we asked to go (spell-corrected search, variant ASIN
// redirect), give up after MAX_NAV_ATTEMPTS instead of navigating forever.
async function navigateOrGiveUp(queue, pinned, index, targetUrl, actualUrl) {
  const navAttempts = { ...(queue.navAttempts || {}) };
  navAttempts[index] = (navAttempts[index] || 0) + 1;
  if (navAttempts[index] > MAX_NAV_ATTEMPTS) {
    log('giving up on item', index, '— page keeps mismatching, landed on', actualUrl);
    await recordAndAdvance({ ...queue, navAttempts }, pinned, index, 'not_found', {
      reason: 'page-mismatch',
      lastUrl: actualUrl,
    });
    return { action: 'idle', reason: 'nav-attempts-exhausted' };
  }
  const updated = { ...queue, navAttempts };
  await setQueue(updated);
  await navigateQueueTab(updated, targetUrl);
  return { action: 'idle', reason: 'navigating' };
}

async function handlePageReady(message, sender) {
  const { queue, pinned } = await getState();
  if (!queueActive(queue)) return { action: 'idle', reason: 'no-active-queue' };
  if (!sender.tab || sender.tab.id !== queue.tabId) {
    return { action: 'idle', reason: 'not-queue-tab' };
  }
  if (queue.paused) return { action: 'idle', reason: 'paused' };

  const index = queue.currentIndex;
  const results = Array.isArray(queue.results) ? queue.results : [];
  const item = queue.items[index];

  if (results[index]) {
    // Storage was left mid-state — move past everything already resolved.
    const nextIndex = firstUnresolvedIndex(queue.items, results, index);
    const updated = { ...queue, currentIndex: nextIndex };
    await setQueue(updated);
    if (nextIndex < queue.items.length) {
      await navigateQueueTab(updated, itemUrl(queue.items[nextIndex], pinned));
    }
    return { action: 'idle', reason: 'advanced-past-resolved' };
  }

  if (!item || !item.name) {
    await recordAndAdvance(queue, pinned, index, 'not_found', { reason: 'malformed-item' });
    return { action: 'idle', reason: 'malformed-item' };
  }

  if (queue.attempted && queue.attempted[index]) {
    // A click was granted for this item on a previous page load and the
    // page reloaded before the confirmation write. Assume the click landed
    // rather than ever clicking a second time.
    await recordAndAdvance(queue, pinned, index, 'added', { assumedFromPriorAttempt: true });
    return { action: 'idle', reason: 'assumed-added' };
  }

  const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
  if (pin && pin.asin) {
    if (!GroceryUrls.isProductUrlFor(message.url, pin.asin)) {
      return navigateOrGiveUp(
        queue,
        pinned,
        index,
        GroceryUrls.wholeFoodsProductUrl(pin.asin),
        message.url
      );
    }
    return { action: 'addPinned', index, item, pin };
  }

  if (!GroceryUrls.isSearchUrlFor(message.url, item.name)) {
    return navigateOrGiveUp(
      queue,
      pinned,
      index,
      GroceryUrls.wholeFoodsSearchUrl(item.name),
      message.url
    );
  }

  return { action: 'scrapeSearch', index, item };
}

async function handleRequestClick(message, sender) {
  const { queue } = await getState();
  if (!queueActive(queue)) return { granted: false, reason: 'no-active-queue' };
  if (!sender.tab || sender.tab.id !== queue.tabId) {
    return { granted: false, reason: 'not-queue-tab' };
  }
  if (queue.paused) return { granted: false, reason: 'paused' };
  if (message.index !== queue.currentIndex) return { granted: false, reason: 'stale-index' };
  if (queue.attempted && queue.attempted[message.index]) {
    return { granted: false, reason: 'already-attempted' };
  }
  const attempted = { ...(queue.attempted || {}), [message.index]: true };
  await setQueue({ ...queue, attempted });
  log('click granted for item', message.index);
  return { granted: true };
}

async function handleReportResult(message, sender) {
  const { queue, pinned } = await getState();
  if (!queueActive(queue)) return { ok: false, reason: 'no-active-queue' };
  if (!sender.tab || sender.tab.id !== queue.tabId) {
    return { ok: false, reason: 'not-queue-tab' };
  }
  if (message.index !== queue.currentIndex) return { ok: false, reason: 'stale-index' };
  await recordAndAdvance(queue, pinned, message.index, message.status, message.extra);
  return { ok: true };
}

const HANDLERS = {
  'cs:pageReady': handlePageReady,
  'cs:requestClick': handleRequestClick,
  'cs:reportResult': handleReportResult,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && HANDLERS[message.type];
  if (!handler) return false;
  withQueueLock(() => handler(message, sender))
    .then(sendResponse)
    .catch((err) => {
      log('handler error for', message.type, err);
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // keep the sendResponse channel open for the async reply
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/background.test.js`
Expected: PASS (all Task 2 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/background.js extension/background.test.js
git commit -m "feat: background service worker owns cart queue with serialized mutations"
```

---

### Task 3: Service worker — popup-facing commands (start, pause-parks-tab, skip, retry)

**Files:**
- Modify: `extension/background.js` (add handlers + register in `HANDLERS`)
- Test: `extension/background.test.js` (append a describe block)

**Interfaces:**
- Consumes: Task 2's `getState`, `setQueue`, `queueActive`, `recordAndAdvance`, `navigateQueueTab`, `itemUrl`, `HANDLERS`.
- Produces the popup protocol (Task 5 depends on these exact shapes):
  - `{type:'popup:start', items}` → `{ok, reason?}`
  - `{type:'popup:toggle'}` → `{ok, paused?, reason?}`
  - `{type:'popup:skip', index}` → `{ok, reason?}`
  - `{type:'popup:retry', index}` → `{ok, reason?}`

- [ ] **Step 1: Write the failing tests**

Append to the top-level `describe` in `extension/background.test.js`:

```js
  describe('popup commands', () => {
    test('popup:start creates a fresh queue on an existing amazon tab and navigates to item 0', async () => {
      delete store.cartQueue;
      chromeFake.__amazonTabs = [{ id: 7 }];
      const items = [{ name: 'avocados', quantity: 3 }];
      const response = await sendMessage(chromeFake, { type: 'popup:start', items });
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue).toMatchObject({
        items,
        results: [],
        attempted: {},
        navAttempts: {},
        currentIndex: 0,
        paused: false,
        tabId: 7,
      });
      expect(chromeFake.__tabUrls[7]).toBe(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    });

    test('popup:start opens a new tab when no amazon tab exists', async () => {
      delete store.cartQueue;
      chromeFake.__amazonTabs = [];
      const response = await sendMessage(chromeFake, {
        type: 'popup:start',
        items: [{ name: 'avocados', quantity: 3 }],
      });
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue.tabId).toBe(100);
    });

    test('popup:start starts a pinned first item on its product page', async () => {
      delete store.cartQueue;
      store.pinnedProducts = { avocados: { asin: 'B001' } };
      chromeFake.__amazonTabs = [{ id: 7 }];
      await sendMessage(chromeFake, {
        type: 'popup:start',
        items: [{ name: 'avocados', quantity: 3 }],
      });
      expect(chromeFake.__tabUrls[7]).toBe(GroceryUrls.wholeFoodsProductUrl('B001'));
    });

    test('popup:start rejects an empty item list', async () => {
      const response = await sendMessage(chromeFake, { type: 'popup:start', items: [] });
      expect(response).toMatchObject({ ok: false, reason: 'no-items' });
    });

    test('popup:toggle pause parks the queue tab on the WFM storefront', async () => {
      // Parking is the point: like the Skip button (the only control that
      // stopped the 2026-07-06 runaway loop), navigation tears down
      // whatever is running in the page. A storage flag alone only helps
      // future page loads.
      const response = await sendMessage(chromeFake, { type: 'popup:toggle' });
      expect(response).toMatchObject({ ok: true, paused: true });
      expect(store.cartQueue.paused).toBe(true);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsStorefrontUrl());
    });

    test('popup:toggle resume navigates back to the current item', async () => {
      store.cartQueue.paused = true;
      const response = await sendMessage(chromeFake, { type: 'popup:toggle' });
      expect(response).toMatchObject({ ok: true, paused: false });
      expect(store.cartQueue.paused).toBe(false);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    });

    test('popup:skip records skipped and moves on', async () => {
      const response = await sendMessage(chromeFake, { type: 'popup:skip', index: 0 });
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue.results[0]).toMatchObject({ name: 'avocados', status: 'skipped' });
      expect(store.cartQueue.currentIndex).toBe(1);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('turkey'));
    });

    test('popup:skip while paused records but leaves the tab parked', async () => {
      store.cartQueue.paused = true;
      await sendMessage(chromeFake, { type: 'popup:skip', index: 0 });
      expect(store.cartQueue.results[0]).toMatchObject({ status: 'skipped' });
      expect(store.cartQueue.currentIndex).toBe(1);
      expect(chromeFake.tabs.update).not.toHaveBeenCalled();
    });

    test('popup:retry clears the slot, attempted, and nav attempts, then rewinds and navigates', async () => {
      store.cartQueue.results = [{ name: 'avocados', quantity: 3, status: 'not_found' }];
      store.cartQueue.attempted = { 0: true };
      store.cartQueue.navAttempts = { 0: 4 };
      store.cartQueue.currentIndex = 1;
      const response = await sendMessage(chromeFake, { type: 'popup:retry', index: 0 });
      expect(response).toMatchObject({ ok: true });
      expect(store.cartQueue.results[0]).toBeFalsy();
      expect(store.cartQueue.attempted[0]).toBeUndefined();
      expect(store.cartQueue.navAttempts[0]).toBeUndefined();
      expect(store.cartQueue.currentIndex).toBe(0);
      expect(chromeFake.__tabUrls[1]).toBe(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    });

    test('popup:retry recreates the queue tab if it was closed', async () => {
      store.cartQueue.results = [{ name: 'avocados', quantity: 3, status: 'not_found' }];
      store.cartQueue.currentIndex = 1;
      chromeFake.__deadTabIds.add(1);
      await sendMessage(chromeFake, { type: 'popup:retry', index: 0 });
      expect(store.cartQueue.tabId).toBe(100);
      expect(chromeFake.__tabUrls[100]).toBe(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    });
  });
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npx jest extension/background.test.js`
Expected: FAIL — popup commands get no handler (`sendMessage`'s `expect(keepOpen).toBe(true)` fails because the listener returns `false` for unknown types)

- [ ] **Step 3: Implement the popup handlers in `extension/background.js`**

Add above the `HANDLERS` map:

```js
function getOrCreateAmazonTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ url: 'https://www.amazon.com/*' }, (tabs) => {
      if (tabs && tabs.length > 0) return resolve(tabs[0]);
      chrome.tabs.create({ url: 'https://www.amazon.com/', active: false }, resolve);
    });
  });
}

async function handleStart(message) {
  const items = message.items;
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, reason: 'no-items' };
  }
  const { pinned } = await getState();
  const tab = await getOrCreateAmazonTab();
  const queue = {
    items,
    results: [],
    attempted: {},
    navAttempts: {},
    currentIndex: 0,
    paused: false,
    tabId: tab.id,
  };
  await setQueue(queue);
  log('queue started:', items.length, 'items on tab', tab.id);
  await navigateQueueTab(queue, itemUrl(items[0], pinned));
  return { ok: true };
}

async function handleToggle() {
  const { queue, pinned } = await getState();
  if (!queueActive(queue)) return { ok: false, reason: 'no-active-queue' };
  const paused = !queue.paused;
  const updated = { ...queue, paused };
  await setQueue(updated);
  if (paused) {
    // Parking the tab is what actually stops a runaway page — the same
    // mechanism that made Skip work when the old flag-only Pause didn't.
    log('paused — parking queue tab');
    await navigateQueueTab(updated, GroceryUrls.wholeFoodsStorefrontUrl());
  } else {
    log('resumed — navigating to current item');
    await navigateQueueTab(updated, itemUrl(updated.items[updated.currentIndex], pinned));
  }
  return { ok: true, paused };
}

async function handleSkip(message) {
  const { queue, pinned } = await getState();
  if (!queue || !Array.isArray(queue.items) || !queue.items[message.index]) {
    return { ok: false, reason: 'bad-index' };
  }
  await recordAndAdvance(queue, pinned, message.index, 'skipped');
  return { ok: true };
}

async function handleRetry(message) {
  const { queue, pinned } = await getState();
  if (!queue || !Array.isArray(queue.items) || !queue.items[message.index]) {
    return { ok: false, reason: 'bad-index' };
  }
  const results = Array.isArray(queue.results) ? queue.results.slice() : [];
  results[message.index] = undefined;
  const attempted = { ...(queue.attempted || {}) };
  delete attempted[message.index];
  const navAttempts = { ...(queue.navAttempts || {}) };
  delete navAttempts[message.index];
  const updated = { ...queue, results, attempted, navAttempts, currentIndex: message.index };
  await setQueue(updated);
  if (!updated.paused) {
    await navigateQueueTab(updated, itemUrl(updated.items[message.index], pinned));
  }
  return { ok: true };
}
```

And extend the `HANDLERS` map:

```js
const HANDLERS = {
  'cs:pageReady': handlePageReady,
  'cs:requestClick': handleRequestClick,
  'cs:reportResult': handleReportResult,
  'popup:start': handleStart,
  'popup:toggle': handleToggle,
  'popup:skip': handleSkip,
  'popup:retry': handleRetry,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/background.test.js`
Expected: PASS (all Task 2 + Task 3 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/background.js extension/background.test.js
git commit -m "feat: popup queue commands in service worker; pause now parks the queue tab"
```

---

### Task 4: Rewrite the content script as a message-driven executor

**Files:**
- Rewrite: `extension/content-scripts/amazon-cart.js`
- Rewrite: `extension/content-scripts/amazon-cart.test.js`

**Interfaces:**
- Consumes: the `cs:*` protocol from Task 2 (exact shapes listed there); `GroceryMatcher.pickBest(name, candidates)`.
- Produces: nothing consumed by other tasks (leaf executor).

- [ ] **Step 1: Write the failing tests (replace the whole old test file)**

Replace `extension/content-scripts/amazon-cart.test.js` with:

```js
/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.amazon.com/s?k=avocados&i=wholefoods&almBrandId=VUZHIFdob2xlIEZvb2Rz"}
 */

// The content script is now a thin executor: it reports the page to the
// background service worker and acts only on the single instruction it
// gets back, asking permission before any click. These tests fake
// chrome.runtime.sendMessage with scripted responses. The old storage-
// driven regression tests (reload re-click loop, pause clobbering) moved
// to background.test.js where that logic now lives.

require('../lib/matcher.js');

function makeChromeFake(script) {
  // script: map of message.type → response or (message) => response.
  const sent = [];
  return {
    sent,
    runtime: {
      sendMessage(message, callback) {
        sent.push(message);
        const entry = script[message.type];
        const response = typeof entry === 'function' ? entry(message) : entry;
        // Real sendMessage responds asynchronously.
        Promise.resolve().then(() => callback(response));
      },
    },
  };
}

function renderSearchResultsPage(clickSpy) {
  document.body.innerHTML = `
    <div data-component-type="s-search-result" data-asin="B001">
      <h2><span>Avocados</span></h2>
      <span class="a-price"><span class="a-offscreen">$1.99</span></span>
      <button name="submit.addToCart">Add to Cart</button>
    </div>
  `;
  document.querySelector('button[name="submit.addToCart"]').addEventListener('click', clickSpy);
}

function renderProductPage(clickSpy) {
  document.body.innerHTML = `
    <select id="quantity"><option value="1">1</option><option value="3">3</option></select>
    <button id="add-to-cart-button">Add to Cart</button>
  `;
  document.getElementById('add-to-cart-button').addEventListener('click', clickSpy);
}

async function flushAsync() {
  // Interleave microtasks and the fake timer queue until settled.
  for (let i = 0; i < 20; i += 1) {
    jest.runAllTimers();
    // eslint-disable-next-line no-await-in-loop
    await Promise.resolve();
  }
}

describe('amazon-cart content script', () => {
  let clickSpy;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    clickSpy = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('does nothing when the worker says idle', async () => {
    renderSearchResultsPage(clickSpy);
    global.chrome = makeChromeFake({ 'cs:pageReady': { action: 'idle', reason: 'paused' } });
    require('./amazon-cart.js');
    await flushAsync();
    expect(clickSpy).not.toHaveBeenCalled();
    expect(global.chrome.sent.map((m) => m.type)).toEqual(['cs:pageReady']);
  });

  test('scrapes, requests permission, clicks once, and reports added', async () => {
    renderSearchResultsPage(clickSpy);
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'scrapeSearch',
        index: 0,
        item: { name: 'avocados', quantity: 3 },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const types = global.chrome.sent.map((m) => m.type);
    expect(types).toEqual(['cs:pageReady', 'cs:requestClick', 'cs:reportResult']);
    const report = global.chrome.sent[2];
    expect(report).toMatchObject({ index: 0, status: 'added' });
    expect(report.extra.addedAsin).toBe('B001');
  });

  test('never clicks when the worker denies the click', async () => {
    renderSearchResultsPage(clickSpy);
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'scrapeSearch',
        index: 0,
        item: { name: 'avocados', quantity: 3 },
      },
      'cs:requestClick': { granted: false, reason: 'already-attempted' },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(clickSpy).not.toHaveBeenCalled();
    const types = global.chrome.sent.map((m) => m.type);
    expect(types).toEqual(['cs:pageReady', 'cs:requestClick']);
  });

  test('reports ambiguous with candidates when no confident match', async () => {
    document.body.innerHTML = `
      <div data-component-type="s-search-result" data-asin="B001">
        <h2><span>Guacamole Dip</span></h2>
      </div>
    `;
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'scrapeSearch',
        index: 0,
        item: { name: 'avocados', quantity: 3 },
      },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 0, status: 'ambiguous' });
    expect(report.extra.candidates).toHaveLength(1);
  });

  test('reports not_found when no search results render', async () => {
    document.body.innerHTML = '';
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'scrapeSearch',
        index: 0,
        item: { name: 'avocados', quantity: 3 },
      },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 0, status: 'not_found' });
  });

  test('addPinned sets quantity, asks permission, clicks, and reports added', async () => {
    renderProductPage(clickSpy);
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 1,
        item: { name: 'avocados', quantity: 3 },
        pin: { asin: 'B001' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(document.getElementById('quantity').value).toBe('3');
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 1, status: 'added' });
    expect(report.extra.addedAsin).toBe('B001');
  });

  test('addPinned reports not_found when the add button is missing', async () => {
    document.body.innerHTML = '';
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 1,
        item: { name: 'avocados', quantity: 3 },
        pin: { asin: 'B001' },
      },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 1, status: 'not_found' });
    expect(report.extra.pinnedAsin).toBe('B001');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest extension/content-scripts/amazon-cart.test.js`
Expected: FAIL — the old implementation reads `chrome.storage` (undefined on the fake), and message expectations don't match.

- [ ] **Step 3: Replace `extension/content-scripts/amazon-cart.js`**

```js
// Thin, message-driven executor. All queue state lives behind the
// background service worker (background.js); this script never reads or
// writes cartQueue directly. On each page load it reports in, receives at
// most one instruction, and must be granted permission — given at most
// once per item, ever — before clicking any add-to-cart control. That
// grant model is what prevents reload loops from re-adding items (the
// 2026-07-05 turkey / 2026-07-06 avocado bug reports).
//
// NOTE: All DOM selectors below are unverified placeholders. They have not
// been checked against a live, logged-in amazon.com session and WILL need
// hands-on iteration — see the README live-verification checklist.

const SETTLE_DELAY_MS = 800;

function log(...args) {
  console.info('[wf-cart:cs]', new Date().toISOString(), ...args);
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, resolve);
  });
}

function settle() {
  return new Promise((resolve) => {
    setTimeout(resolve, SETTLE_DELAY_MS);
  });
}

function reportResult(index, status, extra) {
  log('reporting item', index, 'as', status);
  return send({ type: 'cs:reportResult', index, status, extra: extra || {} });
}

// Best-effort: find search result containers on the page. Unverified
// selector — Amazon's markup changes frequently and by locale/experiment.
function findSearchResults() {
  const results = document.querySelectorAll('[data-component-type="s-search-result"]');
  return results ? Array.from(results) : [];
}

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

// Best-effort: find an "Add to Cart" control within a given result element.
// Unverified selector, placeholder pending live iteration.
function findAddToCartControl(resultEl) {
  if (!resultEl) return null;
  return (
    resultEl.querySelector('button[name="submit.addToCart"]') ||
    resultEl.querySelector('[data-action="add-to-cart"]') ||
    null
  );
}

// Best-effort: find a quantity input/select near an add-to-cart control.
// Unverified selector, placeholder pending live iteration.
function findQuantityControl(resultEl) {
  if (!resultEl) return null;
  return resultEl.querySelector('select[name="quantity"], input[name="quantity"]') || null;
}

function setQuantity(resultEl, quantity) {
  const qtyControl = findQuantityControl(resultEl);
  if (!qtyControl) {
    // No quantity control found — fall back to leaving quantity at the
    // default. Best-effort enhancement, not a required step.
    return;
  }

  if (qtyControl.tagName === 'SELECT') {
    const optionExists = Array.from(qtyControl.options).some(
      (opt) => opt.value === String(quantity)
    );
    if (optionExists) {
      qtyControl.value = String(quantity);
      qtyControl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else if (qtyControl.tagName === 'INPUT') {
    qtyControl.value = String(quantity);
    qtyControl.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// Ask the worker for permission, then click. Returns false (and does NOT
// click) when the grant is denied — e.g. paused, stale index, or this item
// was already clicked once on any previous page load.
async function clickIfGranted(index, el, describe) {
  const response = await send({ type: 'cs:requestClick', index });
  if (!response || !response.granted) {
    log('click denied for', describe, '—', response && response.reason);
    return false;
  }
  log('clicking', describe);
  el.click();
  return true;
}

async function handleScrapeSearch(index, item) {
  await settle();
  const resultEls = findSearchResults();
  if (resultEls.length === 0) {
    return reportResult(index, 'not_found');
  }

  const candidates = captureCandidates(resultEls);
  const { decision, best } = GroceryMatcher.pickBest(item.name, candidates);

  if (decision !== 'auto_add') {
    return reportResult(index, 'ambiguous', { candidates });
  }

  const resultEl = resultEls.find((el) => el.getAttribute('data-asin') === best.asin);
  const control = findAddToCartControl(resultEl);
  if (!control) {
    // Confident match but no way to add it from the search page — let the
    // user resolve it from the popup picker instead of failing outright.
    return reportResult(index, 'ambiguous', { candidates });
  }

  setQuantity(resultEl, item.quantity || 1);

  let clicked;
  try {
    clicked = await clickIfGranted(index, control, `search result ${best.asin}`);
  } catch (err) {
    console.warn('[wf-cart:cs] add-to-cart click failed:', err);
    return reportResult(index, 'not_found', { candidates });
  }
  if (!clicked) return undefined;

  await settle();
  return reportResult(index, 'added', { candidates, addedAsin: best.asin });
}

async function handleAddPinned(index, item, pin) {
  await settle();
  const addBtn = document.getElementById('add-to-cart-button');
  if (!addBtn) {
    // Product gone or page layout unrecognized — surface for manual
    // recovery (popup offers retry / open manually / unpin).
    return reportResult(index, 'not_found', { pinnedAsin: pin.asin });
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

  let clicked;
  try {
    clicked = await clickIfGranted(index, addBtn, `pinned product ${pin.asin}`);
  } catch (err) {
    console.warn('[wf-cart:cs] pinned add-to-cart click failed:', err);
    return reportResult(index, 'not_found', { pinnedAsin: pin.asin });
  }
  if (!clicked) return undefined;

  await settle();
  return reportResult(index, 'added', { addedAsin: pin.asin });
}

async function init() {
  const response = await send({ type: 'cs:pageReady', url: window.location.href });
  log('pageReady →', response && response.action, response && response.reason);
  if (!response) return;
  if (response.action === 'scrapeSearch') {
    await handleScrapeSearch(response.index, response.item);
  } else if (response.action === 'addPinned') {
    await handleAddPinned(response.index, response.item, response.pin);
  }
}

init();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest extension/content-scripts/amazon-cart.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add extension/content-scripts/amazon-cart.js extension/content-scripts/amazon-cart.test.js
git commit -m "refactor: content script is a message-driven executor with click grants"
```

---

### Task 5: Wire popup + manifest + docs; full-suite verification

**Files:**
- Modify: `extension/popup.js`
- Modify: `extension/popup.html`
- Modify: `extension/manifest.json`
- Modify: `extension/README.md`

**Interfaces:**
- Consumes: the `popup:*` protocol from Task 3 and `GroceryUrls.wholeFoodsSearchUrl` from Task 1.
- Produces: final user-facing wiring; nothing downstream.

- [ ] **Step 1: Register the service worker and bump the version in `extension/manifest.json`**

Change `"version": "0.1.0"` to `"version": "0.2.0"` and add after the `host_permissions` array:

```json
  "background": {
    "service_worker": "background.js"
  },
```

- [ ] **Step 2: Load `lib/urls.js` in `extension/popup.html`**

Change the script block at the bottom to:

```html
    <script src="lib/matcher.js"></script>
    <script src="lib/urls.js"></script>
    <script src="popup.js"></script>
```

- [ ] **Step 3: Rewire `extension/popup.js` to send commands**

3a. Replace the local URL helper (lines 25-28, `function wholeFoodsSearchUrl…`) with:

```js
const { wholeFoodsSearchUrl } = GroceryUrls;

function sendCommand(message, callback) {
  chrome.runtime.sendMessage(message, (response) => {
    if (chrome.runtime.lastError) {
      console.warn('[wf-cart:popup] command failed:', message.type, chrome.runtime.lastError);
    }
    if (callback) callback(response);
  });
}
```

3b. Replace `getOrCreateAmazonTab`, `navigateTabToItem`, and `startCartQueue` (popup.js:321-358) with:

```js
function startCartQueue() {
  if (!latestExportData || !Array.isArray(latestExportData.items) || latestExportData.items.length === 0) {
    return;
  }
  sendToCartBtn.disabled = true;
  sendCommand({ type: 'popup:start', items: latestExportData.items }, () => {
    sendToCartBtn.disabled = false;
  });
}
```

3c. Replace `toggleQueuePause` (popup.js:360-379) with:

```js
function toggleQueuePause() {
  sendCommand({ type: 'popup:toggle' });
}
```

3d. Delete popup.js's local `firstUnresolvedIndex` (lines 381-387) and replace `skipItem` (389-409) and `retryItem` (411-444) with:

```js
function skipItem(index) {
  sendCommand({ type: 'popup:skip', index });
}

function retryItem(index) {
  sendCommand({ type: 'popup:retry', index });
}
```

(`pinAndRerun` and `unpinItem` keep writing `pinnedProducts` directly — the pinned map has no concurrent writers — and `pinAndRerun` already funnels into `retryItem`, which now goes through the worker. Rendering functions and the `storage.onChanged` listener are unchanged: reads are safe.)

- [ ] **Step 4: Run the full test suite**

Run: `npx jest`
Expected: PASS — all suites including `src/` app tests, `extension/lib/*`, `extension/background.test.js`, `extension/content-scripts/amazon-cart.test.js`.

- [ ] **Step 5: Update `extension/README.md`**

Append this section (adjust placement if the README has a natural spot):

```markdown
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
```

- [ ] **Step 6: Reload sanity check of the manifest**

Run: `node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest ok')"`
Expected: `manifest ok`

- [ ] **Step 7: Commit**

```bash
git add extension/popup.js extension/popup.html extension/manifest.json extension/README.md
git commit -m "feat: popup drives cart queue through service worker; WFM store context URLs"
```
