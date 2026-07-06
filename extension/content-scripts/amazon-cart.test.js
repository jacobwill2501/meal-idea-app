/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://www.amazon.com/s?k=turkey&i=wholefoods"}
 */

// Simulates the bug: clicking "Add to Cart" on Whole Foods search results can
// cause a full page reload instead of an in-place AJAX update. In a real
// browser, that reload tears down the JS realm and cancels any pending
// setTimeout — including the one that was going to persist the "added"
// result. The next content-script load then sees an unresolved item and
// clicks again, repeating forever (see the 2026-07-05 bug report: "kept
// trying to add more and more turkey").
//
// jsdom doesn't tear down the realm on navigation, so a reload is modeled by
// clearing pending timers and re-requiring the script fresh (mirroring a new
// content-script injection) without letting the interrupted timer fire.

require('../lib/matcher.js');

function makeChromeStorage(store) {
  return {
    storage: {
      local: {
        get(keys, callback) {
          const keyList = Array.isArray(keys) ? keys : [keys];
          const result = {};
          keyList.forEach((key) => {
            if (store[key] !== undefined) result[key] = store[key];
          });
          callback(result);
        },
        set(obj, callback) {
          Object.assign(store, obj);
          if (callback) callback();
        },
      },
    },
  };
}

function renderSearchResultsPage(clickSpy) {
  document.body.innerHTML = `
    <div data-component-type="s-search-result" data-asin="B001">
      <h2><span>Organic Turkey Breast</span></h2>
      <span class="a-price"><span class="a-offscreen">$9.99</span></span>
      <button name="submit.addToCart">Add to Cart</button>
    </div>
  `;
  const btn = document.querySelector('button[name="submit.addToCart"]');
  btn.addEventListener('click', clickSpy);
}

describe('amazon-cart reload-loop regression', () => {
  let store;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    store = {
      cartQueue: {
        items: [{ name: 'turkey', quantity: 1 }],
        results: [],
        currentIndex: 0,
        tabId: 1,
      },
      pinnedProducts: {},
    };
    global.chrome = makeChromeStorage(store);
    // window.location is set via the @jest-environment-options docblock at
    // the top of this file (assigning it directly triggers jsdom's real
    // navigation machinery, which resets other globals like `chrome`). The
    // single-item queue in this test never causes the code under test to
    // navigate either, so the URL never needs to change mid-test.
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a reload after clicking add-to-cart does not click again', () => {
    const clickSpy = jest.fn();
    renderSearchResultsPage(clickSpy);

    // Load 1: page loads on the search results page, script clicks Add to
    // Cart, then the page reloads (simulated) before recordResult's
    // confirmation timer fires.
    require('./amazon-cart.js');
    jest.advanceTimersByTime(800); // reveals search results, clicks add-to-cart
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(store.cartQueue.attempted).toEqual({ 0: true });
    expect(store.cartQueue.results[0]).toBeUndefined(); // never confirmed — page "reloaded"

    jest.clearAllTimers(); // the pending recordResult timer is destroyed by the reload

    // Load 2: fresh script injection on the same search page (Amazon
    // returned us to essentially the same URL). jest.resetModules() clears
    // the require cache so the file body (including its top-level init()
    // call) actually re-executes, mirroring a real content-script reinject.
    jest.resetModules();
    renderSearchResultsPage(clickSpy);
    require('./amazon-cart.js');
    jest.advanceTimersByTime(800);

    expect(clickSpy).toHaveBeenCalledTimes(1); // not clicked again
    expect(store.cartQueue.results[0]).toMatchObject({ status: 'added' });
    expect(store.cartQueue.currentIndex).toBe(1);
  });

  test('does not click or navigate when the queue is paused', () => {
    const clickSpy = jest.fn();
    renderSearchResultsPage(clickSpy);
    store.cartQueue.paused = true;

    require('./amazon-cart.js');
    jest.advanceTimersByTime(800);

    expect(clickSpy).not.toHaveBeenCalled();
    expect(store.cartQueue.attempted).toBeUndefined();
    expect(store.cartQueue.results[0]).toBeUndefined();
  });
});
