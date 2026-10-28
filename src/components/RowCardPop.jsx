// THE ROW'S CARD (the user, 2026-10-20: "When I hover over this, I should be
// able to see a pop-up of the card I'm hovering over"). A short hover on a
// row of players shows the card beside the list and holds it while the
// pointer is on the row (the one-second magnifier, CardPeek.jsx, suits a card
// image, not a list you sweep down); a click opens the whole card, as every
// card on a menu does. Drawn on <body>: the wide board is zoomed, and the
// row's screen rectangle is what the card is placed against.
//
// Born in the board's roster panels (CourtBoard.jsx); shared since the Live
// Series table (LiveMovers.jsx, 2026-10-28) shows a card the same way.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPlayerImageUrl, getPlayerThumbUrl, fallbackTo } from '../game/cardImages.js';
import styles from './RowCardPop.module.css';

export const ROW_CARD_DELAY_MS = 150;
const ROW_CARD_W = 260;
const ROW_CARD_H = Math.round(ROW_CARD_W * 1238 / 825);

/** Where the card goes: beside the row, on the side away from the panel's edge of the screen. */
export function rowCardSpot(rect, side, vw, vh) {
  const gap = 12;
  const leftOf = rect.left - ROW_CARD_W - gap;
  const rightOf = rect.right + gap;
  let left = side === 'left' ? leftOf : rightOf;
  if (left < 8) left = rightOf;
  if (left + ROW_CARD_W > vw - 8) left = Math.max(8, leftOf);
  const top = Math.min(Math.max(8, rect.top + rect.height / 2 - ROW_CARD_H / 2), Math.max(8, vh - ROW_CARD_H - 8));
  return { left, top, width: ROW_CARD_W };
}

/** The hover half: a short hover on a row shows its card, leaving the row (or choosing it) hides it. */
export function useRowCard() {
  const [hover, setHover] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = (p, e) => {
    clearTimeout(timer.current);
    const rect = e.currentTarget.getBoundingClientRect();
    timer.current = setTimeout(() => setHover({ p, rect }), ROW_CARD_DELAY_MS);
  };
  const leave = () => { clearTimeout(timer.current); setHover(null); };
  return { hover, enter, leave };
}

export function RowCardPop({ player, rect, side }) {
  if (typeof document === 'undefined') return null;
  const spot = rowCardSpot(rect, side, window.innerWidth, window.innerHeight);
  return createPortal(
    <div className={styles.rowCardPop} style={spot} aria-hidden="true" data-row-card={player.id}>
      <img src={getPlayerThumbUrl(player.id, player.set)} onError={fallbackTo(getPlayerImageUrl(player.id, player.set))} alt="" />
    </div>,
    document.body,
  );
}
