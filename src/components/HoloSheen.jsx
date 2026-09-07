// HOLOGRAPHIC SHEEN FOR LEGENDARY CARDS (the user, 2026-09-06).
//
// The apex band — sixteen base cards at $1,200 and up — reads as legendary in
// the pack reveal (purple aura, pulsing border) and nowhere else. This is the
// foil the tier deserves wherever its face is drawn: a rainbow that sweeps
// across the printed card with the pointer, a soft glare under the cursor,
// and, left alone, a slow drift so the card catches light on its own.
//
// ── WHERE ON THE CARD ───────────────────────────────────────────────────────
//
// Not the whole face. The user's second ask: "just the photo area of the card,
// as well as the gold parts of the super season styling." The face in the app
// is a flat PNG, so the sheen is CLIPPED to the template's geometry, restated
// as fractions in src/cards/faceRegions.js: the photo window on every card
// that gets a sheen, and on a Super Season card the gold band and frame too.
// One clipped layer pair per region.
//
// ── FITTING TO THE DRAWN IMAGE ──────────────────────────────────────────────
//
// Every screen fits the face into its box differently — the lightbox and
// collection tiles COVER (and crop), the pack reveal CONTAINS (letterboxed) —
// so a fraction of the BOX is not a fraction of the FACE. On load and on
// resize the component reads the <img>'s natural size and object-fit and
// computes the rectangle the face is actually drawn in; the region layers are
// positioned to that rectangle, so the photo polygon lands on the photo
// whether the strip shows the top third of the card or the whole thing.
//
// ── WHY THIS IS THE PARENT ELEMENT AND NOT A WRAPPER ───────────────────────
//
// Every face is an <img> sized by its box — `height: 100%` and `object-fit`
// inside a wrapper the layout owns. A sheen wrapper slipped BETWEEN the two
// would be the thing the image measures against, and an unsized wrapper
// collapses the image to nothing. So `Holo` IS the box: the call site swaps
// its `<div className={styles.cardArt}>` for `<Holo className={styles.cardArt}>`
// and keeps every rule it had. `isolation: isolate` keeps the colour-dodge
// blend inside the card rather than lighting the page behind it.
//
// ── WHY IT IS ALL CSS VARIABLES ────────────────────────────────────────────
//
// The pointer writes `--mx` / `--my` (as fractions of the FACE) on the element
// and nothing re-renders: no React state per mouse move, one
// requestAnimationFrame per element in flight at most. `data-lit` marks a
// hovered card so the drift yields to the pointer and the glare fades in.
// Inactive cards render the plain element — a common card costs exactly what
// it cost before.
import { useCallback, useEffect, useRef } from 'react';
import { clipPathFor } from '../cards/faceRegions.js';
import styles from './HoloSheen.module.css';

const DEFAULT_REGIONS = ['photo'];

/** The rectangle (relative to `box`) an <img> paints its picture in, under its object-fit and object-position. */
export function drawnRect(img, box) {
  const b = box.getBoundingClientRect();
  const i = img.getBoundingClientRect();
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (!nw || !nh || !i.width || !i.height) return { x: i.left - b.left, y: i.top - b.top, w: i.width, h: i.height };
  const cs = getComputedStyle(img);
  const fit = cs.objectFit || 'fill';
  let w = i.width;
  let h = i.height;
  if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
    const scale = fit === 'cover' ? Math.max(i.width / nw, i.height / nh) : Math.min(i.width / nw, i.height / nh);
    w = nw * (fit === 'scale-down' ? Math.min(scale, 1) : scale);
    h = nh * (fit === 'scale-down' ? Math.min(scale, 1) : scale);
  } else if (fit === 'none') {
    w = nw; h = nh;
  }
  // object-position computes to two lengths or percentages, e.g. "50% 0%".
  const [px = '50%', py = '50%'] = String(cs.objectPosition || '50% 50%').split(/\s+/);
  const along = (v, room) => (v.endsWith('%') ? (parseFloat(v) / 100) * room : parseFloat(v) || 0);
  return {
    x: i.left - b.left + along(px, i.width - w),
    y: i.top - b.top + along(py, i.height - h),
    w,
    h,
  };
}

// `idle` — whether the foil drifts on its own when no pointer is on the card.
// On in the lightbox and the pack reveal, where one card fills the stage; off
// in the collection, market and browser grids, where every Super Season tile
// would otherwise animate at once. A tile still lights up under the pointer.
export default function Holo({ active = true, regions = DEFAULT_REGIONS, idle = true, as: Tag = 'div', className = '', children, ...rest }) {
  const frame = useRef(0);
  const ref = useRef(null);
  const face = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const img = el.querySelector('img');
    const r = img ? drawnRect(img, el) : { x: 0, y: 0, w: el.clientWidth, h: el.clientHeight };
    face.current = r;
    el.style.setProperty('--fx', `${r.x.toFixed(1)}px`);
    el.style.setProperty('--fy', `${r.y.toFixed(1)}px`);
    el.style.setProperty('--fw', `${r.w.toFixed(1)}px`);
    el.style.setProperty('--fh', `${r.h.toFixed(1)}px`);
  }, []);

  // The box the call site hands over may already be positioned (the pack
  // reveal's fronts are `absolute` inside a 3D stage); only a static box gets
  // `relative`, so the layers have something to fill and nothing else moves.
  // Set here, not in the stylesheet, because CSS-module order between this
  // sheet and the caller's is whatever the bundler picked.
  const attach = useCallback(el => {
    ref.current = el;
    if (el && typeof getComputedStyle === 'function' && getComputedStyle(el).position === 'static') {
      el.style.position = 'relative';
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const el = ref.current;
    if (!el) return undefined;
    fit();
    const img = el.querySelector('img');
    const onLoad = () => fit();
    img?.addEventListener('load', onLoad);
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => { img?.removeEventListener('load', onLoad); ro?.disconnect(); };
  }, [active, fit]);

  const onPointerMove = useCallback(e => {
    const el = ref.current;
    if (!el) return;
    const { clientX, clientY } = e;
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const b = el.getBoundingClientRect();
      const f = face.current;
      if (!f.w || !f.h) return;
      const mx = Math.max(-0.2, Math.min(1.2, (clientX - b.left - f.x) / f.w));
      const my = Math.max(-0.2, Math.min(1.2, (clientY - b.top - f.y) / f.h));
      el.style.setProperty('--mx', `${(mx * 100).toFixed(1)}%`);
      el.style.setProperty('--my', `${(my * 100).toFixed(1)}%`);
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
      data-idle={idle ? '' : undefined}
      {...rest}
    >
      {children}
      <span className={styles.face} aria-hidden="true">
        {regions.map(region => (
          <span key={region} className={styles.region} data-region={region} style={{ clipPath: clipPathFor(region) }}>
            <span className={styles.foil} />
            <span className={styles.glare} />
          </span>
        ))}
      </span>
    </Tag>
  );
}
