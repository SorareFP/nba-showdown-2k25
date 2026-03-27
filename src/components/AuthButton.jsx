import { useAuth } from '../firebase/AuthProvider.jsx';
import styles from './AuthButton.module.css';

export default function AuthButton() {
  const { user, loading, signIn, signOut } = useAuth();

  if (loading) return null;

  if (!user) {
    return (
      <button className={styles.signIn} onClick={signIn}>
        Sign In
      </button>
    );
  }

  return (
    <div className={styles.user}>
      {user.photoURL && (
        <img src={user.photoURL} alt="" className={styles.avatar} referrerPolicy="no-referrer" />
      )}
      <span className={styles.name}>{user.displayName?.split(' ')[0]}</span>
      <button className={styles.signOut} onClick={signOut}>Sign Out</button>
    </div>
  );
}
