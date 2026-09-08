// src/components/game/TutorialOverlay.jsx
import { useState, useEffect } from 'react';
import s from './TutorialOverlay.module.css';

/**
 * Tutorial tooltip data format:
 * {
 *   id: string,              // unique tooltip ID
 *   text: string|fn,         // main message — or (game) => string, read every render
 *   detail: string|fn|null,  // optional secondary text, same
 *   highlight: string|null,  // CSS selector; matching elements glow above the dim
 *   anchor: string,          // CSS selector or element ID to anchor near
 *   position: 'top'|'bottom'|'left'|'right',
 *   trigger: {               // when to show this tooltip
 *     phase: string,         // game phase (draft, matchup_strats, scoring)
 *     condition: function,   // (game) => boolean
 *   },
 *   section: number,         // which tutorial section (1, 2, 3)
 *   priority: number,        // higher = shown first when multiple match
 * }
 */

export default function TutorialOverlay({ game, tooltips, onDismiss, onSkip }) {
  const [dismissed, setDismissed] = useState(new Set());

  // Find the highest-priority tooltip that matches current game state
  const activeTooltip = tooltips
    .filter(t => !dismissed.has(t.id))
    .filter(t => {
      if (t.trigger.phase && t.trigger.phase !== game.phase) return false;
      if (t.trigger.condition && !t.trigger.condition(game)) return false;
      return true;
    })
    .sort((a, b) => b.priority - a.priority)[0] || null;

  const handleDismiss = () => {
    if (!activeTooltip) return;
    setDismissed(prev => new Set([...prev, activeTooltip.id]));
    onDismiss?.(activeTooltip.id);
  };

  // THE THING BEING TALKED ABOUT GLOWS. The dim sits at z-index 100 with
  // pointer-events off; the class lifts the matched element above it and
  // pulses its outline. Re-run on every render, since the element may not
  // exist the moment the tooltip first matches (a card that is still being
  // dealt), and cleaned up when the tooltip changes or goes.
  const highlight = activeTooltip?.highlight ?? null;
  useEffect(() => {
    if (!highlight) return undefined;
    const els = [...document.querySelectorAll(highlight)];
    els.forEach(el => el.classList.add(s.highlight));
    return () => els.forEach(el => el.classList.remove(s.highlight));
  });

  if (!activeTooltip) return null;

  // Text that reads the board says what the board says.
  const read = v => {
    if (typeof v !== 'function') return v;
    try { return v(game); } catch { return null; }
  };
  const text = read(activeTooltip.text);
  const detail = read(activeTooltip.detail);

  return (
    <>
      <div className={s.overlay} />
      <div className={`${s.tooltip} ${s[activeTooltip.position || 'bottom']}`}>
        <div className={s.tooltipText}>{text}</div>
        {detail && <div className={s.tooltipDetail}>{detail}</div>}
        <div className={s.tooltipActions}>
          <button className={s.gotIt} onClick={handleDismiss}>Got it</button>
          <button className={s.skip} onClick={onSkip}>Skip Tutorial</button>
        </div>
      </div>
    </>
  );
}
