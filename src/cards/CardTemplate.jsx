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
import { getThemedTeam } from './teams.js';
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
 * Index of the chart row the shot-line arrow belongs on.
 *
 * Shot Line is not printed as a number anywhere on the card — the ONLY way it
 * is communicated is this arrow against the row whose roll range contains it
 * (LeBron 08-09's Shot Line 14 puts the arrow on his "14-20" row). A card
 * without the arrow is missing a stat, not missing a decoration.
 *
 * Returns -1 when there is no shot line or no row contains it, which renders
 * no arrow rather than defaulting to row 0 — a wrong arrow is worse than none.
 */
export function findShotLineIndex(chart, shotLine) {
  if (!Array.isArray(chart) || shotLine == null || !Number.isFinite(shotLine)) return -1;
  return chart.findIndex(t => t && shotLine >= t.lo && shotLine <= t.hi);
}

/** Perceptual luminance of a #rrggbb color, 0 (black) to 1 (white). */
function luminance(hex) {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Picks the color used for team-tinted TEXT on the card's navy field.
 *
 * Neither brand color is safe to use blind: nine teams (Bulls, Rockets,
 * Spurs, Raptors, Trail Blazers, Nets...) carry #000000 as one of their two
 * colors, and black text on a navy card is invisible. So take the brighter of
 * the pair, and if even that is too dark to read, fall back to a neutral
 * off-white. Decorative fills still use the raw brand colors — only text and
 * hairlines route through here.
 *
 * The threshold is set where it is because it is the lowest value that clears
 * the two teams whose brighter color is still a mid-tone blue on a navy field
 * (Timberwolves #236192, Hornets #00788C) while keeping the ones that read
 * fine (Thunder #007AC1, Grizzlies #5D76A9). The printed Timberwolves card
 * uses cream for exactly this reason.
 */
const MIN_ACCENT_LUMINANCE = 0.38;

export function pickAccent(primary, secondary) {
  const brighter = luminance(secondary) > luminance(primary) ? secondary : primary;
  return luminance(brighter) < MIN_ACCENT_LUMINANCE ? '#E6ECF8' : brighter;
}

/**
 * Font size for the vertical name, computed rather than measured.
 *
 * The name runs the full height of the card's left edge, so a long one
 * ("Shai Gilgeous-Alexander") has to shrink or it overflows the card. The
 * export is a headless screenshot with no layout feedback loop available, so
 * this estimates from character count against the condensed face's average
 * advance width. Erring small is safe; erring large clips the name.
 */
export function nameFontSize(name) {
  const len = Math.max(String(name ?? '').length, 1);
  const AVAILABLE_PX = 880;
  const AVG_ADVANCE_RATIO = 0.55;
  // Floor, not round: rounding up can push the estimate back over the budget.
  return Math.floor(Math.min(78, Math.max(30, AVAILABLE_PX / (AVG_ADVANCE_RATIO * len))));
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
  teamOverrides,
  // A token that changes when this player's photo file is rewritten, so the
  // browser re-requests a URL that did not change. See resolvePhotoUrl.
  photoVersion,
  // Optional: the studio needs the source image's real dimensions to know how
  // far it can be panned. Nothing about the card depends on it.
  onPhotoLoad,
}) {
  const team = getThemedTeam(card.team, teamOverrides);
  const accent = pickAccent(team.primary, team.secondary);

  const photoUrl = resolvePhotoUrl({
    playerId: card.id,
    hasPhoto,
    personId: card.personId ?? null,
    version: photoVersion,
  });

  const chart = Array.isArray(card.chart) ? card.chart : [];
  const shotLineRow = findShotLineIndex(chart, card.shotLine);

  return (
    <div
      className={styles.card}
      data-card-root=""
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        '--team-primary': team.primary,
        '--team-secondary': team.secondary,
        '--team-accent': accent,
      }}
    >
      <div className={styles.topBand} />
      <div className={styles.leagueMark}>NBA</div>

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
 * Team logo with a text fallback.
 *
 * Logo files are NOT in this repo — the user drops them into
 * public/logos/{ABBR}.png — so right now EVERY card 404s its logo. That has to
 * look deliberate, not broken: on error we swap the <img> for the team
 * abbreviation in the same slot, so the sidebar layout below it never shifts
 * and no browser broken-image glyph appears.
 */
function TeamLogo({ team, abbr }) {
  const [failed, setFailed] = useState(false);
  const label = abbr ?? '';

  if (!team.logo || failed) {
    return <div className={styles.logoFallback}>{label}</div>;
  }
  return (
    <img
      src={team.logo}
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
