import {
  getList,
  addMealItems,
  addStapleItems,
  addManualItem,
  toggleItem,
  updateQuantity,
  clearList,
} from './groceryService';
import { updateDoc } from 'firebase/firestore';

// Must use var so the jest.mock hoisting can reference it
var fakeStore = {};

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(async () => {
    const entries = Object.entries(fakeStore);
    const docs = entries.map(([id, data]) => ({
      id,
      data: () => ({ ...data }),
      ref: { id },
    }));
    return {
      docs,
      forEach: (cb) => docs.forEach(cb),
    };
  }),
  setDoc: jest.fn(async (ref, data) => { fakeStore[ref._id] = { ...data }; }),
  updateDoc: jest.fn(async (ref, fields) => { Object.assign(fakeStore[ref._id], fields); }),
  doc: jest.fn((db, col, id) => ({ _id: id })),
  writeBatch: jest.fn(() => {
    const ops = [];
    return {
      set: jest.fn((ref, data, opts) => ops.push({ type: 'set', ref, data, opts })),
      delete: jest.fn((ref) => ops.push({ type: 'delete', ref })),
      commit: jest.fn(async () => {
        ops.forEach(({ type, ref, data }) => {
          if (type === 'set') fakeStore[ref._id] = { ...data };
          if (type === 'delete') delete fakeStore[ref._id];
        });
      }),
    };
  }),
}));

jest.mock('../firebase', () => ({ db: {} }));
// Suppress Firebase app initialization errors during module load
jest.mock('firebase/app', () => ({ initializeApp: jest.fn() }));

beforeEach(() => {
  Object.keys(fakeStore).forEach(k => delete fakeStore[k]);
  jest.clearAllMocks();
});

describe('getList', () => {
  it('returns empty object when nothing stored', async () => {
    expect(await getList()).toEqual({});
  });

  it('returns parsed object from Firestore', async () => {
    fakeStore['chicken'] = { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false };
    expect(await getList()).toEqual({ chicken: { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false } });
  });

  it('coerces old meal-frequency or zero counts up to at least 1', async () => {
    fakeStore['eggs'] = { displayText: 'Eggs', count: 0, meals: [], checked: false };
    fakeStore['chicken'] = { displayText: 'Chicken', count: 4, meals: ['Tacos', 'Bowl'], checked: false };
    fakeStore['rice'] = { displayText: 'Rice', meals: [], checked: false };
    const list = await getList();
    expect(list['eggs'].count).toBe(1);
    expect(list['chicken'].count).toBe(4);
    expect(list['rice'].count).toBe(1);
  });
});

describe('addMealItems', () => {
  it('adds protein, vegetable, carb, extras as separate entries', async () => {
    const meals = [{
      name: 'Tacos',
      protein: [{ name: 'Chicken', qty: 1 }],
      vegetable: [{ name: 'Peppers', qty: 1 }],
      carb: [{ name: 'Rice', qty: 1 }],
      extras: [{ name: 'Salsa', qty: 1 }],
    }];
    const list = await addMealItems(meals);
    expect(list['chicken'].displayText).toBe('Chicken');
    expect(list['peppers'].displayText).toBe('Peppers');
    expect(list['rice'].displayText).toBe('Rice');
    expect(list['salsa'].displayText).toBe('Salsa');
  });

  it('skips rows with a blank name', async () => {
    const meals = [{
      name: 'Tacos',
      protein: [{ name: 'Chicken', qty: 1 }],
      vegetable: [{ name: 'Peppers', qty: 1 }],
      carb: [{ name: 'Rice', qty: 1 }],
      extras: [{ name: '', qty: 1 }],
    }];
    const list = await addMealItems(meals);
    expect(Object.keys(list)).not.toContain('');
    expect(Object.keys(list).length).toBe(3);
  });

  it('treats a missing category array as empty', async () => {
    const meals = [{ name: 'Tacos', protein: [{ name: 'Chicken', qty: 1 }], vegetable: [], carb: [], extras: undefined }];
    const list = await addMealItems(meals);
    expect(Object.keys(list).length).toBe(1);
  });

  it('carries a row quantity into a new grocery item', async () => {
    const meals = [{ name: 'Tacos', protein: [{ name: 'Chicken', qty: 3 }], vegetable: [], carb: [], extras: [] }];
    const list = await addMealItems(meals);
    expect(list['chicken'].count).toBe(3);
  });

  it('sums quantities across two meals sharing an ingredient', async () => {
    const meals = [
      { name: 'Tacos', protein: [{ name: 'Chicken', qty: 1 }], vegetable: [{ name: 'Peppers', qty: 1 }], carb: [{ name: 'Rice', qty: 1 }], extras: [] },
      { name: 'Stir Fry', protein: [{ name: 'Chicken', qty: 2 }], vegetable: [{ name: 'Broccoli', qty: 1 }], carb: [{ name: 'Rice', qty: 1 }], extras: [] },
    ];
    const list = await addMealItems(meals);
    expect(list['chicken'].count).toBe(3); // 1 (Tacos) + 2 (Stir Fry)
    expect(list['chicken'].meals).toEqual(['Tacos', 'Stir Fry']);
    expect(list['rice'].count).toBe(2); // 1 + 1
    expect(list['peppers'].count).toBe(1);
  });

  it('re-syncing the same meal twice does not duplicate meal names or double-count', async () => {
    const meal = { name: 'Tacos', protein: [{ name: 'Chicken', qty: 2 }], vegetable: [], carb: [], extras: [] };
    await addMealItems([meal]);
    await updateQuantity('chicken', 9);

    const list = await addMealItems([meal]);

    expect(list['chicken'].meals).toEqual(['Tacos']);
    expect(list['chicken'].count).toBe(9);
  });

  it('only contributes quantity once when a meal lists the same ingredient name twice', async () => {
    const meal = { name: 'Bowl', protein: [{ name: 'Chicken', qty: 2 }, { name: 'Chicken', qty: 5 }], vegetable: [], carb: [], extras: [] };
    const list = await addMealItems([meal]);
    expect(list['chicken'].count).toBe(2);
    expect(list['chicken'].meals).toEqual(['Bowl']);
  });

  it('normalizes keys to lowercase', async () => {
    const meals = [{ name: 'Tacos', protein: [{ name: 'Grilled Chicken', qty: 1 }], vegetable: [], carb: [], extras: [] }];
    const list = await addMealItems(meals);
    expect(list['grilled chicken']).toBeDefined();
  });
});

