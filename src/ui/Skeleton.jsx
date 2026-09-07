// WHAT A LOADING SCREEN SHOULD SAY.
//
// "Loading..." in grey italics tells the player one thing they already know —
// that nothing is here yet — and nothing about what is coming. A skeleton says
// the shape: three rows means three rows, a wide block then a narrow one means
// a name and a price. The wait feels shorter for the same number of
// milliseconds, because the page has already started.
//
// Deliberately dumb: no measuring, no matching the real row heights to the
// pixel. A skeleton that tries too hard to look like the content it replaces
// reads as a rendering bug when the real thing lands slightly differently.
import styles from './Skeleton.module.css';

/**
 * `rows` blocks of the given `height`, with the last one short — a list ends
 * ragged, and a stack of identical bars reads as a loading BAR, which is a
 * different promise.
 */
export default function Skeleton({ rows = 3, height = 46, label = 'Loading' }) {
  return (
    <div className={styles.stack} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className={styles.row}
          style={{ height, width: i === rows - 1 ? '62%' : '100%' }}
        />
      ))}
      <span className={styles.srOnly}>{label}…</span>
    </div>
  );
}
