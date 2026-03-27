// FatigueLegend.jsx
import styles from './FatigueLegend.module.css';

export function FatigueLegend() {
  return (
    <div className={styles.legend}>
      <span>⏱ <b>8+ min</b> → −2 roll</span>
      <span className={styles.div}>·</span>
      <span><b>12+ min</b> → −4 roll</span>
      <span className={styles.div}>·</span>
      <span>Bench 1 seg → recover 8 min</span>
      <span className={styles.div}>·</span>
      <span>🔥 Hot = +2/roll</span>
      <span className={styles.div}>·</span>
      <span>❄️ Cold = −2/roll (clears on bench)</span>
      <span className={styles.div}>·</span>
      <span>Natural 1/2 → ❄️</span>
      <span className={styles.div}>·</span>
      <span>Natural 19/20 → 🔥</span>
    </div>
  );
}

export default FatigueLegend;