describe('addStapleItems', () => {
  it('adds staple names with count 1 when the staple has no count', async () => {
    const list = await addStapleItems([{ id: '1', name: 'Eggs', checked: false }]);
    expect(list['eggs']).toEqual({ displayText: 'Eggs', count: 1, meals: [], checked: false });
  });

  it('uses the staple count when creating a new grocery item', async () => {
    const list = await addStapleItems([{ id: '1', name: 'Eggs', checked: false, count: 2 }]);
    expect(list['eggs'].count).toBe(2);
  });

  it('merges into an existing meal entry by adding the staple count', async () => {
    await addMealItems([{ name: 'Tacos', protein: [{ name: 'Chicken', qty: 1 }], vegetable: [], carb: [], extras: [] }]);
    await addStapleItems([{ id: '1', name: 'Chicken', checked: false }]);
    const list = await getList();
    expect(list['chicken'].count).toBe(2); // 1 (meal) + 1 (staple default)
    expect(list['chicken'].meals).toEqual(['Tacos']); // unchanged
  });

  it('merges a staple with count > 1 into an existing grocery item', async () => {
    await addMealItems([{ name: 'Tacos', protein: [{ name: 'Chicken', qty: 1 }], vegetable: [], carb: [], extras: [] }]);
    await addStapleItems([{ id: '1', name: 'Chicken', checked: false, count: 3 }]);
    const list = await getList();
    expect(list['chicken'].count).toBe(4); // 1 (meal) + 3 (staple)
  });

  it('adds the staple count again on a second call (not idempotent by design)', async () => {
    await addStapleItems([{ id: '1', name: 'Eggs', checked: false, count: 1 }]);
    const list = await addStapleItems([{ id: '1', name: 'Eggs', checked: false, count: 1 }]);
    expect(list['eggs'].count).toBe(2);
  });
});

describe('addManualItem', () => {
  it('adds a new item with count 1', async () => {
    const list = await addManualItem('Olive Oil');
    expect(list['olive oil']).toEqual({ displayText: 'Olive Oil', count: 1, meals: [], checked: false });
  });

  it('does not overwrite an existing entry', async () => {
    await addMealItems([{ name: 'Tacos', protein: [{ name: 'Chicken', qty: 1 }], vegetable: [], carb: [], extras: [] }]);
    await addManualItem('Chicken');
    const list = await getList();
    expect(list['chicken'].count).toBe(1);
    expect(list['chicken'].meals).toEqual(['Tacos']);
  });

  it('ignores blank input', async () => {
    const list = await addManualItem('   ');
    expect(Object.keys(list).length).toBe(0);
  });
});

describe('toggleItem', () => {
  it('flips checked from false to true', async () => {
    await addManualItem('Eggs');
    const list = await toggleItem('eggs');
    expect(list['eggs'].checked).toBe(true);
  });

  it('flips checked from true to false', async () => {
    await addManualItem('Eggs');
    await toggleItem('eggs');
    const list = await toggleItem('eggs');
    expect(list['eggs'].checked).toBe(false);
  });
});

describe('updateQuantity', () => {
  it('sets the count for an existing item', async () => {
    await addManualItem('Eggs');
    const list = await updateQuantity('eggs', 6);
    expect(list['eggs'].count).toBe(6);
    const stored = await getList();
    expect(stored['eggs'].count).toBe(6);
  });

  it('clamps a value below 1 up to 1', async () => {
    await addManualItem('Eggs');
    const list = await updateQuantity('eggs', 0);
    expect(list['eggs'].count).toBe(1);
    const list2 = await updateQuantity('eggs', -5);
    expect(list2['eggs'].count).toBe(1);
  });

  it('no-ops safely on a nonexistent key', async () => {
    const list = await updateQuantity('does-not-exist', 3);
    expect(list['does-not-exist']).toBeUndefined();
    expect(updateDoc).not.toHaveBeenCalled();
  });
});

describe('clearList', () => {
  it('returns empty object and clears Firestore', async () => {
    await addManualItem('Eggs');
    const list = await clearList();
    expect(list).toEqual({});
    expect(Object.keys(fakeStore).length).toBe(0);
  });
});
