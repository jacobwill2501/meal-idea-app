import {
  getList,
  addMealItems,
  addStapleItems,
  addManualItem,
  toggleItem,
  clearList,
} from './groceryService';

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
});

describe('getList', () => {
  it('returns empty object when nothing stored', async () => {
    expect(await getList()).toEqual({});
  });

  it('returns parsed object from Firestore', async () => {
    fakeStore['chicken'] = { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false };
    expect(await getList()).toEqual({ chicken: { displayText: 'Chicken', count: 1, meals: ['Tacos'], checked: false } });
  });
});

describe('addMealItems', () => {
  it('adds protein, vegetable, carb, extras as separate entries', async () => {
    const meals = [{ name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: 'Salsa' }];
    const list = await addMealItems(meals);
    expect(list['chicken'].displayText).toBe('Chicken');
    expect(list['peppers'].displayText).toBe('Peppers');
    expect(list['rice'].displayText).toBe('Rice');
    expect(list['salsa'].displayText).toBe('Salsa');
  });

  it('skips blank extras', async () => {
    const meals = [{ name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: '' }];
    const list = await addMealItems(meals);
    expect(Object.keys(list)).not.toContain('');
    expect(Object.keys(list).length).toBe(3);
  });

  it('deduplicates across two meals and increments count', async () => {
    const meals = [
      { name: 'Tacos', protein: 'Chicken', vegetable: 'Peppers', carb: 'Rice', extras: '' },
      { name: 'Stir Fry', protein: 'Chicken', vegetable: 'Broccoli', carb: 'Rice', extras: '' },
    ];
    const list = await addMealItems(meals);
    expect(list['chicken'].count).toBe(2);
    expect(list['chicken'].meals).toEqual(['Tacos', 'Stir Fry']);
    expect(list['rice'].count).toBe(2);
    expect(list['peppers'].count).toBe(1);
  });

  it('normalizes keys to lowercase', async () => {
    const meals = [{ name: 'Tacos', protein: 'Grilled Chicken', vegetable: '', carb: '', extras: '' }];
    const list = await addMealItems(meals);
    expect(list['grilled chicken']).toBeDefined();
  });
});

describe('addStapleItems', () => {
  it('adds staple names with count 0', async () => {
    const list = await addStapleItems([{ id: '1', name: 'Eggs', checked: false }]);
    expect(list['eggs']).toEqual({ displayText: 'Eggs', count: 0, meals: [], checked: false });
  });

  it('does not overwrite an existing meal entry', async () => {
    await addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
    await addStapleItems([{ id: '1', name: 'Chicken', checked: false }]);
    const list = await getList();
    expect(list['chicken'].count).toBe(1); // unchanged
    expect(list['chicken'].meals).toEqual(['Tacos']); // unchanged
  });
});

describe('addManualItem', () => {
  it('adds a new item with count 0', async () => {
    const list = await addManualItem('Olive Oil');
    expect(list['olive oil']).toEqual({ displayText: 'Olive Oil', count: 0, meals: [], checked: false });
  });

  it('does not overwrite an existing entry', async () => {
    await addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
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

describe('clearList', () => {
  it('returns empty object and clears Firestore', async () => {
    await addManualItem('Eggs');
    const list = await clearList();
    expect(list).toEqual({});
    expect(Object.keys(fakeStore).length).toBe(0);
  });
});
