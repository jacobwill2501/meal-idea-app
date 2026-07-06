# Structured Meal Ingredient Rows with Quantity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace each meal's comma-delimited ingredient strings (`protein`, `vegetable`, `carb`, `extras`) with structured `{ name, qty }` row arrays, editable via a shared row-editor UI in both the Meal Library and its expanded edit view, displayed with quantities in the Weekly Plan, and carried into the Grocery List's count (summed across meals that share an ingredient).

**Architecture:** A new `IngredientRowsEditor` component (add/remove/qty-stepper rows) is shared by `MealForm.jsx` (create) and `MealItem.jsx` (edit). A new `formatIngredientRows` util renders rows as read-only text, shared by `MealItem.jsx`'s collapsed summary and `MealPlan.jsx`. `groceryService.js`'s `addMealItems` iterates row arrays directly instead of comma-splitting strings, summing quantities across meals via the existing per-meal-per-key dedup guard. A one-time, manually-run migration script converts legacy string-format meals in Firestore.

**Tech Stack:** React 19, Material-UI 7, Firebase Firestore (client SDK), Jest + babel-jest with the existing hand-rolled `firebase/firestore` mock, `react-dom/client` + `act` for component tests (no React Testing Library — matches `GroceryList.test.jsx`'s existing convention). No new npm dependencies.

## Global Constraints

- Each ingredient row is `{ name: string, qty: number }`, `qty` minimum `1` via `Math.max(1, qty || 1)`.
- A category with no ingredients is stored as `[]`, never `null`/`undefined`.
- Rows with a blank/whitespace-only `name` are dropped when a meal is saved and skipped when processed by `addMealItems`.
- `addMealItems` merge behavior: a new grocery item gets `count` = the row's `qty`; an existing one gets `count` += the row's `qty` — but only once per meal per ingredient key. The existing guard (`list[key].meals.includes(meal.name)`) that already prevents duplicate meal-name entries is reused to gate the quantity addition too, so re-running `addMealItems` for an unchanged week does not double-count, and a meal that lists the same ingredient name twice only contributes once.
- The migration script (`scripts/migrate-meal-ingredients.mjs`) is not run automatically as part of any task in this plan — it requires live Firebase credentials and is run manually by the project owner after review.
- No new npm dependencies.

---

### Task 1: Ingredient row primitives — `formatIngredientRows` util and `IngredientRowsEditor` component

**Files:**
- Create: `src/utils/formatIngredientRows.js`
- Create: `src/utils/formatIngredientRows.test.js`
- Create: `src/components/IngredientRowsEditor.jsx`
- Create: `src/components/IngredientRowsEditor.test.jsx`

**Interfaces:**
- Produces: `formatIngredientRows(rows)` — pure function, `rows: Array<{name, qty}> | undefined` → `string`. Consumed by Task 4 (`MealItem.jsx`) and Task 5 (`MealPlan.jsx`).
- Produces: `IngredientRowsEditor` — React component, props `{ label: string, rows: Array<{name, qty}>, onChange: (newRows) => void }`. Consumed by Task 3 (`MealForm.jsx`) and Task 4 (`MealItem.jsx`).

- [ ] **Step 1: Write the failing test for `formatIngredientRows`**

Create `src/utils/formatIngredientRows.test.js`:

```javascript
import { formatIngredientRows } from './formatIngredientRows';

describe('formatIngredientRows', () => {
  it('returns an empty string for an empty or missing array', () => {
    expect(formatIngredientRows([])).toBe('');
    expect(formatIngredientRows(undefined)).toBe('');
  });

  it('joins row names with a comma, omitting quantity when it is 1', () => {
    expect(formatIngredientRows([{ name: 'chicken', qty: 1 }, { name: 'rice', qty: 1 }])).toBe('chicken, rice');
  });

  it('appends "x{qty}" when quantity is greater than 1', () => {
    expect(formatIngredientRows([{ name: 'chicken', qty: 2 }, { name: 'rice', qty: 1 }])).toBe('chicken x2, rice');
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx jest src/utils/formatIngredientRows.test.js`

Expected: FAIL — `Cannot find module './formatIngredientRows'`.

- [ ] **Step 3: Implement `formatIngredientRows`**

Create `src/utils/formatIngredientRows.js`:

```javascript
export function formatIngredientRows(rows) {
  if (!rows || rows.length === 0) return '';
  return rows.map((row) => (row.qty > 1 ? `${row.name} x${row.qty}` : row.name)).join(', ');
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx jest src/utils/formatIngredientRows.test.js`

Expected: PASS, all 3 tests.

- [ ] **Step 5: Write the failing tests for `IngredientRowsEditor`**

Create `src/components/IngredientRowsEditor.test.jsx`:

```jsx
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import IngredientRowsEditor from './IngredientRowsEditor';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('IngredientRowsEditor', () => {
  let container;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
    container = null;
  });

  async function renderEditor(rows, onChange) {
    const root = createRoot(container);
    await act(async () => {
      root.render(<IngredientRowsEditor label="Protein Option" rows={rows} onChange={onChange} />);
    });
    return root;
  }

  it('calls onChange with a new blank row when "Add ingredient" is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent === 'Add ingredient'
    );
    await act(async () => {
      addButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([
      { name: 'chicken', qty: 1 },
      { name: '', qty: 1 },
    ]);
  });

  it('calls onChange with the row removed when its remove button is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor(
      [{ name: 'chicken', qty: 1 }, { name: 'rice', qty: 2 }],
      onChange
    );

    const removeButton = container.querySelector('button[aria-label="remove row 1"]');
    await act(async () => {
      removeButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([{ name: 'rice', qty: 2 }]);
  });

  it('increments a row quantity when its + button is clicked', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const incrementButton = container.querySelector(
      'button[aria-label="increase quantity of row 1"]'
    );
    await act(async () => {
      incrementButton.click();
    });

    expect(onChange).toHaveBeenCalledWith([{ name: 'chicken', qty: 2 }]);
  });

  it('disables the decrement button at qty 1 and does not call onChange', async () => {
    const onChange = jest.fn();
    await renderEditor([{ name: 'chicken', qty: 1 }], onChange);

    const decrementButton = container.querySelector(
      'button[aria-label="decrease quantity of row 1"]'
    );
    expect(decrementButton.disabled).toBe(true);

    await act(async () => {
      decrementButton.click();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests — verify they fail**

Run: `npx jest src/components/IngredientRowsEditor.test.jsx`

Expected: FAIL — `Cannot find module './IngredientRowsEditor'`.

- [ ] **Step 7: Implement `IngredientRowsEditor`**

Create `src/components/IngredientRowsEditor.jsx`:

```jsx
import React from 'react';
import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';

const IngredientRowsEditor = ({ label, rows, onChange }) => {
  const handleNameChange = (index, name) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, name } : row)));
  };

  const handleQtyChange = (index, qty) => {
    if (qty < 1) return;
    onChange(rows.map((row, i) => (i === index ? { ...row, qty } : row)));
  };

  const handleRemove = (index) => {
    onChange(rows.filter((_, i) => i !== index));
  };

  const handleAdd = () => {
    onChange([...rows, { name: '', qty: 1 }]);
  };

  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {label}
      </Typography>
      <Stack spacing={1}>
        {rows.map((row, index) => (
          <Stack key={index} direction="row" spacing={1} alignItems="center">
            <TextField
              size="small"
              placeholder="Ingredient name"
              fullWidth
              value={row.name}
              onChange={(e) => handleNameChange(index, e.target.value)}
            />
            <IconButton
              size="small"
              aria-label={`decrease quantity of row ${index + 1}`}
              disabled={row.qty <= 1}
              onClick={() => handleQtyChange(index, row.qty - 1)}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            <Typography variant="body2" sx={{ minWidth: '1.5em', textAlign: 'center' }}>
              {row.qty}
            </Typography>
            <IconButton
              size="small"
              aria-label={`increase quantity of row ${index + 1}`}
              onClick={() => handleQtyChange(index, row.qty + 1)}
            >
              <AddIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              aria-label={`remove row ${index + 1}`}
              onClick={() => handleRemove(index)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Stack>
        ))}
      </Stack>
      <Button size="small" startIcon={<AddIcon />} onClick={handleAdd} sx={{ mt: 1 }}>
        Add ingredient
      </Button>
    </Box>
  );
};

