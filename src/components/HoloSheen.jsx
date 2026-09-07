// HOLOGRAPHIC SHEEN FOR LEGENDARY CARDS (the user, 2026-09-06).
//
// The apex band — sixteen base cards at $1,200 and up — reads as legendary in
// the pack reveal (purple aura, pulsing border) and nowhere else. This is the
// foil the tier deserves wherever its face is drawn: a rainbow that sweeps
// across the printed card with the pointer, a soft glare under the cursor,
// and, left alone, a slow drift so the card catches light on its own.
//
// ── WHY THIS IS THE PARENT ELEMENT AND NOT A WRAPPER ───────────────────────
//
// Every face in the app is an <img> sized by its box — `height: 100%` and
// `object-fit: cover` inside a wrapper the layout owns. A sheen wrapper
// slipped BETWEEN the two would be the thing the image measures against, and
// an unsized wrapper collapses the image to nothing. So `Holo` IS the box: the
// call site swaps its wrapper `<div className={styles.cardArt}>` for
// `<Holo className={styles.cardArt}>` and keeps every rule it had. The foil
// and glare are absolutely-positioned children painted over the image and
// clipped to the box's own radius; `isolation: isolate` keeps the colour-dodge
// blend inside the card rather than lighting the page behind it.
//
// ── WHY IT IS ALL CSS VARIABLES ────────────────────────────────────────────
//
// The pointer writes `--mx` / `--my` on the element and nothing re-renders:
// no React state per mouse move, one requestAnimationFrame per element in
// flight at most. `data-lit` marks a hovered card so the drift animation
// yields to the pointer and the glare fades in. Inactive cards render the
// plain element — a common card costs exactly what it cost before.
import { useCallback, useRef } from 'react';
import styles from './HoloSheen.module.css';

export default function Holo({ active = true, as: Tag = 'div', className = '', children, ...rest }) {
  const frame = useRef(0);
  // The box the call site hands over may already be positioned (the pack
  // reveal's fronts are `absolute` inside a 3D stage); only a static box gets
  // `relative`, so the layers have something to fill and nothing else moves.
  // Set here, not in the stylesheet, because CSS-module order between this
  // sheet and the caller's is whatever the bundler picked.
  const ref = useRef(null);
  const attach = useCallback(el => {
    ref.current = el;
    if (el && typeof getComputedStyle === 'function' && getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
  }, []);

  const onPointerMove = useCallback(e => {
    const el = ref.current;
    if (!el) return;
    const { clientX, clientY } = e;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const mx = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
      const my = Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100));
      el.style.setProperty('--mx', `${mx.toFixed(1)}%`);
      el.style.setProperty('--my', `${my.toFixed(1)}%`);
      el.dataset.lit = '';
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    delete el.dataset.lit;
  }, []);

  if (!active) {
    return <Tag className={className} {...rest}>{children}</Tag>;
  }
  return (
    <Tag
      ref={attach}
      className={`${styles.holo} ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      data-holo=""
      {...rest}
    >
      {children}
      <span className={styles.foil} aria-hidden="true" />
      <span className={styles.glare} aria-hidden="true" />
    </Tag>
  );
}
