# Grocery List Tab — Design Spec
**Date:** 2026-04-14

## Context

The meal idea app currently has three tabs: Weekly Plan, Meal Library, and Grocery Staples. Users want a dedicated weekly grocery list that can be populated automatically from the current week's meal plan and/or their staples, with smart deduplication when multiple meals share an ingredient. The list should persist across page refreshes (localStorage) and be cleared manually.

---

## Feature Overview

Add a fourth tab — **Grocery List** — that acts as a consolidated, editable shopping list for the week. Items can come from three sources: the current week's meal plan, the staples list, or manual text input. Duplicate ingredients across meals are merged into a single item showing a count and which meals they came from.

---

## Data Structure

Stored in localStorage under the key `"groceryList"` as a plain object map:

```javascript
{
  "chicken": {
    displayText: "Chicken",
    count: 2,              // number of meal plan entries containing this item
    meals: ["Pasta Night", "Stir Fry"],  // meal names that contributed this item
    checked: false
  },
  "eggs": {
    displayText: "Eggs",
    count: 0,              // 0 = from staples or manual input
    meals: [],
    checked: false
  }
}
```

**Merge rules:**
- Key = `displayText.toLowerCase().trim()`
- Adding a meal item whose key already exists → increment `count`, append meal name to `meals`
- Adding a staples/manual item whose key already exists → no-op (item is already present)
- Blank strings (e.g. empty `extras` field) → skip

**Display format:**
- `count <= 1`: show `displayText` only
- `count > 1`: show `displayText x{count} (Meal1, Meal2)`

---

## UI Layout

### Tab Bar
`Week | Library | Staples | Grocery List`

### Grocery List Tab (top to bottom)
1. Text input + "Add" button (Enter key also submits) — manually add an item
2. Three action buttons: **Add from Meal Plan** | **Add from Staples** | **Clear List**
3. Checklist — unchecked items first, horizontal divider, then checked items with strikethrough (matches Staples tab pattern)

### Buttons in Other Tabs
- **Weekly Plan tab** — "Add to Grocery List" button — adds all `protein`, `vegetable`, `carb`, `extras` fields from each meal in the current week plan
- **Meal Library tab** — "Add to Grocery List" button — adds from the current week plan's meals (same behavior as Weekly Plan button, convenient shortcut from the library view)
- **Staples tab** — "Add to Grocery List" button — adds all staple item names (all items, regardless of checked state)

---

## Component Architecture

### New Files
- `src/components/GroceryList.jsx` — new tab component (text input, action buttons, checklist UI)
- `src/services/groceryService.js` — all localStorage logic:
  - `getList()` — read and parse from localStorage
  - `saveList(map)` — serialize and write to localStorage
  - `addMealItems(weekMeals)` — iterate meals, extract 4 fields, merge into map
  - `addStapleItems(staples)` — iterate staples array, merge names into map
  - `addManualItem(text)` — add a single manual entry
  - `toggleItem(key)` — flip `checked` boolean
  - `clearList()` — remove key from localStorage

### Modified Files
- `src/App.jsx`
  - Add 4th tab (`view === 'grocery'`)
  - Render `<GroceryList weekMeals={weekMeals} />` — `weekMeals` is already in App state
  - Pass `weekMeals` prop to `<MealList>` (App already holds this in state)

- `src/components/MealPlan.jsx`
  - Add "Add to Grocery List" button that calls `groceryService.addMealItems(weekMeals)`

- `src/components/MealList.jsx`
  - Accept `weekMeals` prop (passed from App)
  - Add "Add to Grocery List" button that calls `groceryService.addMealItems(weekMeals)`

- `src/components/Staples.jsx`
  - Add "Add to Grocery List" button that calls `groceryService.addStapleItems(staples)` using its own local `staples` state

- `src/components/GroceryList.jsx` ("Add from Staples" button)
  - Calls `getAllStaples()` from `staplesService.js` directly when clicked — no need to lift staples state to App

---

## Deduplication Logic

```
function normalizeKey(text) {
  return text.toLowerCase().trim();
}

function addMealItems(weekMeals) {
  const list = getList();
  weekMeals.forEach(meal => {
    const fields = [
      { text: meal.protein, mealName: meal.name },
      { text: meal.vegetable, mealName: meal.name },
      { text: meal.carb, mealName: meal.name },
      { text: meal.extras, mealName: meal.name },
    ];
    fields.forEach(({ text, mealName }) => {
      if (!text || !text.trim()) return; // skip blanks
      const key = normalizeKey(text);
      if (list[key]) {
        list[key].count += 1;
        list[key].meals.push(mealName);
      } else {
        list[key] = { displayText: text.trim(), count: 1, meals: [mealName], checked: false };
      }
    });
  });
  saveList(list);
}
```

---

## Verification

1. Generate a week plan with 2+ meals that share an ingredient (e.g., both have "Chicken" as protein)
2. Click "Add to Grocery List" from the Weekly Plan tab → navigate to Grocery List tab → confirm "Chicken" appears once as `Chicken x2 (Meal1, Meal2)`
3. Click "Add from Staples" → confirm all staple names appear; if a staple name matches an existing item, it does not duplicate
4. Manually type an item and press Enter → confirm it appears in the list
5. Refresh the page → confirm the list is still populated (localStorage persistence)
6. Check off an item → confirm it moves below the divider with strikethrough
7. Click "Clear List" → confirm list empties and localStorage key is removed
8. Confirm "Add to Grocery List" button works from both the Weekly Plan tab and the Meal Library tab
