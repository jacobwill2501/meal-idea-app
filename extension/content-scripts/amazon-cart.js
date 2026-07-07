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
    // Nothing matched our selector. Capture what the page actually was so
    // an all-not_found run can be diagnosed from the popup's debug log
    // (redirected page? markup drift? rendered too slowly?).
    return reportResult(index, 'not_found', {
      diagnostics: {
        url: window.location.href,
        pageTitle: document.title,
        selectorCounts: {
          searchResult: document.querySelectorAll('[data-component-type="s-search-result"]')
            .length,
          anyAsin: document.querySelectorAll('[data-asin]').length,
          resultItems: document.querySelectorAll('.s-result-item').length,
        },
      },
    });
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