export default IngredientRowsEditor;
```

- [ ] **Step 8: Run tests — verify they pass**

Run: `npx jest src/components/IngredientRowsEditor.test.jsx src/utils/formatIngredientRows.test.js`

Expected: PASS, all tests in both files.

- [ ] **Step 9: Commit**

```bash
git add src/utils/formatIngredientRows.js src/utils/formatIngredientRows.test.js src/components/IngredientRowsEditor.jsx src/components/IngredientRowsEditor.test.jsx
git commit -m "feat: add IngredientRowsEditor component and formatIngredientRows util"
```

---

### Task 2: `groceryService.js` — row-array `addMealItems`

**Files:**
- Modify: `src/services/groceryService.js` (the `addMealItems` function)
- Modify: `src/services/groceryService.test.js` (full file replacement — see Step 1)

**Interfaces:**
- Consumes: meal objects shaped `{ name, protein, vegetable, carb, extras }` where each category is `Array<{name, qty}> | undefined`.
- Produces: no new exports; `addMealItems`'s new input shape is consumed by Task 3/4 (`MealForm.jsx`/`MealItem.jsx` now save this shape) and Task 5 (`MealPlan.jsx` calls `addMealItems(weekMeals)` unchanged).

This task also absorbs updating the `addStapleItems` test fixtures in the same file, since those tests seed a meal-sourced grocery item via `addMealItems` using the old string format — replacing the whole file in one step avoids drift between the two changes.

- [ ] **Step 1: Replace the full contents of `src/services/groceryService.test.js`**

```javascript
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
```

- [ ] **Step 2: Run tests — verify the `addMealItems` and `addStapleItems` tests fail**

Run: `npx jest src/services/groceryService.test.js`

Expected: FAIL — the `addMealItems` tests fail because the current implementation still comma-splits strings (passing an array where a string was expected breaks `.split`/`.trim`), and the `addStapleItems` merge tests fail because the current implementation still skips existing entries instead of summing.

- [ ] **Step 3: Implement the `addMealItems` change**

In `src/services/groceryService.js`, replace the `addMealItems` function:

```javascript
export async function addMealItems(weekMeals) {
  const list = await getList();
  const batch = writeBatch(db);
  const modifiedKeys = new Set();

  weekMeals.forEach((meal) => {
    [meal.protein, meal.vegetable, meal.carb, meal.extras].forEach((rows) => {
      (rows || []).forEach(({ name, qty }) => {
        if (!name || !name.trim()) return;
        const key = normalizeKey(name);
        const safeQty = Math.max(1, qty || 1);
        if (list[key]) {
          if (!list[key].meals.includes(meal.name)) {
            list[key].count += safeQty;
            list[key].meals.push(meal.name);
          }
        } else {
          list[key] = { displayText: name.trim(), count: safeQty, meals: [meal.name], checked: false };
        }
        modifiedKeys.add(key);
      });
    });
  });

  // Batch write only modified keys
  modifiedKeys.forEach((key) => {
    batch.set(doc(db, COLLECTION, key), list[key], { merge: true });
  });

  await batch.commit();
  return list;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest src/services/groceryService.test.js`

Expected: all tests in the file pass (this rewrote the whole file in Step 1, so this is the full suite, not a subset).

- [ ] **Step 5: Commit**

```bash
git add src/services/groceryService.js src/services/groceryService.test.js
git commit -m "feat: carry per-ingredient quantity into addMealItems, summed across meals"
```

---

### Task 3: `MealForm.jsx` — create meals with ingredient rows

**Files:**
- Modify: `src/components/MealForm.jsx`

**Interfaces:**
- Consumes: `IngredientRowsEditor` from Task 1 (`../components/IngredientRowsEditor` — same directory, so `./IngredientRowsEditor`).
- Produces: `addMeal` is now called with `protein`/`vegetable`/`carb`/`extras` as `Array<{name, qty}>` — consumed by Task 6's migration script only in the sense that new meals saved after this task are already in the target format (no interface consumed by other tasks in this plan).

No new test file — `MealForm.jsx` has no unit tests today and this plan doesn't add one (per the spec's Testing section), verified manually in Task 7.

- [ ] **Step 1: Replace the full contents of `src/components/MealForm.jsx`**

```jsx
import React, { useState } from 'react';
import { TextField, Button, Stack, Box } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { addMeal } from '../services/firebaseService';
import IngredientRowsEditor from './IngredientRowsEditor';

const EMPTY_MEAL = {
	name: '',
	protein: [],
	vegetable: [],
	carb: [],
	extras: [],
};

function cleanRows(rows) {
	return rows.filter((row) => row.name && row.name.trim());
}

const MealForm = ({ fetchMeals }) => {
	const [newMeal, setNewMeal] = useState(EMPTY_MEAL);

	const handleAddMeal = async () => {
		if (!newMeal.name.trim()) return;

		await addMeal({
			...newMeal,
			protein: cleanRows(newMeal.protein),
			vegetable: cleanRows(newMeal.vegetable),
			carb: cleanRows(newMeal.carb),
			extras: cleanRows(newMeal.extras),
		});

		setNewMeal(EMPTY_MEAL);
		await fetchMeals();
	};

	return (
		<Stack spacing={2} mb={2}>
			<TextField
				label="Meal Name*"
				variant="outlined"
				fullWidth
				value={newMeal.name}
				onChange={(e) => setNewMeal({ ...newMeal, name: e.target.value })}
			/>
			<IngredientRowsEditor
				label="Protein Option"
				rows={newMeal.protein}
				onChange={(rows) => setNewMeal({ ...newMeal, protein: rows })}
			/>
			<IngredientRowsEditor
				label="Vegetable/Fiber Option"
				rows={newMeal.vegetable}
				onChange={(rows) => setNewMeal({ ...newMeal, vegetable: rows })}
			/>
			<IngredientRowsEditor
				label="Carb Option"
				rows={newMeal.carb}
				onChange={(rows) => setNewMeal({ ...newMeal, carb: rows })}
			/>
			<IngredientRowsEditor
				label="Extras"
				rows={newMeal.extras}
				onChange={(rows) => setNewMeal({ ...newMeal, extras: rows })}
			/>
			<Box textAlign="right">
				<Button
					variant="contained"
					color="secondary"
					startIcon={<AddIcon />}
					onClick={handleAddMeal}
				>
					Add
				</Button>
			</Box>
		</Stack>
	);
};

export default MealForm;
```

- [ ] **Step 2: Confirm the app builds**

Run: `npm run build 2>&1 | tail -20`

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MealForm.jsx
git commit -m "feat: replace Meal Library ingredient text fields with row editors"
```

---

### Task 4: `MealItem.jsx` — edit meals with ingredient rows

**Files:**
- Modify: `src/components/MealItem.jsx`

**Interfaces:**
- Consumes: `IngredientRowsEditor` from Task 1 (`./IngredientRowsEditor`); `formatIngredientRows` from Task 1 (`../utils/formatIngredientRows`).
- Produces: `updateMeal` is now called with row arrays — no further consumers within this plan.

No new test file — `MealItem.jsx` has no unit tests today, verified manually in Task 7.

- [ ] **Step 1: Replace the full contents of `src/components/MealItem.jsx`**

```jsx
import React, { useState, useEffect } from 'react';
import {
	ListItem,
	ListItemText,
	IconButton,
	Collapse,
	Button,
	Stack,
	Box,
	List,
	ListItem as MuiListItem,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import { updateMeal } from '../services/firebaseService';
import IngredientRowsEditor from './IngredientRowsEditor';
import { formatIngredientRows } from '../utils/formatIngredientRows';

function cleanRows(rows) {
	return rows.filter((row) => row.name && row.name.trim());
}

const MealItem = ({
	meal,
	setMeals,
	expandedMealId,
	setExpandedMealId,
	handleDeleteMeal,
}) => {
	const [editFields, setEditFields] = useState({
		protein: meal.protein || [],
		vegetable: meal.vegetable || [],
		carb: meal.carb || [],
		extras: meal.extras || [],
	});

	useEffect(() => {
		if (expandedMealId === meal.id) {
			setEditFields({
				protein: meal.protein || [],
				vegetable: meal.vegetable || [],
				carb: meal.carb || [],
				extras: meal.extras || [],
			});
		}
	}, [expandedMealId, meal]);

	const handleSaveMeal = async () => {
		const updatedMeal = {
			...meal,
			protein: cleanRows(editFields.protein),
			vegetable: cleanRows(editFields.vegetable),
			carb: cleanRows(editFields.carb),
			extras: cleanRows(editFields.extras),
		};
		await updateMeal(meal.id, updatedMeal);
		setMeals((prev) => prev.map((m) => (m.id === meal.id ? updatedMeal : m)));
		setExpandedMealId(null);
	};

	return (
		<>
			<ListItem divider alignItems="flex-start">
				<Box sx={{ flexGrow: 1 }}>
					<ListItemText
						primary={meal.name}
						secondary={`Protein: ${formatIngredientRows(meal.protein)} | Vegetable: ${formatIngredientRows(meal.vegetable)} | Carb: ${formatIngredientRows(meal.carb)} | Extras: ${formatIngredientRows(meal.extras)}`}
					/>
					<Collapse
						in={expandedMealId === meal.id}
						timeout="auto"
						unmountOnExit
					>
						<List component="div" disablePadding sx={{ pl: 2 }}>
							<MuiListItem>
								<Stack spacing={2} width="100%">
									<IngredientRowsEditor
										label="Protein Option"
										rows={editFields.protein}
										onChange={(rows) => setEditFields({ ...editFields, protein: rows })}
									/>
									<IngredientRowsEditor
										label="Vegetable/Fiber Option"
										rows={editFields.vegetable}
										onChange={(rows) => setEditFields({ ...editFields, vegetable: rows })}
									/>
									<IngredientRowsEditor
										label="Carb Option"
										rows={editFields.carb}
										onChange={(rows) => setEditFields({ ...editFields, carb: rows })}
									/>
									<IngredientRowsEditor
										label="Extras"
										rows={editFields.extras}
										onChange={(rows) => setEditFields({ ...editFields, extras: rows })}
									/>
									<Stack direction="row" spacing={2}>
										<Button
											variant="contained"
											color="primary"
											onClick={handleSaveMeal}
										>
											Save
										</Button>
										<Button
											variant="outlined"
											color="secondary"
											onClick={() => handleDeleteMeal(meal.id)}
										>
											Delete
										</Button>
									</Stack>
								</Stack>
							</MuiListItem>
						</List>
					</Collapse>
				</Box>

				<IconButton
					color="primary"
					onClick={() =>
						setExpandedMealId(expandedMealId === meal.id ? null : meal.id)
					}
				>
					<EditIcon />
				</IconButton>
			</ListItem>
		</>
	);
};

export default MealItem;
```

Note: this drops the pre-existing `editingMeal`/`setEditingMeal` state from the original file — it was dead code (set but never read anywhere in the render), so removing it changes no behavior.

- [ ] **Step 2: Confirm the app builds**

Run: `npm run build 2>&1 | tail -20`

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MealItem.jsx
git commit -m "feat: replace Meal Library edit-view ingredient fields with row editors"
```

---

### Task 5: `MealPlan.jsx` — display ingredient quantities

**Files:**
- Modify: `src/components/MealPlan.jsx`

**Interfaces:**
- Consumes: `formatIngredientRows` from Task 1 (`../utils/formatIngredientRows`).

No new test file — `MealPlan.jsx` has no unit tests today, verified manually in Task 7.

- [ ] **Step 1: Replace the full contents of `src/components/MealPlan.jsx`**

```jsx
import React from 'react';
import {
  List,
  ListItem,
  ListItemText,
  Button,
  Select,
  MenuItem,
  InputLabel,
  FormControl,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import { addMealItems } from '../services/groceryService';
import { formatIngredientRows } from '../utils/formatIngredientRows';

const MealPlan = ({ meals, weekMeals, setWeekMeals }) => {
  const [numOfMeals, setNumOfMeals] = React.useState(5);

  const handleRegenerate = (mealToReplace) => {
    const currentIds = weekMeals.map((m) => m.id);
    const availableMeals = meals.filter((m) => !currentIds.includes(m.id));

    if (availableMeals.length === 0) {
      alert('No more unique meals available to swap in!');
      return;
    }

    const newMeal =
      availableMeals[Math.floor(Math.random() * availableMeals.length)];

    setWeekMeals((prev) =>
      prev.map((m) => (m.id === mealToReplace.id ? newMeal : m))
    );
  };

  const handleGenerateWeek = () => {
    if (meals.length < numOfMeals) {
      alert(
        `Not enough meals to generate ${numOfMeals}! Please change the selection below.`
      );
      return;
    }
    const shuffled = [...meals].sort(() => 0.5 - Math.random());
    setWeekMeals(shuffled.slice(0, numOfMeals));
  };

  const handleChange = (e) => {
    setNumOfMeals(e.target.value);
  };

  const handleAddToGrocery = async () => {
    if (weekMeals.length === 0) return;
    try {
      await addMealItems(weekMeals);
      alert('Week\'s meals added to Grocery List!');
    } catch (e) {
      console.error(e);
      alert('Failed to add meals to Grocery List.');
    }
  };

  return (
    <div>
      <List>
        {weekMeals.map((meal) => (
          <ListItem key={meal.id} divider>
            <ListItemText
              primary={meal.name}
              secondary={`Protein: ${formatIngredientRows(meal.protein)} | Vegetable: ${formatIngredientRows(meal.vegetable)} | Carb: ${formatIngredientRows(meal.carb)} | Extras: ${formatIngredientRows(meal.extras)}`}
            />
            <Button
              variant="contained"
              color="primary"
              startIcon={<RefreshIcon />}
              onClick={() => handleRegenerate(meal)}
            >
              Regenerate
            </Button>
          </ListItem>
        ))}
      </List>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '32px',
          flexWrap: 'wrap',
        }}
      >
        <Button
          variant="outlined"
          startIcon={<AutorenewIcon />}
          onClick={handleGenerateWeek}
        >
          Generate Week
        </Button>
        <FormControl sx={{ minWidth: 120 }}>
          <InputLabel id="demo-simple-select-label"># of meals</InputLabel>
          <Select
            labelId="demo-simple-select-label"
            id="demo-simple-select"
            value={numOfMeals}
            label="# of meals"
            onChange={handleChange}
          >
            {[...Array(10).keys()].map((num) => (
              <MenuItem key={num + 1} value={num + 1}>
                {num + 1}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="outlined"
          color="success"
          startIcon={<ShoppingCartIcon />}
          onClick={handleAddToGrocery}
          disabled={weekMeals.length === 0}
        >
          Add to Grocery List
        </Button>
      </div>
    </div>
  );
};

export default MealPlan;
```

- [ ] **Step 2: Confirm the app builds**

Run: `npm run build 2>&1 | tail -20`

Expected: build completes with no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/MealPlan.jsx
git commit -m "feat: show per-ingredient quantity in Weekly Plan display"
```

---

### Task 6: Migration script for existing meals

**Files:**
- Create: `scripts/migrate-meal-ingredients.mjs`

**Interfaces:**
- Standalone script, no exports consumed by other code.

- [ ] **Step 1: Create the script**

Create `scripts/migrate-meal-ingredients.mjs`:

```javascript
#!/usr/bin/env node
// One-time migration: converts legacy comma-delimited ingredient strings on
// meal documents into { name, qty: 1 } row arrays. Safe to re-run — any
// field that is already an array is left untouched.
//
// Usage: run manually with your Firebase env vars exported in the shell
// (the same six FIREBASE_* vars webpack.config.js expects for `npm run build`):
//   FIREBASE_API_KEY=... FIREBASE_AUTH_DOMAIN=... FIREBASE_PROJECT_ID=... \
//   FIREBASE_STORAGE_BUCKET=... FIREBASE_MESSAGING_SENDER_ID=... FIREBASE_APP_ID=... \
//   node scripts/migrate-meal-ingredients.mjs

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, writeBatch } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
};

const REQUIRED_ENV_VARS = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID',
];

const CATEGORY_FIELDS = ['protein', 'vegetable', 'carb', 'extras'];
const COLLECTION = 'meals';

function toRows(value) {
  if (!value || !value.trim()) return [];
  return value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ name, qty: 1 }));
}

async function main() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`Missing required env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snapshot = await getDocs(collection(db, COLLECTION));
  const batch = writeBatch(db);
  let changedCount = 0;

  snapshot.forEach((mealDoc) => {
    const data = mealDoc.data();
    const updates = {};
    let changed = false;

    CATEGORY_FIELDS.forEach((field) => {
      if (typeof data[field] === 'string') {
        updates[field] = toRows(data[field]);
        changed = true;
      }
    });

    if (changed) {
      batch.update(doc(db, COLLECTION, mealDoc.id), updates);
      changedCount += 1;
      console.log(`Will migrate meal "${data.name || mealDoc.id}":`, updates);
    }
  });

  if (changedCount === 0) {
    console.log('No meals needed migration. All ingredient fields are already arrays.');
    return;
  }

  await batch.commit();
  console.log(`Migrated ${changedCount} meal document(s).`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Confirm the script has no syntax errors**

Run: `node --check scripts/migrate-meal-ingredients.mjs && echo "syntax OK"`

Expected: `syntax OK`.

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-meal-ingredients.mjs
git commit -m "feat: add one-time migration script for legacy meal ingredient strings"
```

Do not run this script against production Firestore as part of this task — running it is a separate, manual step the project owner performs after reviewing it (see Task 7, Step 8).

---

### Task 7: Manual verification

**Files:**
- None (verification only, no code changes)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all test files pass, including the two new files from Task 1 and the fully-updated `groceryService.test.js` from Task 2.

- [ ] **Step 2: Start the app**

Run: `npm start`

- [ ] **Step 3: Verify meal creation with ingredient rows**

Meal Library tab: add a new meal with 2 protein rows (e.g. "chicken" qty 2, "rice" qty 1). Confirm both rows render with working `-`/qty/`+` steppers (`-` disabled at 1), and an "Add ingredient" control that adds another blank row.

- [ ] **Step 4: Verify meal editing**

Click the edit icon on the meal you just created. Confirm the existing rows are pre-populated. Remove one row and save. Refresh the page and confirm the removal persisted.

- [ ] **Step 5: Verify Weekly Plan display**

Weekly Plan tab: generate a week that includes the meal from Step 3/4. Confirm its secondary text shows quantities correctly, e.g. `chicken x2, rice` (no `x1` shown for qty-1 rows).

- [ ] **Step 6: Verify Grocery List quantity carries over**

Click "Add to Grocery List" from Weekly Plan. Switch to the Grocery List tab and confirm "chicken" appears with count 2.

- [ ] **Step 7: Verify summing across meals**

Add a second meal to the week that also needs "chicken" (a different qty, e.g. 1). Click "Add to Grocery List" again. Confirm "chicken"'s count increased by the second meal's quantity (summed, not overwritten or ignored).

- [ ] **Step 8: Verify idempotent re-sync**

Click "Add to Grocery List" again without changing the week. Confirm "chicken"'s count does not increase further.

- [ ] **Step 9: Review and run the migration script (project owner only, optional/deferred)**

If you have existing meals from before this change (still string-format), review `scripts/migrate-meal-ingredients.mjs`, then run it yourself with your Firebase env vars exported, ideally against a test project or backup first. Confirm string-format meals convert to `{name, qty:1}` rows and already-migrated meals are left untouched (safe to re-run).

- [ ] **Step 10: No commit for this task**

This task is verification only; nothing to stage or commit. If any step fails, fix the relevant file from Tasks 1–6 and re-run this task's steps from the top.

## Verification

1. All seven tasks' steps above pass, in order.
2. `git log --oneline -6` shows six feature commits from Tasks 1–6 (Task 7 makes no commit).
3. `npm test` passes in full.
4. `npm run build` succeeds with no errors.
