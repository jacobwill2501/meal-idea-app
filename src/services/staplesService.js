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
