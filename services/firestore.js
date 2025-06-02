import admin from 'firebase-admin';

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

async function getUserData(userId) {
  try {
    const doc = await db.collection('users').doc(userId).get();
    return doc.exists ? doc.data() : {};
  } catch (error) {
    console.error('Error getting user data:', error);
    return {};
  }
}

async function updateUserData(userId, newData) {
  try {
    await db.collection('users').doc(userId).set(newData, { merge: true });
  } catch (error) {
    console.error('Error updating user data:', error);
  }
}

export default {
  getUserData,
  updateUserData,
};