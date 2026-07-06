import { formatIngredientRows } from './formatIngredientRows';

describe('formatIngredientRows', () => {
  it('returns an empty string for an empty or missing array', () => {
    expect(formatIngredientRows([])).toBe('');
    expect(formatIngredientRows(undefined)).toBe('');
  });

  it('returns an empty string for a legacy comma-delimited string instead of crashing', () => {
    expect(formatIngredientRows('Chicken, Rice')).toBe('');
  });

  it('joins row names with a comma, omitting quantity when it is 1', () => {
    expect(formatIngredientRows([{ name: 'chicken', qty: 1 }, { name: 'rice', qty: 1 }])).toBe('chicken, rice');
  });

  it('appends "x{qty}" when quantity is greater than 1', () => {
    expect(formatIngredientRows([{ name: 'chicken', qty: 2 }, { name: 'rice', qty: 1 }])).toBe('chicken x2, rice');
  });
});
