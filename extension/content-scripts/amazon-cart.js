// NOTE: All selectors below are unverified placeholders. They have not been
// checked against a live, logged-in amazon.com session and WILL need
// hands-on iteration before this reliably adds anything to a real cart.

const CART_QUEUE_KEY = 'cartQueue';
const PINNED_KEY = 'pinnedProducts';
const SETTLE_DELAY_MS = 800;

function wholeFoodsSearchUrl(itemName) {
  const query = encodeURIComponent(itemName);
  return `https://www.amazon.com/s?k=${query}&i=wholefoods`;
}

function isOnSearchPageFor(itemName) {
  const url = new URL(window.location.href);
  if (!url.pathname.startsWith('/s')) {
    return false;
  }
  const k = url.searchParams.get('k') || '';
  // Loose match: the search term should be present (case-insensitive).
  return k.toLowerCase() === itemName.toLowerCase();
}

function productPageUrl(asin) {
  return `https://www.amazon.com/dp/${encodeURIComponent(asin)}`;
}

function isOnProductPageFor(asin) {
  return window.location.pathname.includes(`/dp/${asin}`);
}

function saveQueue(queue, callback) {
  chrome.storage.local.set({ [CART_QUEUE_KEY]: queue }, () => {
    if (callback) callback();
  });
}

// Starting at `fromIndex`, walk forward past any indices that already hold
// a recorded result (all recorded statuses — added/ambiguous/not_found —
// are terminal). Retry clears the slot it rewinds to before re-navigating,
// so a cleared (undefined) slot halts the walk and is returned as the next
// index to process. Returns queue.items.length if nothing remains.
function firstUnresolvedIndex(queue, fromIndex) {
  const results = queue.results || [];
  let idx = fromIndex;
  while (idx < queue.items.length && results[idx]) {
    idx += 1;
  }
  return idx;
}

function recordResult(queue, index, status, extra) {
  const results = Array.isArray(queue.results) ? queue.results.slice() : [];
  const item = queue.items[index];
  results[index] = { name: item.name, quantity: item.quantity, status, ...(extra || {}) };

  // Advance past any subsequent items that already have a recorded result
  // (left over from before a retry rewound currentIndex) so we don't
  // re-process — and re-add to the cart — items that already completed.
  const nextIndex = firstUnresolvedIndex({ items: queue.items, results }, index + 1);
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

function alreadyAttempted(queue, index) {
  return Boolean(queue.attempted && queue.attempted[index]);
}

// Persists an "attempted" marker for `index` BEFORE the caller clicks an
// add-to-cart control, then invokes `afterSave` with the updated queue.
// Some real add-to-cart flows navigate the page instead of updating it in
// place; if that happens, the page (and any pending setTimeout scheduled
// after the click) is torn down before recordResult ever runs, and the next
// content-script load would otherwise see an unresolved item and click
// again — repeating forever. Saving this marker first means the next load
// can detect "we already clicked" and stop instead of re-clicking.
function markAttempted(queue, index, afterSave) {
  const attempted = queue.attempted ? { ...queue.attempted } : {};
  attempted[index] = true;
  const updatedQueue = { ...queue, attempted };
  saveQueue(updatedQueue, () => afterSave(updatedQueue));
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
    // No quantity control found — fall back to leaving quantity at
    // whatever the default is. We do not throw; this is a best-effort
    // enhancement, not a required step.
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

    markAttempted(queue, index, (updatedQueue) => {
      try {
        addBtn.click();
      } catch (err) {
        console.warn('[amazon-cart] pinned add-to-cart click failed:', err);
        recordResult(updatedQueue, index, 'not_found', { pinnedAsin: pin.asin });
        return;
      }

      setTimeout(() => {
        recordResult(updatedQueue, index, 'added', { addedAsin: pin.asin });
      }, SETTLE_DELAY_MS);
    });
  }, SETTLE_DELAY_MS);
}

function processCurrentItem(queue, pinned) {
  const { currentIndex, items } = queue;

  if (!Array.isArray(items) || currentIndex >= items.length) {
    // Queue is already complete or malformed; nothing to do.
    return;
  }

  if (Array.isArray(queue.results) && queue.results[currentIndex]) {
    // currentIndex already has a recorded result (e.g. storage left
    // mid-state) — skip forward past it and any other already-resolved
    // items instead of re-processing (and re-adding to the cart).
    const nextIndex = firstUnresolvedIndex(queue, currentIndex + 1);
    saveQueue({ ...queue, currentIndex: nextIndex }, () => {
      if (nextIndex < items.length) {
        window.location.href = wholeFoodsSearchUrl(items[nextIndex].name);
      }
      // Otherwise the queue is complete; nothing further to navigate to.
    });
    return;
  }

  const item = items[currentIndex];
  if (!item || !item.name) {
    markNotFound(queue, currentIndex);
    return;
  }

  if (alreadyAttempted(queue, currentIndex)) {
    // We already clicked add-to-cart for this item on a previous load, but
    // never got to confirm it (the page reloaded before recordResult could
    // run). Assume the click took effect instead of clicking again — this
    // is what stops a reload from turning into an unbounded re-add loop.
    recordResult(queue, currentIndex, 'added', { assumedFromPriorAttempt: true });
    return;
  }

  const pin = pinned[GroceryMatcher.normalizeKey(item.name)];
  if (pin && pin.asin) {
    processPinnedItem(queue, currentIndex, item, pin);
    return;
  }

  if (!isOnSearchPageFor(item.name)) {
    // Not on the right page yet — navigate there and let the next content
    // script load (after the page reload) pick up processing.
    window.location.href = wholeFoodsSearchUrl(item.name);
    return;
  }

  // Give the page a moment to finish rendering search results before we
  // start querying the DOM.
  setTimeout(() => {
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

    markAttempted(queue, currentIndex, (updatedQueue) => {
      try {
        addToCartControl.click();
      } catch (err) {
        console.warn('[amazon-cart] add-to-cart click failed:', err);
        markNotFound(updatedQueue, currentIndex, { candidates });
        return;
      }

      // Give the click a moment to register (cart update, confirmation
      // modal, etc.) before we consider the item added.
      setTimeout(() => {
        recordResult(updatedQueue, currentIndex, 'added', { candidates, addedAsin: best.asin });
      }, SETTLE_DELAY_MS);
    });
  }, SETTLE_DELAY_MS);
}

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

init();
