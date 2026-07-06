# Structured Ingredient Rows with Quantity

**Date:** 2026-07-05

## Context

Meal ingredients (`protein`, `vegetable`, `carb`, `extras`) are currently stored and edited as a single comma-delimited string per category (e.g. `"chicken, rice"`), parsed into individual grocery items only at "Add to Grocery List" time (`src/services/groceryService.js`'s `addMealItems`). There is no way to express how much of an ingredient a meal needs — every meal-sourced grocery item is created with a flat `count: 1`, and the user must manually adjust quantity afterward in the Grocery List tab.

This is the second of two related features (see [[2026-07-05-staples-quantity-design]] for the first, the Grocery Staples quantity stepper, already speced separately). This spec covers adding a quantity to each ingredient within a meal, surfaced in both the Meal Library tab (where meals are created/edited) and the Weekly Plan tab (which displays the same meal data read-only aside from regeneration).

## Scope

- Change the meal ingredient data model from strings to structured `{ name, qty }` rows.
- Add a reusable row-editing UI (add/remove/quantity-stepper) used in both meal creation and meal editing.
- Update the Weekly Plan display to show per-ingredient quantities.
- Update `addMealItems` to carry ingredient quantities into the Grocery List, summed across meals that share an ingredient.
- Provide a one-time migration path for existing meals stored in the old string format.

Out of scope: any change to Grocery Staples (already speced separately) or the Grocery List tab itself.

## Data Model

Each of a meal's four ingredient fields (`protein`, `vegetable`, `carb`, `extras`) changes from a string to an array of row objects: `{ name: string, qty: number }`. `qty` has a minimum of `1`, enforced the same way `groceryService.updateQuantity` and the Staples quantity stepper enforce it (`Math.max(1, qty)`). A category with no ingredients is stored as `[]`, never `null`/`undefined`.

`src/services/firebaseService.js` (`getAllMeals`, `addMeal`, `updateMeal`, `deleteMeal`) requires no changes — it already passes meal data through opaquely without inspecting field shapes.

## Migration for Existing Meals

Existing meal documents in Firestore have `protein`/`vegetable`/`carb`/`extras` as comma-delimited strings. This is handled by a one-time, manually-run script, **not** a lazy on-read conversion:

- New file: `scripts/migrate-meal-ingredients.mjs`.
- Connects using the same client-SDK pattern as `src/firebase.js` (`initializeApp`/`getFirestore` from `process.env.FIREBASE_*`) — no new dependency (e.g. no `dotenv`), since `webpack.config.js` already requires those six env vars to be pre-exported in the shell for `npm run build`, and this script relies on the same precondition.
- Reads every document in the `meals` collection. For each of the four fields that is still a `string` (not already an array), splits it the same way `groceryService.addMealItems` currently does (comma-split, trim, filter blanks) and rewrites it as `[{ name, qty: 1 }, ...]`.
- Fields already in array form (already migrated, or newly created post-rollout) are left untouched, so the script is safe to re-run.
- This script is run manually by the project owner against the live Firestore project after reviewing it — it is not executed automatically as part of implementing this spec, since it requires live Firebase credentials and mutates production data directly.

## Shared Component: `IngredientRowsEditor`

New file: `src/components/IngredientRowsEditor.jsx`. Used identically by both `MealForm.jsx` (creating a meal) and `MealItem.jsx` (editing one) to avoid duplicating row add/remove/quantity-stepper logic in two places.

**Props:** `label` (string, e.g. `"Protein Option"`), `rows` (array of `{ name, qty }`), `onChange(newRows)`.

**Renders:** one row per ingredient — a name `TextField`, a `-`/qty/`+` stepper (same `IconButton`+`RemoveIcon`/`AddIcon` pattern used in `GroceryList.jsx` and the Staples quantity stepper, `-` disabled at `qty === 1`), and a remove `IconButton`. Below the rows, an "Add ingredient" affordance appends a new `{ name: '', qty: 1 }` row. Rows with a blank name are simply excluded when the parent saves (same "skip blank" behavior `addMealItems` already applies to blank fields today).

## `MealForm.jsx` / `MealItem.jsx` Changes

Each of the four ingredient sections (Protein, Vegetable, Carb, Extras) changes from one `TextField` to one `IngredientRowsEditor` bound to that category's row array.

- `MealForm.jsx`: `newMeal` state's four fields become arrays (initial value `[]` each) instead of empty strings. `handleAddMeal` filters out blank-name rows per category and saves the arrays directly — no more `.trim()`-on-a-string step.
- `MealItem.jsx`: `editFields` state mirrors the meal's existing row arrays instead of strings. `handleSaveMeal` saves the arrays directly. The read-only (non-editing) summary line (`Protein: ${meal.protein} | ...`) is reformatted the same way as the Weekly Plan display below, for consistency between the two views.

## `MealPlan.jsx` Display Changes

The per-meal secondary text changes from string interpolation (`Protein: ${meal.protein} | Vegetable: ${meal.vegetable} | ...`) to rendering each category's rows joined by `, `, with `x{qty}` appended only when `qty > 1` — e.g. a protein array `[{name:'chicken', qty:2}, {name:'ground beef', qty:1}]` renders as `chicken x2, ground beef`. This mirrors the pattern already used in `GroceryList.jsx`'s `formatLabel`, which only calls out non-default detail (there, the meals list; here, a non-trivial quantity) rather than always showing every field.

## `groceryService.js` — `addMealItems` Changes

Replaces the current comma-split loop with direct iteration over each category's row array:

```
weekMeals.forEach((meal) => {
  [meal.protein, meal.vegetable, meal.carb, meal.extras].forEach((rows) => {
    (rows || []).forEach(({ name, qty }) => {
      if (!name || !name.trim()) return;
      const key = normalizeKey(name);
      const safeQty = Math.max(1, qty || 1);
      const alreadyContributed = list[key] && list[key].meals.includes(meal.name);
      if (list[key]) {
        if (!alreadyContributed) {
          list[key].count += safeQty;
          list[key].meals.push(meal.name);
        }
      } else {
        list[key] = { displayText: name.trim(), count: safeQty, meals: [meal.name], checked: false };
      }
    });
  });
});
```

Key points, both already decided:

- **Summed quantity across meals:** per the "Sum to 3" decision, when two different meals contribute the same ingredient, their quantities add together in the Grocery List's `count`.
- **Idempotent re-sync:** the existing per-meal-per-key guard (`list[key].meals.includes(meal.name)`) — which today only prevents duplicate meal-name entries — is reused to also gate the quantity addition. Re-running `addMealItems` for a week that hasn't changed does not add the same quantity again, matching today's re-sync behavior (see the existing test `"re-syncing the same meal twice does not duplicate meal names or reset an adjusted count"`). The same guard means a meal that (unusually) lists the same ingredient name twice within itself only contributes its quantity once — the second occurrence is skipped because the meal name is already recorded against that key.

## Testing

- **New `src/components/IngredientRowsEditor.test.jsx`**: following the existing `react-dom/client` + `act` + `querySelector` convention used in `GroceryList.test.jsx` (no new test library). Covers: adding a row, removing a row, the qty stepper incrementing/decrementing, and the `-` button disabling at `qty === 1`.
- **`src/services/groceryService.test.js`**: update all `addMealItems` tests to pass row-array inputs (`{ name, qty }`) instead of comma-delimited strings. Add tests for: a single meal's ingredient quantity carrying into `count`; two meals sharing an ingredient with different quantities summing correctly; re-syncing the same unchanged week not double-counting; a meal listing the same ingredient name twice within itself only contributing once.
- `MealForm.jsx`, `MealItem.jsx`, `MealPlan.jsx` are not unit-tested today and do not gain new test files here — verified manually per existing project convention (no component tests exist for these three files currently).

## Verification

1. `npm test` — all tests pass, including updated/new ones above.
2. Manually: Meal Library tab — add a new meal with 2 protein rows (e.g. "chicken" qty 2, "rice" qty 1); confirm both rows render, the qty stepper works, and `-` disables at 1.
3. Weekly Plan tab — confirm the generated week shows the same meal with `chicken x2, rice` in its secondary text.
4. Click "Add to Grocery List" from Weekly Plan; confirm the Grocery List shows "chicken" with count 2.
5. Add a second meal to the week that also needs "chicken" qty 1; re-add to Grocery List; confirm "chicken" count becomes 3 (summed).
6. Click "Add to Grocery List" again without changing the week; confirm the count does not increase further (idempotent re-sync).
7. Edit an existing meal via Meal Library's edit view, remove an ingredient row, save; confirm it persists after a refresh.
8. Run `scripts/migrate-meal-ingredients.mjs` against a non-production/test Firestore project (or a backup) first if possible, and confirm string-format meals convert to `{name, qty:1}` rows without altering already-migrated meals.
