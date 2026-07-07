const { normalizeTokens, normalizeKey, scoreTitle, pickBest } = require('./matcher');
const GroceryMatcher = require('./matcher');

describe('normalizeTokens', () => {
  test('lowercases, strips punctuation, drops stop words', () => {
    expect(normalizeTokens('Fresh Chicken-Breast, of the day')).toEqual(['chicken', 'breast', 'day']);
  });

  test('handles empty and non-string input', () => {
    expect(normalizeTokens('')).toEqual([]);
    expect(normalizeTokens(null)).toEqual([]);
    expect(normalizeTokens(undefined)).toEqual([]);
  });
});

describe('normalizeKey', () => {
  test('same key for spacing/case/punctuation variants', () => {
    expect(normalizeKey('Chicken Breast')).toBe('chicken breast');
    expect(normalizeKey('  chicken   breast ')).toBe('chicken breast');
    expect(normalizeKey('chicken, breast')).toBe('chicken breast');
  });
});

describe('scoreTitle', () => {
  test('full overlap scores 1', () => {
    expect(scoreTitle(['chicken', 'breast'], 'Boneless Skinless Chicken Breast 2lb')).toBe(1);
  });

  test('partial overlap scores fractionally', () => {
    expect(scoreTitle(['chicken', 'breast'], 'Chicken Thighs Family Pack')).toBe(0.5);
  });

  test('empty item tokens score 0', () => {
    expect(scoreTitle([], 'Anything')).toBe(0);
  });
});

describe('pickBest', () => {
  const c = (asin, title) => ({ asin, title });

  test('auto_add when top contains all tokens and beats runner-up by clear margin', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Boneless Chicken Breast'),
      c('A2', 'Pork Chops'),
    ]);
    expect(result.decision).toBe('auto_add');
    expect(result.best.asin).toBe('A1');
  });

  test('auto_add with a single all-token candidate (no runner-up)', () => {
    const result = pickBest('milk', [c('A1', 'Whole Milk Gallon')]);
    expect(result.decision).toBe('auto_add');
    expect(result.best.asin).toBe('A1');
  });

  test('ambiguous when runner-up is within the margin', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Organic Chicken Breast'),
      c('A2', 'Chicken Breast Tenders'),
    ]);
    expect(result.decision).toBe('ambiguous');
    expect(result.best).toBeNull();
  });

  test('ambiguous when top result lacks a token, even alone', () => {
    const result = pickBest('almond milk', [c('A1', 'Whole Milk Gallon')]);
    expect(result.decision).toBe('ambiguous');
  });

  test('ambiguous on empty candidates and skips ASIN-less candidates', () => {
    expect(pickBest('milk', []).decision).toBe('ambiguous');
    expect(pickBest('milk', [{ asin: null, title: 'Whole Milk' }]).decision).toBe('ambiguous');
  });

  test('scored list is sorted descending and covers all valid candidates', () => {
    const result = pickBest('chicken breast', [
      c('A1', 'Pork Chops'),
      c('A2', 'Boneless Chicken Breast'),
    ]);
    expect(result.scored.map((s) => s.candidate.asin)).toEqual(['A2', 'A1']);
  });
});

describe('meal annotations', () => {
  test('stripMealAnnotation strips a trailing meal annotation', () => {
    expect(GroceryMatcher.stripMealAnnotation('avocado (picadillo, Salmon Bowls)')).toBe(
      'avocado'
    );
  });

  test('stripMealAnnotation strips stacked trailing groups but keeps mid-name parens', () => {
    expect(GroceryMatcher.stripMealAnnotation('salsa (mild) (tacos)')).toBe('salsa');
    expect(GroceryMatcher.stripMealAnnotation('half (&) half cream')).toBe(
      'half (&) half cream'
    );
  });

  test('stripMealAnnotation returns the original when stripping would leave nothing', () => {
    expect(GroceryMatcher.stripMealAnnotation('(picadillo)')).toBe('(picadillo)');
  });

  test('normalizeKey ignores meal annotations so existing pins still match', () => {
    expect(GroceryMatcher.normalizeKey('avocado (picadillo, Salmon Bowls)')).toBe(
      GroceryMatcher.normalizeKey('avocado')
    );
  });

  test('pickBest ignores meal annotations when scoring', () => {
    const { decision, best } = GroceryMatcher.pickBest(
      'avocado (picadillo, Salmon Bowls)',
      [
        { asin: 'B1', title: 'Avocado' },
        { asin: 'B2', title: 'Guacamole Dip' },
      ]
    );
    expect(decision).toBe('auto_add');
    expect(best.asin).toBe('B1');
  });
});
