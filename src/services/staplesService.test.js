import {
  getAllStaples,
  addStaple,
  updateStapleQuantity,
} from './staplesService';

// Must use var so the jest.mock hoisting can reference it
var mockFakeStore = {};
var mockNextId = 1;

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(async () => {
    const entries = Object.entries(mockFakeStore);
    const docs = entries.map(([id, data]) => ({
      id,
      data: () => ({ ...data }),
    }));
    return {
      docs,
      forEach: (cb) => docs.forEach(cb),
    };
  }),
  addDoc: jest.fn(async (col, data) => {
    const id = `staple-${mockNextId++}`;
    mockFakeStore[id] = { ...data };
    return { id };
  }),
  updateDoc: jest.fn(async (ref, fields) => {
    Object.assign(mockFakeStore[ref._id], fields);
  }),
  deleteDoc: jest.fn(async (ref) => {
    delete mockFakeStore[ref._id];
  }),
  doc: jest.fn((db, col, id) => ({ _id: id })),
  writeBatch: jest.fn(() => {
    const ops = [];
    return {
      update: jest.fn((ref, fields) => ops.push({ ref, fields })),
      commit: jest.fn(async () => {
        ops.forEach(({ ref, fields }) => Object.assign(mockFakeStore[ref._id], fields));
      }),
    };
  }),
}));

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/app', () => ({ initializeApp: jest.fn() }));

beforeEach(() => {
  Object.keys(mockFakeStore).forEach((k) => delete mockFakeStore[k]);
  mockNextId = 1;
  jest.clearAllMocks();
});

describe('getAllStaples', () => {
  it('defaults a missing count to 1', async () => {
    mockFakeStore['s1'] = { name: 'Eggs', checked: false };
    const staples = await getAllStaples();
    expect(staples).toEqual([{ id: 's1', name: 'Eggs', checked: false, count: 1 }]);
  });

  it('leaves a valid count untouched', async () => {
    mockFakeStore['s1'] = { name: 'Eggs', checked: false, count: 3 };
    const staples = await getAllStaples();
    expect(staples[0].count).toBe(3);
  });

  it('coerces a zero count up to 1', async () => {
    mockFakeStore['s1'] = { name: 'Eggs', checked: false, count: 0 };
    const staples = await getAllStaples();
    expect(staples[0].count).toBe(1);
  });
});

describe('addStaple', () => {
  it('creates a staple with count 1', async () => {
    const staple = await addStaple('Eggs');
    expect(staple.count).toBe(1);
    expect(mockFakeStore[staple.id].count).toBe(1);
  });
});

describe('updateStapleQuantity', () => {
  it('persists a valid count', async () => {
    const staple = await addStaple('Eggs');
    await updateStapleQuantity(staple.id, 5);
    expect(mockFakeStore[staple.id].count).toBe(5);
  });

  it('clamps a value below 1 up to 1', async () => {
    const staple = await addStaple('Eggs');
    await updateStapleQuantity(staple.id, 0);
    expect(mockFakeStore[staple.id].count).toBe(1);
    await updateStapleQuantity(staple.id, -5);
    expect(mockFakeStore[staple.id].count).toBe(1);
  });
});
