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
