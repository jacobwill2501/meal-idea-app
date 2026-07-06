# Quantity Stepper for Grocery Staples

**Date:** 2026-07-05

## Context

The Grocery List tab already lets users adjust an item's quantity with a `-` / count / `+` stepper (`src/components/GroceryList.jsx`, backed by `updateQuantity` in `src/services/groceryService.js`). The Grocery Staples tab has no equivalent — staple documents in Firestore have no quantity field at all, and `addStapleItems` always sends new grocery items in with `count: 1`, regardless of how many of a staple the user actually wants (e.g. "Eggs" bought 2 dozen at a time).

This is the first of two follow-up features requested together; the second (adding per-ingredient quantity to Meal Library / Weekly Plan, which requires restructuring meal ingredient fields from comma-delimited strings into structured rows) is out of scope here and will get its own spec.

## Scope

- Add a persisted `count` to each staple.
- Add a quantity stepper to the Grocery Staples tab UI, matching the Grocery List's existing pattern.
- Change `addStapleItems` so a staple's quantity is reflected in the Grocery List, additively merging with any existing entry for that item.

Out of scope: Meal Library / Weekly Plan ingredient quantities (separate spec). Any change to the Grocery List tab itself (already has quantity). `resetAllStaples` ("Reset for new week") is untouched — it only clears `checked` state; a staple's `count` is a stable property of how much the user buys each time and is not reset alongside it.

## Data Model

Staple documents in the `staples` Firestore collection gain a `count` field (number, minimum `1`). Existing staple documents predating this change have no `count` field; they are treated as `count: 1` when read, the same defensive coercion `groceryService.getList()` already applies to old grocery items (`Math.max(1, item.count || 1)`). No migration script is needed — the coercion happens on read, and the first `updateStapleQuantity` call persists an explicit value.

## `src/services/staplesService.js` Changes

- **`getAllStaples()`**: after mapping Firestore docs, coerce each staple's `count` with `Math.max(1, staple.count || 1)` before returning, so callers never see a missing or invalid count.
- **`addStaple(name)`**: new staples are created with `count: 1` in both the Firestore doc and the returned object.
- **New `updateStapleQuantity(id, count)`**: clamps `count` to a minimum of `1` (`Math.max(1, count)`) and persists via `updateDoc(doc(db, COLLECTION, id), { count: safeCount })`, mirroring `groceryService.updateQuantity`'s shape. Returns nothing (callers update local state directly, matching the existing `toggleStaple`/`deleteStaple` pattern in `Staples.jsx`).

## `src/components/Staples.jsx` Changes

Each unchecked staple's `ListItem` gains a quantity stepper between the checkbox/label and the existing delete `IconButton`, using the same building blocks as `GroceryList.jsx`'s stepper (`IconButton` + `RemoveIcon`/`AddIcon` + a centered count `Typography`, disabling the `-` button when `count <= 1`). Clicking `-`/`+` calls `updateStapleQuantity(staple.id, newCount)` then updates local `staples` state (same optimistic-update pattern `handleToggle` already uses — no full refetch).

Checked-off staples remain read-only: no stepper is rendered for them, consistent with how `GroceryList.jsx` only shows its stepper on unchecked items.

## `src/services/groceryService.js` — `addStapleItems` Changes

Current behavior: a staple only creates a new grocery item (`count: 1`) if one doesn't already exist for that key; if it does exist, the staple is silently skipped and the grocery item is left untouched.

New behavior:
- **New grocery item:** created with `count` equal to the staple's `count` (instead of always `1`).
- **Existing grocery item:** the staple's `count` is added on top of the existing grocery item's `count` (the same additive rule `addMealItems` already applies when two meals share an ingredient). E.g. staple "Eggs" with `count: 2` merging into a grocery item that already has `count: 1` (from a meal ingredient) results in `count: 3`.

This changes one existing behavior worth calling out explicitly: today, re-adding staples that already exist on the grocery list is a no-op; after this change, every "Add to Grocery List" click from the Staples tab increases the count of already-present staple items by their staple quantity again. This is intentional per the chosen merge behavior — the Staples tab is expected to be used once per shopping cycle (there's already a "Reset for new week" action), not clicked repeatedly against a stable list.

## Testing

- **`src/services/groceryService.test.js`**: update the existing `addStapleItems` test "does not overwrite an existing meal entry" — its assertion that count stays unchanged (`1`) no longer holds; it becomes additive (staple's default `count: 1` on top of the existing meal-sourced `count: 1` = `2`). Add a test covering a staple with `count > 1` merging into an existing grocery item.
- **New `src/services/staplesService.test.js`**: following the Firestore-mock pattern already established in `groceryService.test.js` (mock `firebase/firestore`'s `addDoc`/`updateDoc`/`getDocs`/`doc`/`collection`), cover:
  - `getAllStaples` defaults a missing `count` to `1` and leaves a valid `count` untouched.
  - `addStaple` creates a staple with `count: 1`.
  - `updateStapleQuantity` persists a valid count and clamps values below `1` up to `1`.

## Verification

1. `npm test` — all tests pass, including the updated/new ones above.
2. Manually: open the Grocery Staples tab, confirm each unchecked staple shows a `-`/count/`+` stepper defaulting to `1`, and that the `-` button disables at `1`.
3. Bump a staple's quantity to `3`, refresh the page, confirm it persisted.
4. Click "Add to Grocery List" from Staples, switch to the Grocery List tab, confirm the staple appears with the matching count.
5. Click "Add to Grocery List" from Staples again without changing anything, confirm the grocery item's count increased by the staple's quantity again (additive merge).
