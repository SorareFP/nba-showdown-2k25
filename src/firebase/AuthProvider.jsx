import { createContext, useContext, useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut as fbSignOut } from 'firebase/auth';
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from './config.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  // TRUE FOR THE SIGN-IN THAT CREATED THE ACCOUNT, until the app has shown
  // the sign-up bonus once (clearSignup). Nothing is stored: a returning
  // account on a new device has a user document already and never sees it.
  const [justSignedUp, setJustSignedUp] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        // Always set user first so auth works even if Firestore fails
        setUser(fbUser);
        try {
          const ref = doc(db, 'users', fbUser.uid);
          const snap = await getDoc(ref);
          if (!snap.exists()) {
            setJustSignedUp(true);
            await setDoc(ref, {
              displayName: fbUser.displayName,
              email: fbUser.email,
              photoURL: fbUser.photoURL,
              currency: 0,
              starterPackOpened: false,
              dailyMilestoneCoins: 0,
              dailyMilestoneDate: '',
              dailyFirstWin: false,
              createdAt: serverTimestamp(),
            });
          }
          // No migration for older accounts: starterPackOpened and the daily
          // counters are server-owned now and the rules refuse them from here.
          // Every reader treats a missing value as false/zero, which is what
          // the migration used to write.
        } catch (e) {
          console.warn('Firestore user doc error (check security rules):', e.message);
        }
      } else {
        setUser(null);
        setJustSignedUp(false);
      }
      setLoading(false);
    });
    return unsub;
  }, []);

  const signIn = () => signInWithPopup(auth, googleProvider);
  const signOut = () => fbSignOut(auth);
  const clearSignup = () => setJustSignedUp(false);

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, justSignedUp, clearSignup }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
