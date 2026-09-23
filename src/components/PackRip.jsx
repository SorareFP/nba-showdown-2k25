// THE SEALED PACK — and tearing it open.
//
// The user (2026-09-23): "For pack opening, I would love to have an actual
// pack-ripping animation." Before the first card of every pack the stage
// holds a foil wrapper: the card back under a dark foil, crimped top and
// bottom, the pack's name and its count. Dragging across the top tears the
// strip off as the pointer goes — the torn piece lifts and hinges at the tear
// front — and letting go past TEAR_DONE finishes it: the strip flies off, the
// body drops away, and the stack it was holding is there. Letting go early
// springs the strip back. A tap, Enter or Space tears it across on its own.
//
// Pointer events rather than mouse/touch, so a thumb and a mouse are one code
// path; `touch-action: none` on the wrapper keeps a phone from scrolling the
// page while the tear is dragged. Nothing here knows what is in the pack —
// PackOpening keeps the cards and mounts the stack when `onOpened` fires.
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './PackRip.module.css';

/** How far across the pack a drag has to reach before it counts as torn. */
export const TEAR_DONE = 0.55;
/** A tap tears the strip across in this long. */
export const AUTO_TEAR_MS = 320;
/** The strip flying off and the body dropping away — PackOpening waits this long. */
export const RIP_MS = 650;

const reducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);

export default function PackRip({
  name = 'Pack',
  count = 0,
  back = '/nba-showdown-2k25/card-back.png',
  onRip = null,
  onOpened = null,
}) {
  const [tear, setTearState] = useState(0);
  const [phase, setPhase] = useState('sealed'); // sealed | dragging | opening
  const drag = useRef(null);
  const raf = useRef(0);
  const opened = useRef(false);
  // The tear is read on release, and a release can land in the same task as
  // the move before it — before React has re-rendered — so the handlers read
  // the ref, never the state's closure.
  const tearRef = useRef(0);
  const setTear = useCallback(v => { tearRef.current = v; setTearState(v); }, []);

  const finish = useCallback(() => {
    if (opened.current) return;
    opened.current = true;
    setTear(1);
    setPhase('opening');
    onRip?.();
    setTimeout(() => onOpened?.(), reducedMotion() ? 0 : RIP_MS);
  }, [onRip, onOpened, setTear]);

  const autoTear = useCallback(() => {
    if (opened.current) return;
    if (reducedMotion() || typeof requestAnimationFrame !== 'function') { finish(); return; }
    cancelAnimationFrame(raf.current);
    const t0 = performance.now();
    const step = now => {
      const t = Math.min(1, (now - t0) / AUTO_TEAR_MS);
      setTear(t);
      if (t < 1) raf.current = requestAnimationFrame(step);
      else finish();
    };
    raf.current = requestAnimationFrame(step);
  }, [finish, setTear]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onPointerDown = e => {
    if (opened.current) return;
    e.stopPropagation();
    // Capture keeps the tear following a finger that wanders off the pack. A
    // pointer the browser does not consider active (a synthetic event) throws
    // here, and the tear works without the capture.
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* no capture */ }
    drag.current = { startX: e.clientX, width: e.currentTarget.getBoundingClientRect().width || 1, moved: false };
    setPhase('dragging');
  };
  const onPointerMove = e => {
    if (!drag.current || opened.current) return;
    const dx = Math.abs(e.clientX - drag.current.startX);
    if (dx > 4) drag.current.moved = true;
    setTear(Math.min(1, dx / (drag.current.width * 0.75)));
  };
  const onPointerUp = e => {
    if (!drag.current || opened.current) return;
    e.stopPropagation();
    const { moved } = drag.current;
    drag.current = null;
    if (!moved) { autoTear(); return; }
    if (tearRef.current >= TEAR_DONE) finish();
    else { setPhase('sealed'); setTear(0); }
  };
  const onKeyDown = e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    e.stopPropagation();
    autoTear();
  };

  const hint = phase === 'opening'
    ? ''
    : phase === 'dragging' && tear > 0.05
      ? (tear >= TEAR_DONE ? 'Let go' : 'Keep going…')
      : 'Drag across the top to tear it open · or tap';

  return (
    <div
      className={`${styles.pack} ${styles[phase]}`}
      style={{ '--tear': tear }}
      role="button"
      tabIndex={0}
      aria-label={`Tear open the ${name}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.body}>
        <img className={styles.backArt} src={back} alt="" draggable={false} onError={e => { e.currentTarget.style.display = 'none'; }} />
        <div className={styles.foil} />
        <div className={styles.crimpBottom} />
        <div className={styles.label}>
          <img className={styles.logo} src="/nba-showdown-2k25/logo.png" alt="" draggable={false} onError={e => { e.currentTarget.style.display = 'none'; }} />
          <div className={styles.name}>{name}</div>
          <div className={styles.count}>{count} cards</div>
        </div>
        <div className={styles.hint} aria-live="polite">{hint}</div>
      </div>
      {/* The strip, in two pieces that share the tear front: what is still
          attached, and what has been torn and lifts as the pointer goes. */}
      <div className={`${styles.stripClip} ${styles.keepClip}`} aria-hidden>
        <div className={styles.strip}>
          <img className={styles.backArt} src={back} alt="" draggable={false} />
          <div className={styles.foil} />
          <div className={styles.crimpTop} />
        </div>
      </div>
      <div className={`${styles.stripClip} ${styles.tornClip}`} aria-hidden>
        <div className={`${styles.strip} ${styles.stripTorn}`}>
          <img className={styles.backArt} src={back} alt="" draggable={false} />
          <div className={styles.foil} />
          <div className={styles.crimpTop} />
        </div>
      </div>
    </div>
  );
}
