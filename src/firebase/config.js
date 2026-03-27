import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyAGgfUrYYq57nm-vg1KvG0RWmjGC7mnvP0',
  authDomain: 'nba-showdown-2k25.firebaseapp.com',
  projectId: 'nba-showdown-2k25',
  storageBucket: 'nba-showdown-2k25.firebasestorage.app',
  messagingSenderId: '345880761475',
  appId: '1:345880761475:web:43ed2bedd9f5c83a4b77b6',
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
