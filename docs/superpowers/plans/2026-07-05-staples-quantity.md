# Staples Quantity Stepper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted quantity to each Grocery Staple, a `-`/count/`+` stepper in the Staples tab UI matching the Grocery List's existing pattern, and make `addStapleItems` carry that quantity into the Grocery List additively.

**Architecture:** `src/services/staplesService.js` gains count-coercion on read and a new `updateStapleQuantity` write function. `src/services/groceryService.js`'s `addStapleItems` changes from "skip if already exists" to "add the staple's count on top of whatever's already there." `src/components/Staples.jsx` gets a stepper UI identical in spirit to `GroceryList.jsx`'s, wired to the new service function with an optimistic local-state update (no refetch), matching the existing `handleToggle` pattern in the same file.

**Tech Stack:** React 19, Material-UI 7, Firebase Firestore (client SDK), Jest + babel-jest with a hand-rolled `firebase/firestore` mock (see `src/services/groceryService.test.js` for the established pattern) — no `firebase-admin`, no test-database, no new dependencies.

## Global Constraints

- A staple document's `count` has a minimum of `1`, enforced via `Math.max(1, count)` — same rule used everywhere else in this codebase (`groceryService.updateQuantity`).
- `getAllStaples()` must coerce a missing or falsy `count` up to `1` on every read (old staples predate this field).
- New staples are created with `count: 1`.
- `addStapleItems` merge behavior: a brand-new grocery item gets `count` = the staple's `count`; an existing grocery item gets `count` += the staple's `count` (additive, never overwritten, never skipped).
- The quantity stepper is only rendered for unchecked staples — checked-off staples stay read-only, exactly like `GroceryList.jsx`'s existing checked/unchecked split.
- `resetAllStaples` (the "Reset for new week" button) is not touched by this plan — it only ever clears `checked`, never `count`.
- No new npm dependencies.

---

### Task 1: `staplesService.js` — persisted quantity (read coercion + write)

**Files:**
- Modify: `src/services/staplesService.js`
- Create: `src/services/staplesService.test.js`

**Interfaces:**
- Produces: `getAllStaples()` now returns objects with a guaranteed numeric `count >= 1`. `addStaple(name)` now returns `{ id, name, checked: false, count: 1 }`. New `updateStapleQuantity(id, count)` (async, no return value) persists a clamped count. These are consumed by Task 2 (`addStapleItems` reads `staple.count`) and Task 3 (`Staples.jsx` calls `updateStapleQuantity`).

- [ ] **Step 1: Write the failing tests**

Create `src/services/staplesService.test.js`:

```javascript
import {
  getAllStaples,
  addStaple,
  updateStapleQuantity,
} from './staplesService';

// Must use var so the jest.mock hoisting can reference it
var fakeStore = {};
var nextId = 1;

jest.mock('firebase/firestore', () => ({
  collection: jest.fn(),
  getDocs: jest.fn(async () => {
    const entries = Object.entries(fakeStore);
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
    const id = `staple-${nextId++}`;
    fakeStore[id] = { ...data };
    return { id };
  }),
  updateDoc: jest.fn(async (ref, fields) => {
    Object.assign(fakeStore[ref._id], fields);
  }),
  deleteDoc: jest.fn(async (ref) => {
    delete fakeStore[ref._id];
  }),
  doc: jest.fn((db, col, id) => ({ _id: id })),
  writeBatch: jest.fn(() => {
    const ops = [];
    return {
      update: jest.fn((ref, fields) => ops.push({ ref, fields })),
      commit: jest.fn(async () => {
        ops.forEach(({ ref, fields }) => Object.assign(fakeStore[ref._id], fields));
      }),
    };
  }),
}));

jest.mock('../firebase', () => ({ db: {} }));
jest.mock('firebase/app', () => ({ initializeApp: jest.fn() }));

beforeEach(() => {
  Object.keys(fakeStore).forEach((k) => delete fakeStore[k]);
  nextId = 1;
  jest.clearAllMocks();
});

describe('getAllStaples', () => {
  it('defaults a missing count to 1', async () => {
    fakeStore['s1'] = { name: 'Eggs', checked: false };
    const staples = await getAllStaples();
    expect(staples).toEqual([{ id: 's1', name: 'Eggs', checked: false, count: 1 }]);
  });

  it('leaves a valid count untouched', async () => {
    fakeStore['s1'] = { name: 'Eggs', checked: false, count: 3 };
    const staples = await getAllStaples();
    expect(staples[0].count).toBe(3);
  });

  it('coerces a zero count up to 1', async () => {
    fakeStore['s1'] = { name: 'Eggs', checked: false, count: 0 };
    const staples = await getAllStaples();
    expect(staples[0].count).toBe(1);
  });
});

describe('addStaple', () => {
  it('creates a staple with count 1', async () => {
    const staple = await addStaple('Eggs');
    expect(staple.count).toBe(1);
    expect(fakeStore[staple.id].count).toBe(1);
  });
});

describe('updateStapleQuantity', () => {
  it('persists a valid count', async () => {
    const staple = await addStaple('Eggs');
    await updateStapleQuantity(staple.id, 5);
    expect(fakeStore[staple.id].count).toBe(5);
  });

  it('clamps a value below 1 up to 1', async () => {
    const staple = await addStaple('Eggs');
    await updateStapleQuantity(staple.id, 0);
    expect(fakeStore[staple.id].count).toBe(1);
    await updateStapleQuantity(staple.id, -5);
    expect(fakeStore[staple.id].count).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest src/services/staplesService.test.js`

