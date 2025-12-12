const functions = require('firebase-functions')
const admin = require('firebase-admin')
admin.initializeApp()

async function getEmailByUsername(username) {
  const db = admin.firestore()
  const docRef = db.collection('usuarios').doc(username)
  const snap = await docRef.get()
  const data = snap.exists ? snap.data() : null
  return data?.email || `${username}@betaki.bet.br`
}

exports.createUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('failed-precondition', 'auth required')
  const username = String(data?.username||'').trim()
  const password = String(data?.password||'').trim()
  const email = String(data?.email||`${username}@betaki.bet.br`).trim()
  const profile = data?.profile || {}
  if (!username || !password) throw new functions.https.HttpsError('invalid-argument', 'username and password required')
  let userRecord
  try {
    userRecord = await admin.auth().getUserByEmail(email)
  } catch (e) {}
  if (!userRecord) {
    userRecord = await admin.auth().createUser({ email, password })
  }
  const db = admin.firestore()
  await db.collection('usuarios').doc(username).set({ username, email, ...profile }, { merge: true })
  return { ok: true, uid: userRecord.uid, email }
})

exports.updateUserPassword = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('failed-precondition', 'auth required')
  const username = String(data?.username||'').trim()
  const emailInput = data?.email
  const newPassword = String(data?.password||'').trim()
  if (!username || !newPassword) throw new functions.https.HttpsError('invalid-argument', 'username and password required')
  const email = String(emailInput||await getEmailByUsername(username))
  let user
  try {
    user = await admin.auth().getUserByEmail(email)
  } catch (e) {
    throw new functions.https.HttpsError('not-found', 'user not found')
  }
  await admin.auth().updateUser(user.uid, { password: newPassword })
  return { ok: true }
})

exports.deleteUser = functions.https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('failed-precondition', 'auth required')
  const username = String(data?.username||'').trim()
  if (!username) throw new functions.https.HttpsError('invalid-argument', 'username required')
  const email = await getEmailByUsername(username)
  try {
    const user = await admin.auth().getUserByEmail(email)
    await admin.auth().deleteUser(user.uid)
  } catch (e) {}
  const db = admin.firestore()
  await db.collection('usuarios').doc(username).delete()
  return { ok: true }
})
