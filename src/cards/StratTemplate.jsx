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
import { CRUNCH_CARDS } from '../game/strats.js';
import React from 'react';
import styles from './StratTemplate.module.css';
import { resolvePhotoUrl } from './photo.js';

export const STRAT_CARD_WIDTH = 825;
export const STRAT_CARD_HEIGHT = 1238;

const PHASE_LINES = {
  matchup: 'Play during the Matchup Phase.',
  pre_roll: 'Play before a scoring roll.',
  scoring: 'Play during the Scoring Phase.',
  post_roll: 'Play after a scoring roll.',
  reaction: 'Play in reaction to an opponent’s card.',
};

/**
 * CRUNCH-ONLY CARDS LOOK LIKE IT. Black face, and CRUNCH TIME printed big
 * above the phase line, so a hand can be read from across the table. The
 * user (2026-09-08): "all Crunch-Time cards to be Black or say CRUNCH-TIME big
 * somewhere." Both. The list is the engine's own (strats.js), so a new
 * crunch card gets the face the moment it is gated.
 */
export function isCrunchFace(strat) {
  return CRUNCH_CARDS.includes(strat?.id);
}

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

/**
 * `card`/`hasPhoto`/`photoExt`/`set`/`photoVersion`/`onPhotoLoad` mirror
 * CardTemplate's prop names EXACTLY, so the studio's CropEditor and the batch
 * ExportFrame can swap one template for the other without either of them
 * learning what a strategy card is. `artUrl` stays as a direct override for
 * callers (and tests) that already have a URL in hand.
 */
export default function StratTemplate({
  strat,
  card = null,
  artUrl = null,
  crop = null,
  hasPhoto = false,
  photoExt,
  set = 'strats',
  photoVersion,
  onArtLoad = () => {},
  onPhotoLoad,
}) {
  const s = strat ?? card;
  const { paragraphs, locked } = faceParagraphs(s);
  const crunch = isCrunchFace(s);
  const resolved =
    artUrl ??
    resolvePhotoUrl({
      playerId: s.id,
      hasPhoto,
      version: photoVersion,
      set,
      ext: photoExt,
    });
  const notify = onPhotoLoad ?? onArtLoad;
  const artStyle = crop
    ? {
        objectPosition: `${crop.x ?? 50}% ${crop.y ?? 50}%`,
        transform: crop.zoom || crop.scale ? `scale(${crop.zoom ?? crop.scale})` : undefined,
      }
    : undefined;
  return (
    <div
      className={`${styles.card} ${crunch ? styles.crunch : ''}`}
      data-strat-id={s.id}
      style={{ width: STRAT_CARD_WIDTH, height: STRAT_CARD_HEIGHT }}
    >
      <div className={styles.header}>
        <div className={styles.title}>{s.name}</div>
        <div className={styles.titleRule} style={{ background: s.color ?? '#16305e' }} />
      </div>

      <div className={styles.artWindow}>
        {resolved ? (
          <img
            className={styles.art}
            src={resolved}
            style={artStyle}
            alt=""
            onLoad={notify}
            onError={notify}
          />
        ) : (
          <div className={styles.noArt}>NO ART</div>
        )}
        <div className={styles.wedge} />
        <ChevronDots direction="left" className={styles.artChevrons} />
      </div>

      <div className={styles.body}>
        {crunch ? <div className={styles.crunchStamp}>CRUNCH TIME</div> : null}
        <div className={styles.phase}>{phaseLine(s.phase)}</div>
        {paragraphs.map((p, i) => (
          <p key={i} className={styles.rule}>{p}</p>
        ))}
        {locked ? <p className={styles.lock}>{LOCK_LINE}</p> : null}
      </div>

      <div className={styles.footer}>
        <ChevronDots direction="right" className={styles.footChevrons} />
        <div className={styles.footRight}>
          {s.presentedBy ? (
            // THE SPONSOR LINE. The user (2026-09-08) dropped the Underdog logo
            // "for the little 'presented by' part" of Unethical Hoops, then asked
            // for it "in larger typeface above OFFENSE, running horizontal with
            // the logo to the right". The logo lives in public/logos/ with the
            // team crests and is reached the way the app reaches those.
            <div className={styles.presented}>
              <span className={styles.presentedLabel}>Presented By</span>
              <img
                className={styles.presentedLogo}
                src={`${import.meta.env.BASE_URL}logos/${s.presentedBy.logo}`}
                alt={s.presentedBy.name}
              />
            </div>
          ) : null}
          <div className={styles.side}>{s.side === 'def' ? 'DEFENSE' : 'OFFENSE'}</div>
        </div>
      </div>
    </div>
  );
}
