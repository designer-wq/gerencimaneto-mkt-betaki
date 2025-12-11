import { initializeApp } from 'firebase/app'
import { getFirestore } from 'firebase/firestore'
import { getAuth, setPersistence, browserSessionPersistence } from 'firebase/auth'

const envCfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const runtimeCfg = (typeof window !== 'undefined' && window.__FIREBASE_CONFIG__) || null
const firebaseConfig = runtimeCfg || envCfg

const enabled = !!(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)
const app = enabled ? initializeApp(firebaseConfig) : null
export const db = app ? getFirestore(app) : null
export const auth = app ? getAuth(app) : null
if (auth) {
  try { setPersistence(auth, browserSessionPersistence).catch(()=>{}) } catch {}
}
export const isFirebaseEnabled = !!app
export const firebaseApp = app
