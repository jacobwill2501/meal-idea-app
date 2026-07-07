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
    document.body.innerHTML = '<div data-asin="B009">unrelated node</div>';
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
    // Diagnostics capture what the page actually was, so an all-not_found
    // run can be diagnosed from the popup's debug log.
    expect(report.extra.diagnostics.url).toBe(window.location.href);
    expect(typeof report.extra.diagnostics.pageTitle).toBe('string');
    expect(report.extra.diagnostics.selectorCounts).toEqual({
      searchResult: 0,
      anyAsin: 1,
      resultItems: 0,
    });
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
    // A decoy control that LOOKS like add-to-cart but matches none of our
    // selectors — the survey must capture it for the debug log.
    document.body.innerHTML =
      '<button id="wfm-atc-widget" aria-label="Add to cart">Add</button>';
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
    expect(report.extra.diagnostics.url).toBe(window.location.href);
    expect(report.extra.diagnostics.addToCartCandidates).toEqual([
      {
        tag: 'button',
        id: 'wfm-atc-widget',
        name: null,
        ariaLabel: 'Add to cart',
        testId: null,
        text: 'Add',
      },
    ]);
  });

  test('addPinned falls back to the asin-matched fresh-add-to-cart span', async () => {
    document.body.innerHTML =
      '<span class="a-declarative" data-action="fresh-add-to-cart" ' +
      'data-fresh-add-to-cart=\'{"qsUID":"atfc-2","asin":"B001"}\'>' +
      '<span class="a-button"><input class="a-button-input" type="submit"></span></span>';
    document.querySelector('input.a-button-input').addEventListener('click', clickSpy);
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 1,
        item: { name: 'avocados', quantity: 1 },
        pin: { asin: 'B001' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(clickSpy).toHaveBeenCalledTimes(1);
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 1, status: 'added' });
    expect(report.extra.control).toBe('fresh-span');
  });

  test("addPinned never clicks another product's fresh-add-to-cart card", async () => {
    // A recommendation-carousel card for a DIFFERENT product — clicking it
    // adds the wrong item to the cart (2026-07-07 bug: a Medium Avocado
    // landed in the cart from the sourdough page's carousel).
    document.body.innerHTML =
      '<span class="a-declarative" data-action="fresh-add-to-cart" ' +
      'data-fresh-add-to-cart=\'{"qsUID":"atfc-9","asin":"B0MEDAVO"}\'>' +
      '<span class="a-button"><input class="a-button-input" type="submit" ' +
      'aria-label="Add to Cart, Medium Avocado"></span></span>';
    const decoySpy = jest.fn();
    document.querySelector('input.a-button-input').addEventListener('click', decoySpy);
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 0,
        item: { name: 'sourdough', quantity: 1 },
        pin: { asin: 'B0CP5ZPQ46' },
      },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(decoySpy).not.toHaveBeenCalled();
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 0, status: 'not_found' });
    expect(report.extra.pinnedAsin).toBe('B0CP5ZPQ46');
    expect(Array.isArray(report.extra.diagnostics.addToCartCandidates)).toBe(true);
  });

  function renderAlmProductPage(clickSpy, maxQty) {
    const options = Array.from({ length: maxQty }, (_, i) => i + 1)
      .map(
        (n) =>
          `<span class="a-declarative" data-action="qs-widget-dropdown-decl" ` +
          `data-qs-widget-dropdown-decl='{"qsUID":"atfc-1","id":${n}}'>` +
          `<li role="option" id="qs-item-${n}">${n}</li></span>`
      )
      .join('');
    document.body.innerHTML = `
      <span class="a-declarative" data-action="fresh-add-to-cart"
        data-fresh-add-to-cart='{"qsUID":"atfc-1","asin":"B001"}'>
        <span id="freshAddToCartButton" class="a-button"><input class="a-button-input" type="submit"></span>
      </span>
      <span id="qs-widget-button-atfc-1" class="a-button"><span class="a-button-inner">
        <button id="qs-widget-button-atfc-1-announce" type="button">Qty: 1</button>
      </span></span>
      <div id="qs-dropdown">${options}</div>
    `;
    // Simulate Amazon updating the widget label when an option is clicked —
    // the implementation verifies this label to confirm the click landed.
    document
      .querySelectorAll('span[data-action="qs-widget-dropdown-decl"]')
      .forEach((span) => {
        const data = JSON.parse(span.getAttribute('data-qs-widget-dropdown-decl'));
        span.querySelector('li').addEventListener('click', () => {
          document.getElementById('qs-widget-button-atfc-1-announce').textContent =
            `Qty: ${data.id}`;
        });
      });
    document.getElementById('freshAddToCartButton').addEventListener('click', clickSpy);
  }

  test('addPinned drives the ALM qs-widget dropdown to the requested quantity', async () => {
    renderAlmProductPage(clickSpy, 5);
    const qtyClicks = [];
    document.querySelectorAll('li[role="option"]').forEach((li) => {
      li.addEventListener('click', () => qtyClicks.push(li.id));
    });
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 0,
        item: { name: 'avocado', quantity: 3 },
        pin: { asin: 'B001' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(qtyClicks).toEqual(['qs-item-3']);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 0, status: 'added' });
    expect(report.extra.quantity).toEqual({
      requested: 3,
      set: 3,
      method: 'qs-widget',
      verified: true,
    });
  });

  test('addPinned clamps to the highest offered qs-widget quantity', async () => {
    renderAlmProductPage(clickSpy, 5);
    const qtyClicks = [];
    document.querySelectorAll('li[role="option"]').forEach((li) => {
      li.addEventListener('click', () => qtyClicks.push(li.id));
    });
    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 0,
        item: { name: 'bananas', quantity: 7 },
        pin: { asin: 'B001' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(qtyClicks).toEqual(['qs-item-5']);
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report.extra.quantity).toEqual({
      requested: 7,
      set: 5,
      method: 'qs-widget-clamped',
      verified: true,
    });
  });

  test('addPinned ignores non-buybox qs-widgets (cart-sidebar decoy)', async () => {
    renderAlmProductPage(clickSpy, 5);
    // Decoy widget like a cart-sidebar row's quantity control, FIRST in the
    // document with a matching option id — clicking it would mutate a
    // different product's cart line (the 2026-07-07 paper-plates bug).
    const decoy = document.createElement('div');
    decoy.innerHTML =
      '<span id="qs-widget-button-ewc-9" class="a-button"><span class="a-button-inner">' +
      '<button id="qs-widget-button-ewc-9-announce" type="button">Qty: 2</button></span></span>' +
      '<span class="a-declarative" data-action="qs-widget-dropdown-decl" ' +
      'data-qs-widget-dropdown-decl=\'{"qsUID":"ewc-9","id":4}\'>' +
      '<li role="option" id="decoy-item-4">4</li></span>';
    document.body.insertBefore(decoy, document.body.firstChild);
    const decoySpy = jest.fn();
    document
      .getElementById('qs-widget-button-ewc-9-announce')
      .addEventListener('click', decoySpy);
    document.getElementById('decoy-item-4').addEventListener('click', decoySpy);

    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 0,
        item: { name: 'soy milk', quantity: 4 },
        pin: { asin: 'B001' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(decoySpy).not.toHaveBeenCalled();
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report.extra.quantity).toEqual({
      requested: 4,
      set: 4,
      method: 'qs-widget',
      verified: true,
    });
  });

  test('addPinned leaves every qs-widget alone when no buybox link exists', async () => {
    // A widget is present but nothing ties it to the buy box (no
    // fresh-add-to-cart span): never click it — wrong-line mutation is
    // worse than shipping quantity 1.
    document.body.innerHTML =
      '<span id="qs-widget-button-ewc-9" class="a-button"><span class="a-button-inner">' +
      '<button id="qs-widget-button-ewc-9-announce" type="button">Qty: 2</button></span></span>' +
      '<button id="add-to-cart-button">Add to Cart</button>';
    document.getElementById('add-to-cart-button').addEventListener('click', clickSpy);
    const decoySpy = jest.fn();
    document
      .getElementById('qs-widget-button-ewc-9-announce')
      .addEventListener('click', decoySpy);

    global.chrome = makeChromeFake({
      'cs:pageReady': {
        action: 'addPinned',
        index: 0,
        item: { name: 'eggs', quantity: 3 },
        pin: { asin: 'B002' },
      },
      'cs:requestClick': { granted: true },
      'cs:reportResult': { ok: true },
    });
    require('./amazon-cart.js');
    await flushAsync();

    expect(decoySpy).not.toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalledTimes(1);
    const report = global.chrome.sent.find((m) => m.type === 'cs:reportResult');
    expect(report).toMatchObject({ index: 0, status: 'added' });
    expect(report.extra.quantity).toEqual({
      requested: 3,
      set: 1,
      method: 'no-buybox-widget',
    });
  });
});
