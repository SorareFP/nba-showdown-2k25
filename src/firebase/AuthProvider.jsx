import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from './config.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // Always set user first so auth works even if Firestore fails
        setUser(fbUser);
        try {
          const ref = doc(db, 'users', fbUser.uid);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            await setDoc(ref, {
              displayName: fbUser.displayName,
              email: fbUser.email,
              photoURL: fbUser.photoURL,
              currency: 0,
              createdAt: serverTimestamp(),
            });
          }
        } catch (e) {
          console.warn('Firestore user doc error (check security rules):', e.message);
        }
      } else {
        setUser(null);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = () => signInWithPopup(auth, googleProvider);
  const signOut = () => fbSignOut(auth);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
