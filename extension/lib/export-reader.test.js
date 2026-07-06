/**
 * @jest-environment jsdom
 */

const { readGroceryExport } = require('./export-reader.js');

describe('readGroceryExport', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('returns the parsed export when the element holds valid JSON', () => {
    document.body.innerHTML =
      '<script type="application/json" id="grocery-export-data">' +
      '{"exportedAt":"2026-07-06T12:00:00.000Z","items":[{"name":"avocados","quantity":3}]}' +
      '</script>';
    const result = readGroceryExport();
    expect(result.ok).toBe(true);
    expect(result.data.items).toEqual([{ name: 'avocados', quantity: 3 }]);
  });

  test('reports not-found when the element is absent (grocery tab not open)', () => {
    expect(readGroceryExport()).toEqual({ ok: false, error: 'not-found' });
  });

  test('reports invalid-json when the element content is mid-render garbage', () => {
    document.body.innerHTML =
      '<script type="application/json" id="grocery-export-data">{"items":[</script>';
    expect(readGroceryExport()).toEqual({ ok: false, error: 'invalid-json' });
  });
});
