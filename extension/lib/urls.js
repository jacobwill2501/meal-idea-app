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
