import {
  getList,
  saveList,
  addMealItems,
  addStapleItems,
  addManualItem,
  toggleItem,
  clearList,
} from './groceryService';

beforeEach(() => {
  localStorage.clear();
});

describe('getList', () => {
  it('returns empty object when nothing stored', () => {
    expect(getList()).toEqual({});
  });

  it('returns parsed object from localStorage', () => {
    localStorage.setItem('groceryList', JSON.stringify({ chicken: { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false } }));
    expect(getList()).toEqual({ chicken: { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false } });
  });
});

describe('addMealItems', () => {
  it('adds protein, vegetable, carb, extras as separate entries', () => {
    const meals = [{ name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: 'Salsa' }];
    const list = addMealItems(meals);
    expect(list['chicken'].displayText).toBe('Chicken');
    expect(list['peppers'].displayText).toBe('Peppers');
    expect(list['rice'].displayText).toBe('Rice');
    expect(list['salsa'].displayText).toBe('Salsa');
  });

  it('skips blank extras', () => {
    const meals = [{ name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: '' }];
    const list = addMealItems(meals);
    expect(Object.keys(list)).not.toContain('');
    expect(Object.keys(list).length).toBe(3);
  });

  it('deduplicates across two meals and increments count', () => {
    const meals = [
      { name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: '' },
      { name: 'Stir Fry', protein: 'Chicken', vegetable: 'Broccoli', carb: 'Rice', extras: '' },
    ];
    const list = addMealItems(meals);
    expect(list['chicken'].count).toBe(2);
    expect(list['chicken'].meals).toEqual(['Tacos', 'Stir Fry']);
    expect(list['rice'].count).toBe(2);
    expect(list['peppers'].count).toBe(1);
  });

  it('normalizes keys to lowercase', () => {
    const meals = [{ name: 'Tacos', protein: 'Grilled Chicken', vegetable: '', carb: '', extras: '' }];
    const list = addMealItems(meals);
    expect(list['grilled chicken']).toBeDefined();
  });
});

describe('addStapleItems', () => {
  it('adds staple names with count 0', () => {
    const list = addStapleItems([{ id: '1', name: 'Eggs', checked: false }]);
    expect(list['eggs']).toEqual({ displayText: 'Eggs', count: 0, meals: [], checked: false });
  });

  it('does not overwrite an existing meal entry', () => {
    addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
    addStapleItems([{ id: '1', name: 'Chicken', checked: false }]);
    const list = getList();
    expect(list['chicken'].count).toBe(1); // unchanged
    expect(list['chicken'].meals).toEqual(['Tacos']); // unchanged
  });
});

describe('addManualItem', () => {
  it('adds a new item with count 0', () => {
    const list = addManualItem('Olive Oil');
    expect(list['olive oil']).toEqual({ displayText: 'Olive Oil', count: 0, meals: [], checked: false });
  });

  it('does not overwrite an existing entry', () => {
    addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
    addManualItem('Chicken');
    const list = getList();
    expect(list['chicken'].count).toBe(1);
    expect(list['chicken'].meals).toEqual(['Tacos']);
  });

  it('ignores blank input', () => {
    const list = addManualItem('   ');
    expect(Object.keys(list).length).toBe(0);
  });
});

describe('toggleItem', () => {
  it('flips checked from false to true', () => {
    addManualItem('Eggs');
    const list = toggleItem('eggs');
    expect(list['eggs'].checked).toBe(true);
  });

  it('flips checked from true to false', () => {
    addManualItem('Eggs');
    toggleItem('eggs');
    const list = toggleItem('eggs');
    expect(list['eggs'].checked).toBe(false);
  });
});

describe('clearList', () => {
  it('returns empty object and removes localStorage key', () => {
    addManualItem('Eggs');
    const list = clearList();
    expect(list).toEqual({});
    expect(localStorage.getItem('groceryList')).toBeNull();
  });
});
