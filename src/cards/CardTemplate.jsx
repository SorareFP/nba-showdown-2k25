// THE single source of truth for card rendering. Both the Card Studio preview
// and the batch PNG export render this same component, so what you see in the
// studio is literally what gets written to disk. There is deliberately no
// export-specific renderer — two renderers would drift.
//
// Fixed at 843x1181 = 2.5in x 3.5in at 337 DPI, matching the existing 306-card
// set exactly. Do NOT make the dimensions responsive and do NOT use rem/em
// anywhere: the export screenshots this element at exactly these pixel
// dimensions, in a page whose root font size it must not depend on.
//
// EVERY stat field is optional. The 2025-26 pool has names and teams today;
// charts, Speed/Power, salaries and shot lines arrive incrementally as the
// generators are run. A missing field renders a placeholder, never a crash —
// the studio has to stay usable while the data is half-built.
import { useState } from 'react';
import { getThemedTeam, resolveAccent } from './teams.js';
import { deriveFieldTheme, fieldThemeVars } from './fieldTheme.js';
import { resolvePhotoUrl, cropToStyle } from './photo.js';
import styles from './CardTemplate.module.css';

export const CARD_WIDTH = 843;
export const CARD_HEIGHT = 1181;

/** Rendered in place of any stat the generators haven't produced yet. */
const MISSING = '—'; // em dash

/**
 * Formats a chart tier's roll range the way the printed cards do.
 *
 * The top tier is open-ended — its `hi` is stored as 99 (the highest possible
 * roll) but reads as "21+" on the card, because the die can't exceed it.
 */
export function formatRollRange(tier) {
  if (!tier || tier.lo == null) return MISSING;
  if (tier.hi == null) return `${tier.lo}+`;
  if (tier.hi >= 99) return `${tier.lo}+`;
  if (tier.lo === tier.hi) return `${tier.lo}`;
  return `${tier.lo}-${tier.hi}`;
}

/**
 * The tiers the card actually PRINTS.
 *
 * The generator puts a blank tier on the bottom of every chart — roll 1 alone,
 * 0/0/0 — because a natural 1 always produces nothing (see
 * scripts/cardgen/zeroFloor.js). A row that is guaranteed to read "1 | 0 | 0 |
 * 0" on every card in the set tells the player nothing they cannot infer from
 * the chart starting at 2, and it costs a row out of a table that only has
 * room for a handful. So it is dropped here, and the printed chart starts at
 * the no-scoring tier. The tier stays in the DATA — the game resolves a
 * natural 1 against it — it just is not drawn.
 *
 * CONDITIONAL, not unconditional, and the condition is the shape of the tier
 * rather than its position. The shipped 2025-26 set is rendered through this
 * same component and its bottom tier is a REAL band 3-4 rolls wide that often
 * scores (LeBron's "1-3: 2,0,0"); 168 of those 306 cards do have an all-zero
 * bottom tier, but none of them is one roll wide. Hiding row 0 on position
 * alone would silently delete a scoring row from every one of them. Matching
 * on "exactly roll 1 and completely blank" hides precisely the structural tier
 * this rule is about and nothing else.
 */
export function visibleTiers(chart) {
  if (!Array.isArray(chart)) return [];
  return chart.length > 1 && isBlankTier(chart[0]) ? chart.slice(1) : chart;
}

/** The blank natural-1 tier the generator prepends. Kept in sync with zeroFloor.js. */
function isBlankTier(tier) {
  return (
    !!tier && tier.lo === 1 && tier.hi === 1 && tier.pts === 0 && tier.reb === 0 && tier.ast === 0
  );
}

