import { useEffect, useRef } from 'react';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import Holo from './HoloSheen.jsx';
import { holoRegionsFor } from '../cards/faceRegions.js';
import styles from './CardLightbox.module.css';

/**
 * THE HOVER MAGNIFIER. The user, 2026-09-16: "If someone hovers over a card,
 * player or strategy, for a second, you get the magnified card on screen
 * until they move the mouse."
 *
 * Two pieces. `useCardPeek` is the hover half — handlers a card image spreads
 * onto itself, which start a one-second clock on enter and cancel it on leave
 * — and `PeekOverlay` is the picture, drawn by the LightboxProvider so there
 * is one of it and it sits above everything. It does not block the pointer,
 * so the card underneath keeps its click, and it goes the moment the mouse
 * moves — with a short grace and a few pixels of slack, because the pointer
 * is never perfectly still and a magnifier that vanished the instant it
 * appeared would never be seen.
 *
 * Touch has no hover; the hook does nothing where `(hover: hover)` is false.
 */
// One second since 2026-09-24 (the user: "Reduce the hover time to one
// second to magnify a player card please"); it was two.
export const PEEK_DELAY_MS = 1000;
const GRACE_MS = 250;
const SLACK_PX = 6;

const canHover = () => {
  try { return globalThis.matchMedia?.('(hover: hover)')?.matches ?? false; } catch { return false; }
};

export function useCardPeek(lb, type, data) {
  const timer = useRef(null);
  const clear = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => clear, []);
  if (!lb?.peek || !data || !canHover()) return {};
  return {
    onMouseEnter: e => {
      clear();
      const at = { x: e.clientX, y: e.clientY };
      timer.current = setTimeout(() => { timer.current = null; lb.peek(type, data, at); }, PEEK_DELAY_MS);
    },
    onMouseLeave: () => { clear(); lb.unpeek?.(); },
  };
}

export function PeekOverlay({ item, at, onClose }) {
  const { type, data } = item;
  const src = type === 'player' ? getPlayerImageUrl(data.id, data.set) : getStratImagePath(data.id);
  useEffect(() => {
    const born = Date.now();
    const onMove = e => {
      if (Date.now() - born < GRACE_MS) return;
      if (at && Math.hypot(e.clientX - at.x, e.clientY - at.y) < SLACK_PX) return;
      onClose();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mousedown', onClose);
    window.addEventListener('keydown', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mousedown', onClose);
      window.removeEventListener('keydown', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [at, onClose]);
  if (!src) return null;
  return (
    <div className={styles.peek} aria-hidden="true">
      <Holo as="span" className={styles.fullResHolo} active={type === 'player' && holoRegionsFor(data).length > 0} regions={holoRegionsFor(data)}>
        <img src={src} alt="" className={styles.peekImg} />
      </Holo>
    </div>
  );
}
