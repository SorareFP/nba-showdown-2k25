// THE ROLL, AS A MOMENT.
//
// The D20 is the heartbeat of this game and for a year it simply APPEARED as a
// number, in eight-point grey, with the same weight as the rebound count
// beside it. You could miss your own twenty.
//
// So: the die tumbles for four hundred milliseconds, lands with a punch, and
// the points arrive just behind it. A natural 20 and a top-tier hit flash gold;
// a natural 1 shakes. Nothing else changes.
//
// ── THE ANIMATION IS THEATRE OVER A KNOWN OUTCOME ───────────────────────────
//
// The engine has already rolled, scored and banked the points before this
// component sees anything — `result` is a finished fact. The tumble does not
// decide, delay or gate the game; if it were removed the game would be
// identical. That is deliberate, and it is why nothing here can desync: there
// is no state to be out of step with.
//
// ── WHY A SIGNATURE AND NOT THE OBJECT ──────────────────────────────────────
//
// PlayerSlot re-renders on every game change — a card played across the court,
// an assist spent, the other team rolling. Restarting the tumble on object
// identity would make every slot's die spin whenever anything happened. The
// signature is the roll's CONTENT, so the animation runs once, when this
// player's number actually changes.
import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../../ui/motion.js';
import styles from './RollResult.module.css';

/** How long the die tumbles, and how fast the faces swap while it does. */
const TUMBLE_MS = 400;
const FACE_MS = 55;

/**
 * What kind of roll this was, for colour.
 *
 * `isTop` is the engine's own "reached the chart's last row" (hitsTopTier),
 * which is not the same as rolling well — a card with three one-point rows can
 * top out on a 9. Both are worth marking and they are marked differently: the
 * natural 20 is the die, the top tier is the outcome.
 */
export function bandOf(result) {
  if (!result) return null;
  if (result.die === 20) return 'crit';
  if (result.die === 1) return 'fumble';
  if (result.isTop) return 'top';
  if (!result.pts) return 'miss';
  return 'hit';
}

export default function RollResult({ result, col }) {
  const reduced = usePrefersReducedMotion();
  const [face, setFace] = useState(null);

  // EVERY DEPENDENCY BELOW IS A PRIMITIVE, and that is the whole trick.
  //
  // The first version depended on `result` itself. PlayerSlot re-renders on
  // every game change, `result` is a fresh object each time, so the effect
  // re-ran constantly: its cleanup cleared the timer that ends the tumble, the
  // re-run then bailed on an unchanged signature, and nothing ever set the
  // face back to null. The die spun forever. Depending on the roll's
  // CONTENT instead means the effect fires once, when the number changes.
  const sig = result ? `${result.die}|${result.finalRoll}|${result.pts}|${result.reb}|${result.ast}` : null;
  const die = result?.die;
  const replaced = Boolean(result?.isReplaced);

  useEffect(() => {
    // No roll yet, a REPLACED roll — You Stand Over There and Green Light write
    // a result without a die being cast, and `die` is a dash, so tumbling to a
    // number nobody rolled would misreport what happened — or a player who has
    // asked for less motion: show the landed result with no theatre.
    if (!sig || reduced || replaced || typeof die !== 'number') { setFace(null); return undefined; }

    setFace(1 + Math.floor(Math.random() * 20));
    const spin = setInterval(() => setFace(1 + Math.floor(Math.random() * 20)), FACE_MS);
    const stop = setTimeout(() => { clearInterval(spin); setFace(null); }, TUMBLE_MS);
    return () => { clearInterval(spin); clearTimeout(stop); };
  }, [sig, reduced, die, replaced]);

  // A slot with no roll yet renders nothing — the caller shows its Roll button.
  if (!result) return null;

  if (face !== null) {
    return (
      <div className={styles.result}>
        <div className={styles.tumbleWrap}>
          <span className={styles.tumble}>{face}</span>
        </div>
      </div>
    );
  }

  const band = bandOf(result);
  const bonus = result.bonus !== 0 ? `${result.bonus > 0 ? '+' : ''}${result.bonus}` : '';

  return (
    // Keyed on the signature so the landing animations replay for a NEW roll
    // and not for a re-render of the same one.
    <div key={sig} className={`${styles.result} ${styles[band] ?? ''}`}>
      <div className={styles.diceStr}>
        🎲<span className={styles.die}>{result.die}</span>{bonus}
        {bonus && <>={result.finalRoll}</>}
        {result.isTop ? ' ⭐' : ''}
      </div>
      <div className={styles.pts} style={{ color: col }}>
        {result.pts}<span className={styles.ptsUnit}>pts</span>
      </div>
      <div className={styles.statLine}>{result.reb}r {result.ast}a</div>
    </div>
  );
}