/**
 * Index of the PRINTED row whose BOTTOM EDGE carries the shot-line arrow.
 *
 * THE ARROW IS A BOUNDARY MARKER, NOT A ROW MARKER. It sits ON the hairline
 * between the last roll that MISSES and the first roll that MAKES — "right on
 * the line", in the user's words. Returning the row ABOVE the line (rather than
 * the row below it) is an arbitrary but fixed convention: the renderer pins the
 * glyph to that row's bottom edge, so both halves of the triangle straddle the
 * rule the two rows share.
 *
 * MEASURED OFF THE PRINTED ART, not chosen. Every one of the 300 shipped card
 * PNGs was decoded and the arrow's triangle located against the table's own
 * hairlines: 297 of 300 centre it on a rule and NOT ONE centres it in a row
 * (median offset from the rule 0.5px, versus ~20px to the nearest row centre).
 * On 08_09_LeBron_James.png — Shot Line 14, rows "10-13" and "14-20" — the
 * triangle spans y 1069..1088 and the rule between those two rows is at y 1077.
 *
 * WHICH rule follows from the engine, and the two agree. src/game/engine.js
 * resolves a shot as `total >= player.shotLine`, so the player misses on
 * 1..(shotLine-1) and makes on shotLine..20; the line therefore falls directly
 * below the row containing `shotLine - 1`. 286 of the 300 printed cards place
 * it exactly there. (Two use the `>` reading and twelve are a boundary out —
 * the design errors the user remembers. The majority and the code agree, so
 * this follows both.)
 *
 * Returns -1 when there is no shot line, when no row contains the last miss, or
 * when that row is the LAST one — the bottom of the table is the frame, not a
 * dividing line, and a card with no make row has nothing to divide. A missing
 * arrow beats a wrong one.
 *
 * IT INDEXES WHATEVER ARRAY IT IS GIVEN, and the arrow is drawn against a
 * PRINTED row, so it must be given the PRINTED tiers — `visibleTiers(chart)`,
 * not `card.chart`. Passing the full chart while rendering the visible one puts
 * every arrow exactly one row too low, and it would still look plausible on
 * every card: the ranges are what decide, so the only defence is to search the
 * same list that gets rendered.
 */
export function findShotLineBoundary(chart, shotLine) {
  if (!Array.isArray(chart) || shotLine == null || !Number.isFinite(shotLine)) return -1;
  const lastMiss = shotLine - 1;
  const row = chart.findIndex(t => t && lastMiss >= t.lo && lastMiss <= t.hi);
  return row >= 0 && row < chart.length - 1 ? row : -1;
}

// The accent rule lives in teams.js now, with the rest of a team's theme: the
// studio's team editor has to offer the same value the card renders, and two
// copies of that rule would drift. Import pickAccent/resolveAccent from there.
//
// Deliberately NOT re-exported from here. A re-export would keep the old
// import path working, but it also makes this module export a non-component,
// which breaks React Fast Refresh — the studio's whole workflow is editing a
// card and watching it update.

/**
 * Font size for the vertical name, computed rather than measured.
 *
 * The name runs the full height of the card's left edge, so a long one
 * ("Nickeil Alexander-Walker", 24 characters) has to shrink or it overflows the
 * card. The export is a headless screenshot with no layout feedback loop
 * available, so this estimates from character count against the face's average
 * advance. Erring small is safe; erring large clips the name.
 *
 * ALL THREE CONSTANTS ARE CALIBRATED against the printed reference art, not
 * chosen. Measured there: LeBron's 12-character name is 71px cap by 772px long,
 * Anthony Edwards' 15-character one is 62px cap by 872px. Tomorrow's cap height
 * is 0.74em and its average uppercase advance ~0.70em (measured from the loaded
 * face, not assumed), which puts the reference at 96px and 84px respectively.
 * These constants reproduce both to within 1.5%:
 *
 *   12 chars -> capped at 96px, renders 783px long  (art: 772)
 *   15 chars -> 900/(0.70*15) = 85px,   renders 905px (art: 872)
 *
 * MAX_PX is what a SHORT name gets, so it sets the card's headline size; the
 * budget only starts binding at about 13 characters.
 */
const NAME_MAX_PX = 96;
const NAME_MIN_PX = 30;
/** Height of .nameSlot in CardTemplate.module.css — the name's whole runway. */
const NAME_AVAILABLE_PX = 900;
/** Tomorrow's average uppercase advance, measured from the loaded font. */
const NAME_ADVANCE_RATIO = 0.7;

export function nameFontSize(name) {
  const len = Math.max(String(name ?? '').length, 1);
  const fitted = NAME_AVAILABLE_PX / (NAME_ADVANCE_RATIO * len);
  // Floor, not round: rounding up can push the estimate back over the budget.
  return Math.floor(Math.min(NAME_MAX_PX, Math.max(NAME_MIN_PX, fitted)));
}

