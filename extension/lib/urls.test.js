const GroceryUrls = require('./urls.js');

describe('GroceryUrls', () => {
  test('search URL carries the wholefoods index AND the ALM store context', () => {
    const url = new URL(GroceryUrls.wholeFoodsSearchUrl('avocados'));
    expect(url.hostname).toBe('www.amazon.com');
    expect(url.pathname).toBe('/s');
    expect(url.searchParams.get('k')).toBe('avocados');
    expect(url.searchParams.get('i')).toBe('wholefoods');
    // Without almBrandId the page is not in the Whole Foods store context and
    // add-to-cart lands in the regular Amazon cart (bug #1, 2026-07-06).
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
  });

  test('search URL encodes item names', () => {
    const url = new URL(GroceryUrls.wholeFoodsSearchUrl('half & half'));
    expect(url.searchParams.get('k')).toBe('half & half');
  });

  test('product URL carries the ALM store context', () => {
    const url = new URL(GroceryUrls.wholeFoodsProductUrl('B001'));
    expect(url.pathname).toBe('/dp/B001');
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
    expect(url.searchParams.get('fpw')).toBe('alm');
  });

  test('storefront URL points at the WFM ALM storefront', () => {
    const url = new URL(GroceryUrls.wholeFoodsStorefrontUrl());
    expect(url.pathname).toBe('/alm/storefront');
    expect(url.searchParams.get('almBrandId')).toBe('VUZHIFdob2xlIEZvb2Rz');
  });

  test('isSearchUrlFor matches its own search URLs case-insensitively', () => {
    const url = GroceryUrls.wholeFoodsSearchUrl('Avocados');
    expect(GroceryUrls.isSearchUrlFor(url, 'avocados')).toBe(true);
    expect(GroceryUrls.isSearchUrlFor(url, 'turkey')).toBe(false);
    expect(GroceryUrls.isSearchUrlFor('https://www.amazon.com/gp/cart', 'avocados')).toBe(false);
    expect(GroceryUrls.isSearchUrlFor('not a url', 'avocados')).toBe(false);
  });

  test('isProductUrlFor matches /dp/ paths including slug-prefixed ones', () => {
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/dp/B001?fpw=alm', 'B001')).toBe(true);
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/Some-Slug/dp/B001', 'B001')).toBe(true);
    expect(GroceryUrls.isProductUrlFor('https://www.amazon.com/dp/B002', 'B001')).toBe(false);
    expect(GroceryUrls.isProductUrlFor('not a url', 'B001')).toBe(false);
  });

  test('search URL strips trailing meal annotations from item names', () => {
    const url = new URL(
      GroceryUrls.wholeFoodsSearchUrl('avocado (picadillo, Salmon Bowls)')
    );
    expect(url.searchParams.get('k')).toBe('avocado');
  });

  test('isSearchUrlFor treats annotated and stripped names as the same search', () => {
    const url = GroceryUrls.wholeFoodsSearchUrl('avocado (picadillo, Salmon Bowls)');
    expect(GroceryUrls.isSearchUrlFor(url, 'avocado (picadillo, Salmon Bowls)')).toBe(true);
    expect(GroceryUrls.isSearchUrlFor(url, 'avocado')).toBe(true);
  });
});
