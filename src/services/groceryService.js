const STORAGE_KEY = 'groceryList';

export function getList() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function saveList(map) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

function normalizeKey(text) {
  return text.toLowerCase().trim();
}

export function addMealItems(weekMeals) {
  const list = getList();
  weekMeals.forEach((meal) => {
    [
      { text: meal.protein, mealName: meal.name },
      { text: meal.vegetable, mealName: meal.name },
      { text: meal.carb, mealName: meal.name },
      { text: meal.extras, mealName: meal.name },
    ].forEach(({ text, mealName }) => {
      if (!text || !text.trim()) return;
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
  return list;
}

export function addStapleItems(staples) {
  const list = getList();
  staples.forEach((staple) => {
    if (!staple.name || !staple.name.trim()) return;
    const key = normalizeKey(staple.name);
    if (!list[key]) {
      list[key] = { displayText: staple.name.trim(), count: 0, meals: [], checked: false };
    }
  });
  saveList(list);
  return list;
}

export function addManualItem(text) {
  if (!text || !text.trim()) return getList();
  const list = getList();
  const key = normalizeKey(text);
  if (!list[key]) {
    list[key] = { displayText: text.trim(), count: 0, meals: [], checked: false };
  }
  saveList(list);
  return list;
}

export function toggleItem(key) {
  const list = getList();
  if (list[key]) {
    list[key].checked = !list[key].checked;
    saveList(list);
  }
  return list;
}

export function clearList() {
  localStorage.removeItem(STORAGE_KEY);
  return {};
}