/** Boost values always print their sign, including "+0" (see the printed cards). */
function formatBoost(value) {
  if (value == null || !Number.isFinite(value)) return MISSING;
  return value < 0 ? `${value}` : `+${value}`;
}

export default function CardTemplate({
  card = {},
  crop,
  hasPhoto = false,
  // The extension the curated photo is stored under. Defaults to .jpg inside
  // resolvePhotoUrl, which is what the studio's own uploads are written as —
  // only a hand-saved .jpeg/.png/.webp/.avif needs this to be passed.
  photoExt,
  teamOverrides,
  // A token that changes when this player's photo file is rewritten, so the
  // browser re-requests a URL that did not change. See resolvePhotoUrl.
  photoVersion,
  // Optional: the studio needs the source image's real dimensions to know how
  // far it can be panned. Nothing about the card depends on it.
  onPhotoLoad,
}) {
  const team = getThemedTeam(card.team, teamOverrides);
  // An accent the studio's team editor set wins; otherwise it is computed from
  // the pair. See resolveAccent — Denver is why the override exists.
  const accent = resolveAccent(team);
  // The card's FIELD is the team's primary color, so every other color on it —
  // ink, panels, hairlines, the band — is derived from that primary by
  // contrast rather than hardcoded. See fieldTheme.js.
  const field = deriveFieldTheme(team.primary, team.secondary, accent);

  const photoUrl = resolvePhotoUrl({
    playerId: card.id,
    hasPhoto,
    personId: card.personId ?? null,
    version: photoVersion,
    ext: photoExt,
  });

  // The printed rows, and the rule the arrow sits on within them — searched
  // together so they cannot disagree. See visibleTiers and findShotLineBoundary.
  const chart = visibleTiers(card.chart);
  const shotLineRow = findShotLineBoundary(chart, card.shotLine);

  return (
    <div
      className={styles.card}
      data-card-root=""
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        // The raw brand pair stays exposed: it is what the team editor round-
        // trips, and the derived values below are only ever computed FROM it.
        '--team-primary': team.primary,
        '--team-secondary': team.secondary,
        '--team-accent': accent,
        ...fieldThemeVars(field),
      }}
    >
      <div className={styles.topBand} />
      <LeagueMark />

      <div className={`${styles.statBlock} ${styles.speedBlock}`}>
        <div className={styles.statLabel}>SPEED</div>
        <div className={styles.statValue}>{card.speed ?? MISSING}</div>
      </div>
      <div className={`${styles.statBlock} ${styles.powerBlock}`}>
        <div className={styles.statLabel}>POWER</div>
        <div className={styles.statValue}>{card.power ?? MISSING}</div>
      </div>

      <div className={styles.chevronTop} />
      <div className={styles.chevronBottom} />

      <div className={styles.nameSlot}>
        <div className={styles.nameText} style={{ fontSize: nameFontSize(card.name) }}>
          {card.name ?? 'UNNAMED'}
        </div>
      </div>

      <div className={styles.photoOuter}>
        <div className={styles.photoWindow}>
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={card.name ?? ''}
              className={styles.photo}
              data-card-photo=""
              style={cropToStyle(crop)}
              onLoad={event =>
                onPhotoLoad?.({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
            />
          ) : (
            <div className={styles.photoPlaceholder}>NO PHOTO</div>
          )}
        </div>
      </div>

      {/* After the photo and before the sidebar, and that ORDER is the feature:
        * the scrim's job is to quiet the photo the sidebar is printed over, so
        * it has to paint above the one and below the other. */}
      <div className={styles.sidebarScrim} />

      <div className={styles.sidebar}>
        <TeamLogo key={card.team ?? 'none'} team={team} abbr={card.team} />
        <div className={styles.pos}>{card.pos ?? MISSING}</div>
        <Boost label="PAINT" value={card.paintBoost} />
        <Boost label="3PT" value={card.threePtBoost} />
        <Boost label="DEFENSE" value={card.defBoost} />
        <div className={styles.boost}>
          <div className={styles.boostLabel}>SALARY</div>
          <div className={styles.boostValue}>{card.salary ?? MISSING}</div>
        </div>
      </div>

      <table className={styles.chart}>
        <colgroup>
          <col className={styles.colRoll} />
          <col className={styles.colStat} />
          <col className={styles.colStat} />
          <col className={styles.colStat} />
        </colgroup>
        <thead>
          <tr>
            <th>ROLL</th>
            <th>PTS</th>
            <th>REB</th>
            <th>AST</th>
          </tr>
        </thead>
        <tbody>
          {chart.length === 0 ? (
            <tr>
              <td className={styles.chartEmpty} colSpan={4}>
                chart not generated
              </td>
            </tr>
          ) : (
            chart.map((tier, i) => (
              <tr key={i}>
                <td className={styles.rollCell}>
                  {/* Pinned to this row's BOTTOM edge, so it straddles the rule
                    * this row shares with the one below. See .shotArrow. */}
                  {i === shotLineRow && (
                    <span
                      className={styles.shotArrow}
                      data-testid="shot-line-arrow"
                      aria-label={`Shot line ${card.shotLine}`}
                    >
                      {'▶'}
                    </span>
                  )}
                  {formatRollRange(tier)}
                </td>
                <td>{tier?.pts ?? MISSING}</td>
                <td>{tier?.reb ?? MISSING}</td>
                <td>{tier?.ast ?? MISSING}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The browser URL for a logo file, from the path TEAMS records for it.
 *
 * teams.js deliberately stores a bare root-relative PATH ('/logos/CLE.png'):
 * it is plain data, imported by Node scripts (scripts/cardgen/resolveTeams.js)
 * as well as by the browser, so it must not depend on a bundler's environment.
 *
 * But this app is served under a BASE PATH ('/nba-showdown-2k25/'), and public/
 * assets live beneath it. The bare path 404s — verified against the running dev
 * server, which is how this was caught: the logo fallback made every card look
 * fine while the present-a-logo path was quietly broken for every team.
 *
 * BASE_URL rather than a fourth hardcoded copy of the base string. The typeof
 * guard keeps teams.js's consumers honest in plain Node, where import.meta.env
 * does not exist.
 */
export function logoSrc(path) {
  if (!path) return null;
  const base = typeof import.meta.env === 'object' && import.meta.env !== null
    ? import.meta.env.BASE_URL
    : '/';
  return `${String(base).replace(/\/+$/, '')}${path}`;
}

/**
 * The league mark's file, the one logo that is not a team's.
 *
 * Lives next to the team logos in public/logos/ and is resolved through the
 * same logoSrc(), so it picks up the app's base path like everything else.
 */
export const LEAGUE_LOGO = '/logos/NBA.png';

/**
 * The NBA mark in the card's top-left corner.
 *
 * Position and size are MEASURED off the printed reference art, not chosen:
 * in public/cards/players/08_09_LeBron_James.png the mark's white keyline
 * spans x 80..107, y 23..85 — 28x63, an aspect of 0.444 that matches the real
 * mark's 405x905 to within a percent. See .leagueMark in the stylesheet.
 *
 * Falls back to the lettered badge this used to draw by hand, for the same
 * reason TeamLogo does: a missing file has to look deliberate, and the export
 * must never show a browser broken-image glyph.
 */
function LeagueMark() {
  const [failed, setFailed] = useState(false);
  const src = logoSrc(LEAGUE_LOGO);
  if (!src || failed) {
    return <div className={styles.leagueMarkFallback}>NBA</div>;
  }
  return (
    <img src={src} alt="NBA" className={styles.leagueMark} onError={() => setFailed(true)} />
  );
}

/**
 * Team logo with a text fallback.
 *
 * Logo files are NOT in this repo — the user drops them into
 * public/logos/{ABBR}.png — so until they arrive EVERY card 404s its logo. That
 * has to look deliberate, not broken: on error we swap the <img> for the team
 * abbreviation in a matching circle, in the same slot and at the same size, so
 * the sidebar below it never shifts and no browser broken-image glyph appears.
 */
function TeamLogo({ team, abbr }) {
  const [failed, setFailed] = useState(false);
  const label = abbr ?? '';
  const src = logoSrc(team.logo);

  if (!src || failed) {
    return <div className={styles.logoFallback}>{label}</div>;
  }
  return (
    <img
      src={src}
      alt={team.name}
      className={styles.logo}
      onError={() => setFailed(true)}
    />
  );
}

function Boost({ label, value }) {
  return (
    <div className={styles.boost}>
      <div className={styles.boostLabel}>{label}</div>
      <div className={styles.boostValue}>{formatBoost(value)}</div>
    </div>
  );
}
