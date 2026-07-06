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
