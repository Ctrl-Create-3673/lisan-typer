// Google sign-in and saved texts (Firebase Auth + Firestore).
// Off until docs/firebase-config.js holds your Firebase web app config.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';
export const enabled = Boolean(firebaseConfig);

let ready;
function init() {
  ready ??= (async () => {
    const [{ initializeApp }, fa, fs] = await Promise.all([
      import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = initializeApp(firebaseConfig);
    return { fa, fs, auth: fa.getAuth(app), db: fs.getFirestore(app) };
  })();
  return ready;
}

export async function onUser(callback) {
  const { fa, auth } = await init();
  fa.onAuthStateChanged(auth, callback);
}

export async function signIn() {
  const { fa, auth } = await init();
  await fa.signInWithPopup(auth, new fa.GoogleAuthProvider());
}

export async function signOut() {
  const { fa, auth } = await init();
  await fa.signOut(auth);
}

// Each user's texts live under users/{uid}/texts; the Firestore rules in the README keep them private.
async function texts() {
  const { fs, auth, db } = await init();
  if (!auth.currentUser) throw new Error('Sign in with Google first');
  return { fs, col: fs.collection(db, 'users', auth.currentUser.uid, 'texts') };
}

export async function saveText(id, title, text) {
  const { fs, col } = await texts();
  const data = { title, text, updatedAt: fs.serverTimestamp() };
  if (id) { await fs.setDoc(fs.doc(col, id), data); return id; }
  return (await fs.addDoc(col, data)).id;
}

export async function listTexts() {
  const { fs, col } = await texts();
  const snap = await fs.getDocs(fs.query(col, fs.orderBy('updatedAt', 'desc')));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export async function deleteText(id) {
  const { fs, col } = await texts();
  await fs.deleteDoc(fs.doc(col, id));
}
