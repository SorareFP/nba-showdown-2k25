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

// A region is `{ key, clip }` (holoRegionsFor's shape); a bare string names
// one of the fixed regions and is resolved through clipPathFor.
const DEFAULT_REGIONS = ['photo'];
const asRegion = r => (typeof r === 'string' ? { key: r, clip: clipPathFor(r) } : r);

/**
 * Where `el` sits inside `box` in LAYOUT pixels — offsets and sizes, which no
 * transform touches. The measurement used to be two getBoundingClientRects,
 * and a bounding rect is the box AFTER every transform on the way up: the
 * pack reveal turns the foil on as the card flips, mid-way through a rotateY
 * and the legendary's settle-bounce, so the face was measured squashed and
 * kept that size once the card came to rest (the user, 2026-09-28: a small
 * ghost of Gilbert Arenas's card over his own). The layers are positioned
 * inside the box's own untransformed space, so that is the space to measure
 * in. Null when the offset chain does not lead to the box (no layout yet).
 */
function layoutIn(el, box) {
  let x = 0;
  let y = 0;
  let n = el;
  while (n && n !== box) {
    x += n.offsetLeft;
    y += n.offsetTop;
    const parent = n.offsetParent;
    // An offset is from the parent's padding edge; past an intermediate
    // parent on the way to the box, its border counts too.
    if (parent && parent !== box) { x += parent.clientLeft; y += parent.clientTop; }
    n = parent;
  }
  return n === box ? { x, y, w: el.offsetWidth, h: el.offsetHeight } : null;
}

/** The rectangle (relative to `box`, in its untransformed layout) an <img> paints its picture in, under its object-fit and object-position. */
export function drawnRect(img, box) {
  const i = layoutIn(img, box) ?? { x: 0, y: 0, w: box.clientWidth, h: box.clientHeight };
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  if (!nw || !nh || !i.w || !i.h) return i;
  const cs = getComputedStyle(img);
  const fit = cs.objectFit || 'fill';
  let w = i.w;
  let h = i.h;
  if (fit === 'contain' || fit === 'cover' || fit === 'scale-down') {
    const scale = fit === 'cover' ? Math.max(i.w / nw, i.h / nh) : Math.min(i.w / nw, i.h / nh);
    w = nw * (fit === 'scale-down' ? Math.min(scale, 1) : scale);
    h = nh * (fit === 'scale-down' ? Math.min(scale, 1) : scale);
  } else if (fit === 'none') {
    w = nw; h = nh;
  }
  // object-position computes to two lengths or percentages, e.g. "50% 0%".
  const [px = '50%', py = '50%'] = String(cs.objectPosition || '50% 50%').split(/\s+/);
  const along = (v, room) => (v.endsWith('%') ? (parseFloat(v) / 100) * room : parseFloat(v) || 0);
  return {
    x: i.x + along(px, i.w - w),
    y: i.y + along(py, i.h - h),
    w,
    h,
  };
}

// `idle` — whether the foil drifts on its own when no pointer is on the card.
// On in the lightbox and the pack reveal, where one card fills the stage; off
// in the collection, market and browser grids, where every Super Season tile
// would otherwise animate at once. A tile still lights up under the pointer.
//
// `sweep` — ONE bright band crossing the card, right now, over the top of the
// ambient drift. This is a reveal beat, not a state: the pack turns it on as a
// legendary lands and off again on the way to the next card, and the animation
// restarts because the attribute is genuinely removed and re-added. Left on
// permanently it would just be a faster, worse drift.
export default function Holo({ active = true, regions = DEFAULT_REGIONS, idle = true, sweep = false, as: Tag = 'div', className = '', children, ...rest }) {
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
      // The face is in layout pixels (drawnRect); the pointer is on screen,
      // where a scaled card is bigger or smaller than its layout. Back into
      // the box's own pixels first.
      const sx = el.offsetWidth ? b.width / el.offsetWidth : 1;
      const sy = el.offsetHeight ? b.height / el.offsetHeight : 1;
      const mx = Math.max(-0.2, Math.min(1.2, ((clientX - b.left) / (sx || 1) - f.x) / f.w));
      const my = Math.max(-0.2, Math.min(1.2, ((clientY - b.top) / (sy || 1) - f.y) / f.h));
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
  // THE PHOTO BLENDS WITH THE PICTURE; THE GOLD PAINTS OVER IT (2026-09-28).
  // A clipped or masked element is a stacking context, and a stacking
  // context blends its children only with each other — so a `.foil` inside a
  // `.region` never reached the card below, whatever its mix-blend-mode said,
  // and every region painted its rainbow flat at its opacity. On the gold
  // that is the approved look. On a photo it was a coloured filter over the
  // whole picture, worst on a dark one (the user, on A'ja Wilson: "very
  // off"). So the photo gets a face layer of its own, and THAT layer — the
  // outermost thing in the card's isolated group — carries the blend
  // (HoloSheen.module.css, `.face[data-blend]`).
  const all = regions.map(asRegion);
  const layers = [
    { blend: true, list: all.filter(r => r.key === 'photo') },
    { blend: false, list: all.filter(r => r.key !== 'photo') },
  ].filter(l => l.list.length);
  return (
    <Tag
      ref={attach}
      className={`${styles.holo} ${className}`}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      data-holo=""
      data-idle={idle ? '' : undefined}
      data-sweep={sweep ? '' : undefined}
      {...rest}
    >
      {children}
      {layers.map(({ blend, list }) => (
        <span key={blend ? 'photo' : 'gold'} className={styles.face} data-blend={blend ? '' : undefined} aria-hidden="true">
          {list.map(({ key, clip, mask }) => (
            <span
              key={key}
              className={styles.region}
              data-region={key}
              data-mask={mask ? '' : undefined}
              style={{
                clipPath: clip,
                // The region span covers the WHOLE card and is only clipped, so
                // a mask sized to it lands on the face pixel for pixel — see the
                // note in faceRegions.js for why the mask is the card itself.
                ...(mask ? { maskImage: `url(${mask})`, WebkitMaskImage: `url(${mask})` } : null),
              }}
            >
              <span className={styles.foil} />
              <span className={styles.glare} />
            </span>
          ))}
        </span>
      ))}
    </Tag>
  );
}
