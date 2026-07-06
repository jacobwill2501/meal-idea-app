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
