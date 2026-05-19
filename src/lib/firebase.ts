import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const value = (input: string | undefined) => input?.trim() || undefined;

const projectId = value(import.meta.env.VITE_FIREBASE_PROJECT_ID) ?? "token-economy-b08ac";

const firebaseConfig = {
  apiKey: value(import.meta.env.VITE_FIREBASE_API_KEY),
  authDomain: value(import.meta.env.VITE_FIREBASE_AUTH_DOMAIN) ?? `${projectId}.firebaseapp.com`,
  projectId,
  storageBucket: value(import.meta.env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: value(import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: value(import.meta.env.VITE_FIREBASE_APP_ID),
  measurementId: value(import.meta.env.VITE_FIREBASE_MEASUREMENT_ID),
};

export const missingFirebaseConfig = [
  ["VITE_FIREBASE_API_KEY", firebaseConfig.apiKey],
  ["VITE_FIREBASE_PROJECT_ID", firebaseConfig.projectId],
  ["VITE_FIREBASE_APP_ID", firebaseConfig.appId],
].flatMap(([key, configured]) => (configured ? [] : [key]));

export const hasFirebaseConfig = missingFirebaseConfig.length === 0;

export function getFirebase(): {
  app: FirebaseApp;
  db: ReturnType<typeof getFirestore>;
} {
  if (!hasFirebaseConfig) {
    throw new Error(`Missing Firebase config: ${missingFirebaseConfig.join(", ")}`);
  }

  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const db = getFirestore(app);
  return { app, db };
}
