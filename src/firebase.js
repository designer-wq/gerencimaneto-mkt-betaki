import { initializeApp } from 'firebase/app'
import { initializeFirestore } from 'firebase/firestore'
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
const defaultCfg = {
  apiKey: "AIzaSyDLyfUo2DJYstogALIZbCz2qEg5IMC53gM",
  authDomain: "mkt-betaki.firebaseapp.com",
  projectId: "mkt-betaki",
  storageBucket: "mkt-betaki.firebasestorage.app",
  messagingSenderId: "992627837568",
  appId: "1:992627837568:web:48019ba22070fd9af03465",
}
const hasEnv = !!(envCfg.apiKey && envCfg.authDomain && envCfg.projectId && envCfg.appId)
const firebaseConfig = runtimeCfg || (hasEnv ? envCfg : defaultCfg)

const enabled = !!(firebaseConfig && firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)
let app = null
if (enabled) {
  try { app = initializeApp(firebaseConfig) } catch (e) { try { app = initializeApp(defaultCfg) } catch {} }
}
export const db = app ? initializeFirestore(app, { experimentalAutoDetectLongPolling: true }) : null
export const auth = app ? getAuth(app) : null
if (auth) {
  try { setPersistence(auth, browserSessionPersistence).catch(()=>{}) } catch {}
}
export const isFirebaseEnabled = !!app
export const firebaseApp = app
