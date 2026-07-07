// Pure matching heuristics for pairing a grocery item name with Amazon
// search-result candidates. No DOM or chrome.* usage so it can be
// unit-tested with Jest; content scripts consume it via the
// GroceryMatcher global (loaded before them in manifest.json).

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'the', 'of', 'or', 'with', 'for', 'fresh',
]);

// Ambiguous unless the runner-up trails the top score by at least this much.
const CLEAR_MARGIN = 0.25;

function normalizeTokens(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token && !STOP_WORDS.has(token));
}

// Grocery names exported from the app's weekly plan carry a trailing meal
// annotation — "avocado (picadillo, Salmon Bowls)" — which must not reach
// search queries, match scoring, or pin keys. Only TRAILING parenthetical
// groups are stripped (repeatedly, for stacked ones); mid-name parens
// survive. If stripping would leave nothing, the original name wins.
function stripMealAnnotation(name) {
  const original = String(name || '').trim();
  let result = original;
  let prev;
  do {
    prev = result;
    result = result.replace(/\s*\([^()]*\)\s*$/, '').trim();
  } while (result !== prev);
  return result || original;
}

function normalizeKey(name) {
  return normalizeTokens(stripMealAnnotation(name)).join(' ');
}

function scoreTitle(itemTokens, title) {
  if (!Array.isArray(itemTokens) || itemTokens.length === 0) return 0;
  const titleTokens = new Set(normalizeTokens(title));
  const hits = itemTokens.filter((token) => titleTokens.has(token)).length;
  return hits / itemTokens.length;
}

function pickBest(itemName, candidates) {
  const itemTokens = normalizeTokens(stripMealAnnotation(itemName));
  const list = Array.isArray(candidates) ? candidates : [];
  const scored = list
    .filter((candidate) => candidate && candidate.asin)
    .map((candidate) => ({ candidate, score: scoreTitle(itemTokens, candidate.title || '') }))
    .sort((a, b) => b.score - a.score);

  if (scored.length === 0 || itemTokens.length === 0) {
    return { decision: 'ambiguous', best: null, scored };
  }

  const top = scored[0];
  const runnerUp = scored[1];
  const clearMargin = !runnerUp || runnerUp.score <= top.score - CLEAR_MARGIN;

  if (top.score === 1 && clearMargin) {
    return { decision: 'auto_add', best: top.candidate, scored };
  }
  return { decision: 'ambiguous', best: null, scored };
}

const GroceryMatcher = { normalizeTokens, normalizeKey, scoreTitle, pickBest, stripMealAnnotation };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = GroceryMatcher;
}
if (typeof globalThis !== 'undefined') {
  globalThis.GroceryMatcher = GroceryMatcher;
}
