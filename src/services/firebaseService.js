import { db } from '../firebase';
import {
	collection,
	getDocs,
	addDoc,
	updateDoc,
	deleteDoc,
	doc,
} from 'firebase/firestore';

const COLLECTION = 'meals';

export async function getAllMeals() {
	const snapshot = await getDocs(collection(db, COLLECTION));
	return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function addMeal(mealData) {
	const docRef = await addDoc(collection(db, COLLECTION), mealData);
	return { id: docRef.id, ...mealData };
}

export async function updateMeal(id, updatedMeal) {
	const { id: _id, ...data } = updatedMeal;
	await updateDoc(doc(db, COLLECTION, id), data);
	return { id, ...data };
}

export async function deleteMeal(id) {
	await deleteDoc(doc(db, COLLECTION, id));
}
