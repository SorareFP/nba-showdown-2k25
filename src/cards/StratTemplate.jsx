// The strategy-card face, composed from strats.js data plus one piece of art —
// the same idea as CardTemplate for player cards. The 43 hand-made faces in
// public/cards/strats/ set the design language this reproduces: white header
// with the title in heavy caps, art window with a diagonal white wedge and
// chevron dot-work over its bottom edge, navy body carrying the phase line and
// rules text, and the side (OFFENSE / DEFENSE) anchoring the footer. All 43
// ship at exactly 825x1238, so that is the contract here too.
//
// The card's `color` field is its IN-GAME chip color, not its face color —
// And One is amber in hand but navy on the card like everything else — so the
// face keeps the house navy and uses `color` only for the thin accent rule
// under the title, which is enough to tell cards apart in a spread without
// breaking the set's one look.
import React from 'react';
import styles from './StratTemplate.module.css';

export const STRAT_CARD_WIDTH = 825;
export const STRAT_CARD_HEIGHT = 1238;

const PHASE_LINES = {
  matchup: 'Play during the Matchup Phase.',
  pre_roll: 'Play before a scoring roll.',
  scoring: 'Play during the Scoring Phase.',
  post_roll: 'Play after a scoring roll.',
  reaction: 'Play in reaction to an opponent’s card.',
};

export function phaseLine(phase) {
  return PHASE_LINES[phase] ?? 'Play during the game.';
}

export const LOCK_LINE = '\u{1F512} Cannot be canceled once played.';

/**
 * The rules text as printed paragraphs. The in-game `desc` is the source of
 * truth; a lock marker inside it moves to the standard lock line so the face
 * always states the lock the same way, and a locked card that never mentions
 * it still gets the line.
 */
export function faceParagraphs(strat) {
  const desc = String(strat.desc ?? '');
  const lockSplit = desc.split('\u{1F512}');
  const body = lockSplit[0].trim();
  const paragraphs = body
    .split(/(?<=[.!:])\s+(?=[A-Z“"(])/u)
    .map(s => s.trim())
    .filter(Boolean);
  const locked = Boolean(strat.locked) || lockSplit.length > 1;
  return { paragraphs, locked };
}

/** The chevron dot-work the hand-made faces carry — three fading arrowheads. */
function ChevronDots({ direction = 'left', className }) {
  const dots = [];
  // Three chevrons of dotted diagonals, drawn as circles on a small grid.
  for (let c = 0; c < 3; c += 1) {
    for (let i = 0; i < 7; i += 1) {
      const x = c * 34 + Math.abs(i - 3) * 12;
      dots.push(<circle key={`${c}-${i}a`} cx={x} cy={i * 14} r={4.4} />);
      dots.push(<circle key={`${c}-${i}b`} cx={x + 14} cy={i * 14} r={4.4} />);
    }
  }
  return (
    <svg
      viewBox="-6 -8 128 104"
      className={className}
      style={direction === 'right' ? { transform: 'scaleX(-1)' } : undefined}
      aria-hidden="true"
    >
      {dots}
    </svg>
  );
}

export default function StratTemplate({
  strat,
  artUrl = null,
  crop = null,
  onArtLoad = () => {},
}) {
  const { paragraphs, locked } = faceParagraphs(strat);
  const artStyle = crop
    ? {
        objectPosition: `${crop.x ?? 50}% ${crop.y ?? 50}%`,
        transform: crop.scale ? `scale(${crop.scale})` : undefined,
      }
    : undefined;
  return (
    <div
      className={styles.card}
      data-strat-id={strat.id}
      style={{ width: STRAT_CARD_WIDTH, height: STRAT_CARD_HEIGHT }}
    >
      <div className={styles.header}>
        <div className={styles.title}>{strat.name}</div>
        <div className={styles.titleRule} style={{ background: strat.color ?? '#16305e' }} />
      </div>

      <div className={styles.artWindow}>
        {artUrl ? (
          <img
            className={styles.art}
            src={artUrl}
            style={artStyle}
            alt=""
            onLoad={onArtLoad}
            onError={onArtLoad}
          />
        ) : (
          <div className={styles.noArt}>NO ART</div>
        )}
        <div className={styles.wedge} />
        <ChevronDots direction="left" className={styles.artChevrons} />
      </div>

      <div className={styles.body}>
        <div className={styles.phase}>{phaseLine(strat.phase)}</div>
        {paragraphs.map((p, i) => (
          <p key={i} className={styles.rule}>{p}</p>
        ))}
        {locked ? <p className={styles.lock}>{LOCK_LINE}</p> : null}
      </div>

      <div className={styles.footer}>
        <ChevronDots direction="right" className={styles.footChevrons} />
        <div className={styles.side}>{strat.side === 'def' ? 'DEFENSE' : 'OFFENSE'}</div>
      </div>
    </div>
  );
}