Expected: FAIL — `updateStapleQuantity` is not exported (`TypeError: updateStapleQuantity is not a function` or similar), and the `count`-related assertions in `getAllStaples`/`addStaple` fail since the current implementation doesn't set or coerce `count`.

- [ ] **Step 3: Implement the changes**

Replace the full contents of `src/services/staplesService.js`:

```javascript
import { db } from '../firebase';
import {
	collection,
	getDocs,
	addDoc,
	updateDoc,
	deleteDoc,
	doc,
	writeBatch,
} from 'firebase/firestore';

const COLLECTION = 'staples';

export async function getAllStaples() {
	const snapshot = await getDocs(collection(db, COLLECTION));
	return snapshot.docs.map((d) => {
		const data = d.data();
		return { id: d.id, ...data, count: Math.max(1, data.count || 1) };
	});
}

export async function addStaple(name) {
	const docRef = await addDoc(collection(db, COLLECTION), { name, checked: false, count: 1 });
	return { id: docRef.id, name, checked: false, count: 1 };
}

export async function toggleStaple(id, checked) {
	await updateDoc(doc(db, COLLECTION, id), { checked });
}

export async function updateStapleQuantity(id, count) {
	const safeCount = Math.max(1, count);
	await updateDoc(doc(db, COLLECTION, id), { count: safeCount });
}

export async function deleteStaple(id) {
	await deleteDoc(doc(db, COLLECTION, id));
}

export async function resetAllStaples(staples) {
	const batch = writeBatch(db);
	staples.forEach((s) => {
		batch.update(doc(db, COLLECTION, s.id), { checked: false });
	});
	await batch.commit();
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest src/services/staplesService.test.js`

Expected: all tests pass, output shows `PASS src/services/staplesService.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/services/staplesService.js src/services/staplesService.test.js
git commit -m "feat: add persisted quantity to staples"
```

---

### Task 2: `groceryService.js` — `addStapleItems` additive merge

**Files:**
- Modify: `src/services/groceryService.js:57-72` (the `addStapleItems` function)
- Modify: `src/services/groceryService.test.js:157-170` (the `addStapleItems` describe block)

