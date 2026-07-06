import { db } from '../firebase';
import { collection, getDocs, setDoc, updateDoc, doc, writeBatch } from 'firebase/firestore';

const COLLECTION = 'groceryList';

function normalizeKey(text) {
  return text.toLowerCase().trim();
}

export async function getList() {
  try {
    const querySnapshot = await getDocs(collection(db, COLLECTION));
    const list = {};
    querySnapshot.forEach((document) => {
      list[document.id] = document.data();
    });
    Object.values(list).forEach((item) => {
      item.count = Math.max(1, item.count || 1);
    });
    return list;
  } catch {
    return {};
  }
}

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

export async function addManualItem(text) {
  if (!text || !text.trim()) return {};
  const list = await getList();
  const key = normalizeKey(text);
  if (!list[key]) {
    list[key] = { displayText: text.trim(), count: 1, meals: [], checked: false };
    await setDoc(doc(db, COLLECTION, key), list[key]);
  }
  return list;
}

export async function toggleItem(key) {
  const list = await getList();
  if (list[key]) {
    list[key].checked = !list[key].checked;
    await updateDoc(doc(db, COLLECTION, key), { checked: list[key].checked });
  }
  return list;
}

export async function updateQuantity(key, quantity) {
  const list = await getList();
  if (list[key]) {
    const safeQuantity = Math.max(1, quantity);
    list[key].count = safeQuantity;
    await updateDoc(doc(db, COLLECTION, key), { count: safeQuantity });
  }
  return list;
}

export async function clearList() {
  const querySnapshot = await getDocs(collection(db, COLLECTION));
  const batch = writeBatch(db);
  querySnapshot.forEach((document) => {
    batch.delete(doc(db, COLLECTION, document.id));
  });
  await batch.commit();
  return {};
}
