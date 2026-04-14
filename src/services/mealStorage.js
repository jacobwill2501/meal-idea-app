const STORAGE_KEY = 'meal-idea-app-meals';

function getMeals() {
	return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
}

function saveMeals(meals) {
	localStorage.setItem(STORAGE_KEY, JSON.stringify(meals));
}

export function getAllMeals() {
	return getMeals();
}

export function addMeal(mealData) {
	const meals = getMeals();
	const newMeal = { ...mealData, id: Date.now() };
	meals.push(newMeal);
	saveMeals(meals);
	return newMeal;
}

export function updateMeal(id, updatedMeal) {
	const meals = getMeals();
	const index = meals.findIndex((m) => m.id === id);
	if (index === -1) throw new Error('Meal not found');
	meals[index] = { ...updatedMeal, id };
	saveMeals(meals);
	return meals[index];
}

export function deleteMeal(id) {
	const meals = getMeals();
	saveMeals(meals.filter((m) => m.id !== id));
}