**Interfaces:**
- Consumes: staple objects shaped `{ id, name, checked, count }` (per Task 1's `getAllStaples`/`addStaple` — `count` may be absent on old data the tests simulate, in which case it must be treated as `1`).
- Produces: no new exports; `addStapleItems`'s merge behavior change is consumed by `Staples.jsx`'s existing `handleAddToGrocery` call (unchanged in this task — Task 3 doesn't need to change that call site).

- [ ] **Step 1: Write the failing tests**

In `src/services/groceryService.test.js`, replace the existing `describe('addStapleItems', ...)` block (lines 157–170) with:

```javascript
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
    await addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
    await addStapleItems([{ id: '1', name: 'Chicken', checked: false }]);
    const list = await getList();
    expect(list['chicken'].count).toBe(2); // 1 (meal) + 1 (staple default)
    expect(list['chicken'].meals).toEqual(['Tacos']); // unchanged
  });

  it('merges a staple with count > 1 into an existing grocery item', async () => {
    await addMealItems([{ name: 'Tacos', protein: 'Chicken', vegetable: '', carb: '', extras: '' }]);
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
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `npx jest src/services/groceryService.test.js -t addStapleItems`

Expected: FAIL — the "merges into an existing meal entry" and "merges a staple with count > 1" tests fail because the current `addStapleItems` skips staples that already have a matching grocery item (count stays `1` instead of becoming `2`/`4`).

- [ ] **Step 3: Implement the change**

In `src/services/groceryService.js`, replace the `addStapleItems` function:

```javascript
export async function addStapleItems(staples) {
  const list = await getList();
  const batch = writeBatch(db);
  const modifiedKeys = new Set();

  staples.forEach((staple) => {
    if (!staple.name || !staple.name.trim()) return;
    const key = normalizeKey(staple.name);
    const safeCount = Math.max(1, staple.count || 1);
    if (list[key]) {
      list[key].count += safeCount;
    } else {
      list[key] = { displayText: staple.name.trim(), count: safeCount, meals: [], checked: false };
    }
    modifiedKeys.add(key);
  });

  modifiedKeys.forEach((key) => {
    batch.set(doc(db, COLLECTION, key), list[key], { merge: true });
  });

  await batch.commit();
  return list;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `npx jest src/services/groceryService.test.js`

Expected: all tests in the file pass, including the full `addStapleItems` block and every pre-existing test (this change must not break `addMealItems`, `getList`, `updateQuantity`, etc. — run the whole file, not just the `-t` filter, to confirm no regressions).

- [ ] **Step 5: Commit**

```bash
git add src/services/groceryService.js src/services/groceryService.test.js
git commit -m "feat: merge staple quantity additively into the grocery list"
```

---

### Task 3: `Staples.jsx` — quantity stepper UI

**Files:**
- Modify: `src/components/Staples.jsx`

**Interfaces:**
- Consumes: `updateStapleQuantity(id, count)` from Task 1's `staplesService.js`. Staple objects from `getAllStaples()` now always carry a numeric `count >= 1` (Task 1).
- Produces: nothing consumed by later tasks — this is the final UI wiring for this plan.

There is no automated test file for `Staples.jsx` today (only `staplesService.test.js` and `groceryService.test.js` are automated in this feature — see the spec's Testing section). This task is verified manually in Task 4.

- [ ] **Step 1: Replace the full contents of `src/components/Staples.jsx`**

```jsx
import React, { useEffect, useState } from 'react';
import {
	Box,
	Button,
	Checkbox,
	Divider,
	IconButton,
	List,
	ListItem,
	ListItemText,
	Stack,
	Typography,
	TextField,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import DeleteIcon from '@mui/icons-material/Delete';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';
import {
	getAllStaples,
	addStaple,
	toggleStaple,
	deleteStaple,
	resetAllStaples,
	updateStapleQuantity,
} from '../services/staplesService';
import { addStapleItems } from '../services/groceryService';

const Staples = () => {
	const [staples, setStaples] = useState([]);
	const [newName, setNewName] = useState('');

	const fetchStaples = async () => {
		const data = await getAllStaples();
		setStaples(data);
	};

	useEffect(() => {
		fetchStaples();
	}, []);

	const handleAdd = async () => {
		if (!newName.trim()) return;
		await addStaple(newName.trim());
		setNewName('');
		await fetchStaples();
	};

	const handleKeyDown = (e) => {
		if (e.key === 'Enter') handleAdd();
	};

	const handleToggle = async (staple) => {
		await toggleStaple(staple.id, !staple.checked);
		setStaples((prev) =>
			prev.map((s) => (s.id === staple.id ? { ...s, checked: !s.checked } : s))
		);
	};

	const handleDelete = async (id) => {
		await deleteStaple(id);
		setStaples((prev) => prev.filter((s) => s.id !== id));
	};

	const handleReset = async () => {
		await resetAllStaples(staples);
		setStaples((prev) => prev.map((s) => ({ ...s, checked: false })));
	};

	const handleQuantityChange = async (staple, newCount) => {
		if (newCount < 1) return;
		await updateStapleQuantity(staple.id, newCount);
		setStaples((prev) =>
			prev.map((s) => (s.id === staple.id ? { ...s, count: newCount } : s))
		);
	};

	const handleAddToGrocery = async () => {
		try {
			await addStapleItems(staples);
			alert('Staples added to Grocery List!');
		} catch (e) {
			console.error(e);
			alert('Failed to add staples to Grocery List.');
		}
	};

	const unchecked = staples.filter((s) => !s.checked);
	const checked = staples.filter((s) => s.checked);

	return (
		<Box>
			<Stack direction="row" spacing={2} mb={2}>
				<TextField
					label="Add staple item"
					fullWidth
					value={newName}
					onChange={(e) => setNewName(e.target.value)}
					onKeyDown={handleKeyDown}
				/>
				<Button
					variant="contained"
					color="secondary"
					startIcon={<AddIcon />}
					onClick={handleAdd}
				>
					Add
				</Button>
			</Stack>

			<List disablePadding>
				{unchecked.map((staple) => (
					<ListItem
						key={staple.id}
						disableGutters
						secondaryAction={
							<Stack direction="row" spacing={1} alignItems="center">
								<IconButton
									size="small"
									aria-label={`decrease quantity of ${staple.name}`}
									disabled={staple.count <= 1}
									onClick={() => handleQuantityChange(staple, staple.count - 1)}
								>
									<RemoveIcon fontSize="small" />
								</IconButton>
								<Typography variant="body2" sx={{ minWidth: '1.5em', textAlign: 'center' }}>
									{staple.count}
								</Typography>
								<IconButton
									size="small"
									aria-label={`increase quantity of ${staple.name}`}
									onClick={() => handleQuantityChange(staple, staple.count + 1)}
								>
									<AddIcon fontSize="small" />
								</IconButton>
								<IconButton edge="end" onClick={() => handleDelete(staple.id)}>
									<DeleteIcon />
								</IconButton>
							</Stack>
						}
					>
						<Checkbox checked={false} onChange={() => handleToggle(staple)} />
						<ListItemText primary={staple.name} />
					</ListItem>
				))}

				{checked.length > 0 && (
					<>
						<Divider sx={{ my: 1 }} />
						{checked.map((staple) => (
							<ListItem
								key={staple.id}
								disableGutters
								secondaryAction={
									<IconButton edge="end" onClick={() => handleDelete(staple.id)}>
										<DeleteIcon />
									</IconButton>
								}
							>
								<Checkbox checked={true} onChange={() => handleToggle(staple)} />
								<ListItemText
									primary={staple.name}
									sx={{ textDecoration: 'line-through', color: 'text.disabled' }}
								/>
							</ListItem>
						))}
					</>
				)}
			</List>

			{staples.length > 0 && (
				<Box display="flex" justifyContent="space-between" mt={2}>
					<Button
						variant="outlined"
						color="success"
						startIcon={<ShoppingCartIcon />}
						onClick={handleAddToGrocery}
					>
						Add to Grocery List
					</Button>
					<Button variant="outlined" onClick={handleReset}>
						Reset for new week
					</Button>
				</Box>
			)}
		</Box>
	);
};

export default Staples;
```

- [ ] **Step 2: Confirm the app builds**

Run: `npm run build 2>&1 | tail -20`

Expected: build completes with no errors (no missing-import or syntax errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/Staples.jsx
git commit -m "feat: add quantity stepper to Grocery Staples tab"
```

---

### Task 4: Manual verification

**Files:**
- None (verification only, no code changes)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected: all test files pass, including `staplesService.test.js` and the updated `groceryService.test.js`.

- [ ] **Step 2: Start the app**

Run: `npm start`

- [ ] **Step 3: Verify the stepper**

Open the Grocery Staples tab. Confirm every unchecked staple shows a `-`/count/`+` stepper starting at `1` (or its previously-set value), and that `-` is disabled when the count is `1`. Bump one staple's count up to `3`.

- [ ] **Step 4: Verify persistence**

Refresh the page. Confirm the staple you bumped to `3` still shows `3`.

- [ ] **Step 5: Verify the additive merge into the Grocery List**

Click "Add to Grocery List" from the Staples tab. Switch to the Grocery List tab and confirm the staple you set to `3` appears with count `3` (assuming it didn't already exist on the list from a meal — if it did, confirm the count increased by `3` on top of whatever was already there).

- [ ] **Step 6: Verify repeat-add is additive, not a no-op**

Go back to Staples and click "Add to Grocery List" again without changing anything. Switch to Grocery List and confirm that same item's count increased by `3` again (this is the intended "add on top" behavior, not idempotent — see Global Constraints).

- [ ] **Step 7: Verify checked staples stay read-only**

Check off a staple. Confirm it moves below the divider, shows no stepper, and its count is not editable.

- [ ] **Step 8: Verify "Reset for new week" leaves quantity untouched**

Note a checked staple's count, click "Reset for new week", confirm it becomes unchecked again and its count is unchanged.

- [ ] **Step 9: No commit for this task**

This task is verification only; nothing to stage or commit. If any step fails, fix the relevant file from Task 1–3 and re-run this task's steps from the top.

## Verification

1. All four tasks' steps above pass, in order.
2. `git log --oneline -3` shows three feature commits from Tasks 1–3 (Task 4 makes no commit).
3. `npm test` passes in full.
