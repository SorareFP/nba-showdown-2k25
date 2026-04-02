// src/components/game/TutorialOverlay.jsx
import { useState, useEffect } from 'react';
import s from './TutorialOverlay.module.css';

/**
 * Tutorial tooltip data format:
 * {
 *   id: string,              // unique tooltip ID
 *   text: string,            // main message
 *   detail: string|null,     // optional secondary text
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

  if (!activeTooltip) return null;

  return (
    <>
      <div className={s.overlay} />
      <div className={`${s.tooltip} ${s[activeTooltip.position || 'bottom']}`}>
        <div className={s.tooltipText}>{activeTooltip.text}</div>
        {activeTooltip.detail && <div className={s.tooltipDetail}>{activeTooltip.detail}</div>}
        <div className={s.tooltipActions}>
          <button className={s.gotIt} onClick={handleDismiss}>Got it</button>
          <button className={s.skip} onClick={onSkip}>Skip Tutorial</button>
        </div>
      </div>
    </>
  );
}
