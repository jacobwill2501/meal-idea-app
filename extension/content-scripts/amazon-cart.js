// NOTE: All selectors below are unverified placeholders. They have not been
// checked against a live, logged-in amazon.com session and WILL need
// hands-on iteration before this reliably adds anything to a real cart.

const CART_QUEUE_KEY = 'cartQueue';
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

function getQueue(callback) {
  chrome.storage.local.get(CART_QUEUE_KEY, (result) => {
    callback(result[CART_QUEUE_KEY]);
  });
}

function saveQueue(queue, callback) {
  chrome.storage.local.set({ [CART_QUEUE_KEY]: queue }, () => {
    if (callback) callback();
  });
}

function recordResult(queue, index, status) {
  const results = Array.isArray(queue.results) ? queue.results.slice() : [];
  const item = queue.items[index];
  results[index] = { name: item.name, quantity: item.quantity, status };

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

function markNotFound(queue, index) {
  recordResult(queue, index, 'not_found');
}

function markAmbiguous(queue, index) {
  recordResult(queue, index, 'ambiguous');
}

function markAdded(queue, index) {
  recordResult(queue, index, 'added');
}

// Best-effort: find search result containers on the page. Unverified
// selector — Amazon's markup changes frequently and by locale/experiment.
function findSearchResults() {
  const results = document.querySelectorAll('[data-component-type="s-search-result"]');
  return results ? Array.from(results) : [];
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

function processCurrentItem(queue) {
  const { currentIndex, items } = queue;

  if (!Array.isArray(items) || currentIndex >= items.length) {
    // Queue is already complete or malformed; nothing to do.
    return;
  }

  const item = items[currentIndex];
  if (!item || !item.name) {
    markNotFound(queue, currentIndex);
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

    if (results.length > 1) {
      // Multiple results and no reliable way (yet) to disambiguate which
      // one the user actually wants — flag for manual review rather than
      // guessing.
      markAmbiguous(queue, currentIndex);
      return;
    }

    const resultEl = results[0];
    const addToCartControl = findAddToCartControl(resultEl);

    if (!addToCartControl) {
      markNotFound(queue, currentIndex);
      return;
    }

    setQuantity(resultEl, item.quantity || 1);

    try {
      addToCartControl.click();
    } catch (err) {
      console.warn('[amazon-cart] add-to-cart click failed:', err);
      markNotFound(queue, currentIndex);
      return;
    }

    // Give the click a moment to register (cart update, confirmation
    // modal, etc.) before we consider the item added.
    setTimeout(() => {
      markAdded(queue, currentIndex);
    }, SETTLE_DELAY_MS);
  }, SETTLE_DELAY_MS);
}

function init() {
  getQueue((queue) => {
    if (!queue || !Array.isArray(queue.items) || queue.items.length === 0) {
      return;
    }
    if (queue.currentIndex >= queue.items.length) {
      // Already complete, nothing to do on this load.
      return;
    }
    processCurrentItem(queue);
  });
}

init();
