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
const DEBUG_LOG_KEY = 'debugLog';
const DEBUG_LOG_MAX = 200;

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

// Append one entry to the persistent debug ring buffer (the popup's
// "Copy debug log" button reads it). Callers hold the mutation lock and
// await this, so appends cannot interleave or reorder.
function logEvent(event, details) {
  return new Promise((resolve) => {
    chrome.storage.local.get([DEBUG_LOG_KEY], (result) => {
      const entries = Array.isArray(result[DEBUG_LOG_KEY]) ? result[DEBUG_LOG_KEY] : [];
      entries.push({ t: new Date().toISOString(), event, ...(details || {}) });
      chrome.storage.local.set({ [DEBUG_LOG_KEY]: entries.slice(-DEBUG_LOG_MAX) }, () =>
        resolve()
      );
    });
  });
}

// Undefined fields are dropped by storage serialization, so a sparse
// summary is fine.
function summarizeResponse(response) {
  if (!response) return null;
  return {
    action: response.action,
    reason: response.reason,
    granted: response.granted,
    ok: response.ok,
    paused: response.paused,
  };
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
        logEvent('navigate', { tabId: queue.tabId, url }).then(() => resolve(queue));
        return;
      }
      log('queue tab gone, recreating:', chrome.runtime.lastError.message);
      chrome.tabs.create({ url, active: false }, (tab) => {
        const updated = { ...queue, tabId: tab.id };
        setQueue(updated).then(() =>
          logEvent('navigate', { tabId: tab.id, url, recreatedTab: true }).then(() =>
            resolve(updated)
          )
        );
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
  await logEvent('recorded', {
    index,
    status,
    reason: (extra || {}).reason,
    nextIndex,
  });
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

const HANDLERS = {
  'cs:pageReady': handlePageReady,
  'cs:requestClick': handleRequestClick,
  'cs:reportResult': handleReportResult,
  'popup:start': handleStart,
  'popup:toggle': handleToggle,
  'popup:skip': handleSkip,
  'popup:retry': handleRetry,
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = message && HANDLERS[message.type];
  if (!handler) return false;
  withQueueLock(async () => {
    const response = await handler(message, sender);
    await logEvent('message', {
      type: message.type,
      fromTab: sender.tab ? sender.tab.id : null,
      index: typeof message.index === 'number' ? message.index : undefined,
      status: message.status,
      url: message.url,
      response: summarizeResponse(response),
    });
    return response;
  })
    .then(sendResponse)
    .catch((err) => {
      log('handler error for', message.type, err);
      sendResponse({ ok: false, error: String(err) });
    });
  return true; // keep the sendResponse channel open for the async reply
});
