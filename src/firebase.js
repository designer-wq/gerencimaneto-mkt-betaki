import { initializeApp } from 'firebase/app'
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore'
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth'

const firebaseConfig = {
  apiKey: "AIzaSyDLyfUo2DJYstogALIZbCz2qEg5IMC53gM",
  authDomain: "mkt-betaki.firebaseapp.com",
  projectId: "mkt-betaki",
  storageBucket: "mkt-betaki.firebasestorage.app",
  messagingSenderId: "992627837568",
  appId: "1:992627837568:web:48019ba22070fd9af03465"
}

let app = null
try { app = initializeApp(firebaseConfig) } catch {}
export const db = app ? initializeFirestore(app, { localCache: memoryLocalCache(), experimentalForceLongPolling: true, useFetchStreams: false }) : null
export const auth = app ? getAuth(app) : null
if (auth) { try { setPersistence(auth, browserLocalPersistence).catch(()=>{}) } catch {} }
export const isFirebaseEnabled = !!app
export const firebaseApp = app
