import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { firebaseEnv, isFirebaseConfigured } from './env';

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) {
    return null;
  }

  return getApps().length > 0 ? getApps()[0] : initializeApp(firebaseEnv);
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();

  return app ? getAuth(app) : null;
}

export function getFirebaseDb() {
  const app = getFirebaseApp();

  return app ? getFirestore(app) : null;
}