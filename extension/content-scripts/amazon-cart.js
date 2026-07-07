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

// Poll for a condition; ALM widgets render asynchronously after clicks.
function pollFor(getValue, timeoutMs, intervalMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const value = getValue();
      if (value) return resolve(value);
      if (Date.now() > deadline) return resolve(null);
      setTimeout(attempt, intervalMs);
    }
    attempt();
  });
}

function parseQsOption(span) {
  try {
    const data = JSON.parse(span.getAttribute('data-qs-widget-dropdown-decl'));
    return {
      id: typeof data.id === 'number' ? data.id : null,
      qsUID: data.qsUID ? String(data.qsUID) : null,
    };
  } catch (err) {
    return { id: null, qsUID: null };
  }
}

// The buy box's fresh-add-to-cart declarative span carries JSON whose qsUID
// names its OWN quantity widget (button id qs-widget-button-<qsUID>-announce)
// and tags that widget's dropdown options. This is the only reliable link:
// ALM pages also carry qs-widgets for cart-sidebar rows and carousels, and
// clicking one of those mutates a DIFFERENT product's cart line (2026-07-07
// debug log: soy milk's qty-4 click landed on the paper-plates line).
function findBuyboxQsUID() {
  const span = document.querySelector('span[data-action="fresh-add-to-cart"]');
  if (!span) return null;
  try {
    const data = JSON.parse(span.getAttribute('data-fresh-add-to-cart'));
    return data && data.qsUID ? String(data.qsUID) : null;
  } catch (err) {
    return null;
  }
}

// Set quantity on a pinned product page. Classic retail pages use a
// #quantity <select>; ALM (Whole Foods) buy boxes use the custom qs-widget
// dropdown, which we drive by clicking — but ONLY the widget tied to the
// buy box via qsUID (see findBuyboxQsUID). If no widget can be tied to the
// buy box, we touch nothing: mutating the wrong cart line is worse than
// shipping quantity 1. Returns an outcome record for the debug log;
// `verified` reports whether the widget label read "Qty: N" afterward.
async function setPinnedQuantity(desired) {
  if (!desired || desired <= 1) {
    return { requested: desired || 1, set: 1, method: 'default' };
  }

  const qtySelect = document.getElementById('quantity');
  if (qtySelect && qtySelect.tagName === 'SELECT') {
    const optionExists = Array.from(qtySelect.options).some(
      (opt) => opt.value === String(desired)
    );
    if (!optionExists) {
      return { requested: desired, set: 1, method: 'select-option-missing' };
    }
    qtySelect.value = String(desired);
    qtySelect.dispatchEvent(new Event('change', { bubbles: true }));
    return { requested: desired, set: desired, method: 'select' };
  }

  const qsUID = findBuyboxQsUID();
  if (!qsUID) {
    return { requested: desired, set: 1, method: 'no-buybox-widget' };
  }
  const qsButton =
    document.getElementById(`qs-widget-button-${qsUID}-announce`) ||
    document.querySelector(`button[id^="qs-widget-button-${qsUID}"]`);
  if (!qsButton) {
    return { requested: desired, set: 1, method: 'no-quantity-control' };
  }
  qsButton.click();

  const optionSpans = await pollFor(
    () => {
      const spans = Array.from(
        document.querySelectorAll('span[data-action="qs-widget-dropdown-decl"]')
      ).filter((span) => parseQsOption(span).qsUID === qsUID);
      return spans.length > 0 ? spans : null;
    },
    3000,
    150
  );
  if (!optionSpans) {
    return { requested: desired, set: 1, method: 'qs-dropdown-missing' };
  }

  const options = optionSpans
    .map((span) => ({ span, id: parseQsOption(span).id }))
    .filter((opt) => opt.id !== null)
    .sort((a, b) => a.id - b.id);
  const exact = options.find((opt) => opt.id === desired);
  const best = exact || options.filter((opt) => opt.id < desired).pop() || null;
  if (!best) {
    return { requested: desired, set: 1, method: 'qs-no-usable-option' };
  }
  const target = best.span.querySelector('li') || best.span;
  target.click();

  // Confirm the click actually landed: the widget label updates to the new
  // quantity. If it never does, record verified:false so the debug log
  // shows the truth instead of our assumption.
  const verified = await pollFor(
    () => (new RegExp(`Qty:\\s*${best.id}\\b`).test(qsButton.textContent) ? true : null),
    1600,
    150
  );
  return {
    requested: desired,
    set: best.id,
    method: exact ? 'qs-widget' : 'qs-widget-clamped',
    verified: Boolean(verified),
  };
}

// Known add-to-cart control variants on product pages. The classic retail
// buybox uses #add-to-cart-button; ALM (Whole Foods / Fresh) buyboxes have
// shipped different controls (2026-07-06 debug log: none of the pinned
// pages had #add-to-cart-button). All unverified against live pages — the
// survey below is what reveals the real one when these all miss.
function findPinnedAddToCartControl() {
  return (
    document.getElementById('add-to-cart-button') ||
    document.getElementById('freshAddToCartButton') ||
    document.querySelector('span[data-action="fresh-add-to-cart"] input.a-button-input') ||
    document.querySelector(
      'input[name="submit.addToCart"], button[name="submit.addToCart"]'
    ) ||
    null
  );
}

// Best-effort census of controls that look like add-to-cart, for the debug
// log. Evidence only — never clicked.
function surveyAddToCartControls() {
  const candidates = document.querySelectorAll(
    'button, input[type="submit"], input[type="button"], [role="button"]'
  );
  const looksLikeAddToCart = /add.{0,3}(to.{0,3})?cart/i;
  return Array.from(candidates)
    .filter((el) => {
      const haystack = [
        el.id,
        el.getAttribute('name'),
        el.getAttribute('aria-label'),
        el.getAttribute('data-testid'),
        el.value || '',
        (el.textContent || '').slice(0, 80),
      ]
        .filter(Boolean)
        .join(' ');
      return looksLikeAddToCart.test(haystack);
    })
    .slice(0, 10)
    .map((el) => ({
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      name: el.getAttribute('name'),
      ariaLabel: el.getAttribute('aria-label'),
      testId: el.getAttribute('data-testid'),
      text: (el.value || el.textContent || '').trim().slice(0, 60),
    }));
}

async function handleAddPinned(index, item, pin) {
  await settle();
  const addBtn = findPinnedAddToCartControl();
  if (!addBtn) {
    // No recognized add-to-cart control — surface for manual recovery and
    // record a survey of lookalike controls so the debug log reveals the
    // selector we should have used.
    return reportResult(index, 'not_found', {
      pinnedAsin: pin.asin,
      diagnostics: {
        url: window.location.href,
        pageTitle: document.title,
        addToCartCandidates: surveyAddToCartControls(),
      },
    });
  }

  const quantityOutcome = await setPinnedQuantity(item.quantity || 1);
  log('quantity outcome:', JSON.stringify(quantityOutcome));
  if (quantityOutcome.method !== 'default') {
    // Give the page a moment to apply the quantity before adding.
    await settle();
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
  return reportResult(index, 'added', { addedAsin: pin.asin, quantity: quantityOutcome });
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
