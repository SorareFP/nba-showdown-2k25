// THE BACK OF THE CARD — the thing you look at while you are still guessing.
//
// ── WHY IT IS BEING REPLACED ────────────────────────────────────────────────
//
// The shipped public/card-back.png says NBA SHOWDOWN 2K25. The game is NBA
// SHOWDOWN 2026, and the back is the single most-seen surface in the app: pack
// opening renders it four or five times per pack, once for every card in the
// peek stack, so the old name is on screen more than any card face.
//
// ── WHY IT IS A COMPONENT AND NOT AN IMAGE SOMEBODY DREW ────────────────────
//
// Same reason every card face is: it exports through the studio's own Playwright
// pipeline at the same 843x1181 print size, so the back is pixel-consistent
// with the fronts it sits behind, and re-rendering it after a rename is one
// command rather than a trip through an image editor. It loads no raster at
// all: the ball is BallMark.jsx, an icosahedron inflated onto its own sphere.
//
// ── WHAT IT IS TRYING TO BE ─────────────────────────────────────────────────
//
// Deliberately NOT interesting. A card back is seen more than any single face
// and is never the thing being looked at, so it should read instantly as "a
// card, face down" and then get out of the way. That means: strong central
// mark, heavy symmetry, no fine detail that would alias down to noise at the
// 340px the pack screen actually renders it at, and a border that reads as a
// border rather than as a frame with content in it.
//
// The palette is the app's own: --navy through --navy-light for the field,
// --orange for the mark. Repeated here as literals because this renders inside
// the export page, which does not load the app's stylesheet.
import BallMark from './BallMark.jsx';
import styles from './CardBack.module.css';

/**
 * `title` and `year` are props rather than constants so the rename that
 * prompted this component cannot strand a second hard-coded year in a second
 * file. src/cards/sets.js owns the real names; the export passes them in.
 *
 * `league` picks the ball. A WNBA back gets the two-tone ball, because the
 * league's own ball is the two-tone one and it is the fastest way to tell a
 * WNBA card from an NBA one across a table — which is what a back is for once
 * the cards are printed and stacked.
 */
export default function CardBack({ title = 'NBA SHOWDOWN', year = '2026', league = 'NBA' }) {
  const wnba = String(league).toUpperCase() === 'WNBA';
  return (
    <div className={styles.card}>
      {/* Field: a radial lift behind the mark so the centre reads brighter
          than the corners without a visible gradient edge. */}
      <div className={styles.field} />

      {/* THE COURT LINES. A half-court in outline, centred on the ball — it is
          what makes the back read as basketball at a glance, and being pure
          geometry it survives being scaled to a thumbnail. */}
      <svg className={styles.court} viewBox="0 0 843 1181" aria-hidden="true">
        <g fill="none" stroke="rgba(234,88,12,0.22)" strokeWidth="3">
          <circle cx="421.5" cy="590.5" r="300" />
          <circle cx="421.5" cy="590.5" r="232" />
          {/* The key, drawn from the bottom edge up, as on a real half-court. */}
          <rect x="286.5" y="838" width="270" height="343" />
          <circle cx="421.5" cy="838" r="90" />
          {/* Three-point arc: straight sides off the baseline into a sweep. */}
          <path d="M 96 1181 L 96 950 A 325 325 0 0 0 747 950 L 747 1181" />
        </g>
        {/* Corner ticks — four identical marks that give the eye something to
            register the card's orientation by without adding readable detail. */}
        <g fill="rgba(234,88,12,0.5)">
          <rect x="44" y="44" width="46" height="5" />
          <rect x="44" y="44" width="5" height="46" />
          <rect x="753" y="44" width="46" height="5" />
          <rect x="794" y="44" width="5" height="46" />
          <rect x="44" y="1132" width="46" height="5" />
          <rect x="44" y="1091" width="5" height="46" />
          <rect x="753" y="1132" width="46" height="5" />
          <rect x="794" y="1091" width="5" height="46" />
        </g>
      </svg>

      <div className={styles.frame} />

      <div className={styles.center}>
        {/* DRAWN, NOT LOADED. This used to be logo-ball.png — an AI-generated
            crop of the app icon on a black square, with the old wordmark's
            letters still in two corners — held together by a circular clip and
            a screen blend. BallMark is a d20 whose twenty faces are spherical
            triangles, so the silhouette is a true circle and the basketball
            seams are real great circles across it — both hacks are gone, the
            background is genuinely transparent, and it stays sharp at any
            size. */}
        <div className={styles.ballWrap}>
          <BallMark size={300} twoTone={wnba} />
        </div>
        <div className={styles.title}>
          {title.split(' ').map(word => (
            <span key={word} className={styles.word}>{word}</span>
          ))}
        </div>
        <div className={styles.rule} />
        <div className={styles.year}>{year}</div>
      </div>

      {/* The one piece of small type, at the foot where a card's legal line
          lives. It is not meant to be read on screen — it is meant to make the
          bottom edge feel finished rather than empty. */}
      <div className={styles.foot}>D20 BASKETBALL · COLLECT · BUILD · PLAY</div>
    </div>
  );
}
