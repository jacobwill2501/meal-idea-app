// Reads the meal-idea-app's grocery export element out of the current
// document. This function is injected into the app page via
// chrome.scripting.executeScript, which serializes it — so it MUST stay
// closure-free: no references to anything defined outside its own body.
//
// The #grocery-export-data <script type="application/json"> element is
// rendered by the app's GroceryList component and exists only while the
// Grocery List tab is active, which is exactly what makes it a reliable
// "is the user on the grocery list page" probe for the popup.

function readGroceryExport() {
  const el = document.getElementById('grocery-export-data');
  if (!el) {
    return { ok: false, error: 'not-found' };
  }
  try {
    return { ok: true, data: JSON.parse(el.textContent) };
  } catch (err) {
    return { ok: false, error: 'invalid-json' };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { readGroceryExport };
}
if (typeof globalThis !== 'undefined') {
  globalThis.readGroceryExport = readGroceryExport;
}
