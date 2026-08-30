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
import { hidesEmptyRows, setBadge, setTreatment, showsSeason } from './sets.js';
import { badgeVars, pickBadge } from './badges.js';
import { deriveFieldTheme, fieldThemeVars } from './fieldTheme.js';
import { applyTreatment, treatmentVars } from './treatments.js';
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
 * The tiers the card actually PRINTS, for the set the card belongs to.
 *
 * The 2026-27 generator floors every chart with a blank tier on rolls 1-2,
 * 0/0/0 (see scripts/cardgen/zeroFloor.js) — the same two rolls engine.js hands
 * out a cold marker for. It is STRUCTURE: the game resolves a natural 1 or 2
 * against it and it stays in the data, but a row guaranteed to read "1-2 | 0 |
 * 0 | 0" on every card in the set tells the player nothing they cannot infer
 * from the chart starting at 3, and the table only has room for five rows. The
 * user's call, in their own words: "We could even leave the lowest band off the
 * card and start the no-scoring band at 2 or whatever we decide should be the
 * case, just in order to save room."
 *
 * ── AND THE SAME IS TRUE OF ANY OTHER ROW THAT PAYS NOTHING ─────────────────
 *
 * The tier above the floor is the NO-SCORING tier: `pts: 0` with reb and ast
 * carried over from the player's real bottom decile. On most of the pool those
 * two also round to zero, so the card printed a SECOND row saying nothing —
 * "like Jalen Brunson's 'Roll: 3 - 0-0-0' Line", in the user's words. Same
 * argument, so same answer: an all-zero row is dropped too. A row that carries
 * something — Rudy Gobert's "3-4 | 0 | 1 | 0" — is not empty, and goes on
 * printing; that rebound is the entire reason the no-scoring tier exists.
 *
 * A PREFIX, NOT A FILTER, and that is a real distinction rather than an
 * implementation detail. The justification above is "every roll below the
 * lowest printed row implicitly produces nothing", which is only true of rows
 * at the BOTTOM. Dropping an all-zero row from the middle would leave the
 * printed ranges with a hole in them — "3-5" followed by "8+", and a roll of 6
 * matching no row at all — which is worse than the redundant ink it saves. So
 * the leading run is dropped and anything above it is printed as-is. No chart
 * in any of the three generated sets has an all-zero row anywhere but the
 * bottom (checked: 864 cards, 0 occurrences), so today the two rules print
 * identically; this one stays correct if that ever stops being true.
 *
 * GATED ON THE SET, NOT ON THE TIER'S SHAPE, and that is the whole point. 66 of
 * the finished 2025-26 cards print "1-2: 0,0,0" as a genuine hand-made bottom
 * row, and the reference set exists so the template can be judged against the
 * cards as they were really printed. The two are the same three numbers over
 * the same two rolls, so no shape match can separate them — hiding by shape
 * would silently delete a row from all 66. See hidesEmptyRows in sets.js.
 *
 * The last remaining tier is never dropped: a chart with no rows at all is not
 * a card, and "chart not generated" is what the empty case is for.
 */
export function visibleTiers(chart, set) {
  if (!Array.isArray(chart)) return [];
  if (!hidesEmptyRows(set)) return chart;
  let first = 0;
  // `chart.length - 1` is the floor, not `chart.length`: a chart whose every
  // tier is empty still has to render one row.
  while (first < chart.length - 1 && isEmptyTier(chart[first])) first += 1;
  return first === 0 ? chart : chart.slice(first);
}

/**
 * A tier that produces nothing at all.
 *
 * Deliberately says nothing about WHERE the tier sits or how WIDE it is. The
 * structural floor zeroFloor.js prepends reaches roll 2 on most cards, roll 3
 * on many and roll 4 on a few (the merge folds an equally blank no-scoring tier
 * into it for low-usage players), and the no-scoring tier above it is a
 * different row with the same emptiness. What they have in common — the only
 * thing that matters here — is that rolling into one pays the player nothing.
 */
function isEmptyTier(tier) {
  return !!tier && tier.pts === 0 && tier.reb === 0 && tier.ast === 0;
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
  // WHICH SET this card belongs to. Decides three things, all of them set-level
  // rules rather than card-level ones: whether a row that produces nothing is
  // printed (visibleTiers), whether the season is (showsSeason in sets.js), and
  // which visual treatment the palette is run through (treatments.js). It also
  // supplies a BLANKET badge for the sets that give every card one — but the
  // badge itself is a card property now, so `set` is only half of that answer.
  // Left undefined, every tier prints, which is correct for the finished set
  // and fails loudly (a sixth row, over the photo) rather than quietly for the
  // set being built.
  set,
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
  //
  // Then the SET's treatment composes on top of that palette — gold foil for
  // Super Season, a green accent for Rookie, nothing at all for the two season
  // sets, which is why they render byte-identically to before. A treatment may
  // only spend contrast the untreated card already had; see treatments.js.
  //
  // The UNTREATED theme is kept: the card-type badge is derived from it, not
  // from the treated one, because the Rookie pill is the TEAM's accent and the
  // green treatment overwrites `accentOnField` with its own green. See badges.js.
  const base = deriveFieldTheme(team.primary, team.secondary, accent);
  const field = applyTreatment(base, setTreatment(set));
  const treatment = field.treatment ?? null;

  const photoUrl = resolvePhotoUrl({
    playerId: card.id,
    hasPhoto,
    personId: card.personId ?? null,
    version: photoVersion,
    ext: photoExt,
  });

  // The printed rows, and the rule the arrow sits on within them — searched
  // together so they cannot disagree. See visibleTiers and findShotLineBoundary.
  const chart = visibleTiers(card.chart, set);
  const shotLineRow = findShotLineBoundary(chart, card.shotLine);

  // THE BADGE IS BOTH QUESTIONS AT ONCE, and that union is the whole model.
  // A set may badge EVERY card in it (the two special sets do); a CARD may
  // carry badge ids of its own (149 of the 2026-27 pool do, because their best
  // season is the one that set is built from, so the separate Super Season set
  // has no card for them — see card-data/generated/card-badges.json). pickBadge
  // resolves the union to the ONE that prints, in badges.js's declared priority
  // order: Super Season before Rookie, the user's "prioritize in that order".
  const badge = pickBadge([setBadge(set), ...(Array.isArray(card.badges) ? card.badges : [])]);
  // The season, by contrast, IS purely a set question. A base-set record
  // carries no seasonLabel at all, and a 2025-26 legend card has its season
  // drawn into the hand-made art, so gating on the data instead of the set
  // would print a second season over the top of 23 finished cards. A badged
  // 2026-27 card does NOT gain one: the card is this season by definition, and
  // "keep the 26-27 design and just add the badge" is what was asked for.
  const season = showsSeason(set);

  return (
    <div
      className={styles.card}
      data-card-root=""
      data-treatment={treatment?.id ?? undefined}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        // The raw brand pair stays exposed: it is what the team editor round-
        // trips, and the derived values below are only ever computed FROM it.
        '--team-primary': team.primary,
        '--team-secondary': team.secondary,
        '--team-accent': accent,
        ...fieldThemeVars(field),
        ...treatmentVars(field),
        // From `base`, not `field` — see the note where `base` is derived.
        // Emits nothing at all when this card has no badge.
        ...badgeVars(base, badge),
      }}
    >
      {/* FIRST CHILD, and that is the whole positioning rule: it paints over
        * the card's flat field and under everything else, because every other
        * element here is positioned at z-index auto and so paints in tree
        * order. Rendered only when the treatment actually produced a sheen —
        * on a field with no contrast to spare, fitAmplitude returns 0 and the
        * card simply keeps its plain surface. */}
      {treatment?.sheen && <div className={styles.treatmentSheen} />}

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
        {/* The card-type badge and the season, in that order, directly above
          * the team mark — which is where the finished set's legend cards put
          * the season, measured off the art: 12px cap height, centred on the
          * sidebar's own column, one gap above the logo. The column is
          * BOTTOM-ANCHORED, so each row pushes the stack upward and moves
          * nothing below it — which is exactly what lets a 2026-27 card gain a
          * badge without gaining a season and without a pixel of the rest of
          * its sidebar moving. A card with neither is byte-identical to what it
          * was before either row existed.
          *
          * The badge FIRST because it says what kind of card this is and the
          * season answers "which one" — and because the pill is the louder of
          * the two, so it belongs further from the type it would crowd. */}
        {badge && <div className={styles.badge}>{badge.text}</div>}
        {season && <div className={styles.season}>{card.seasonLabel ?? MISSING}</div>}
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

      {/* LAST CHILD, over .card::after's own keyline rather than instead of it.
        * A gradient cannot be a box-shadow colour, so the metallic frame has to
        * be a border-image on a box of its own — and layering it keeps the
        * existing rule (and the test that reads its width out of the
        * stylesheet) exactly as it was. Untreated sets never render it. */}
      {treatment?.frameImage && <div className={styles.treatmentFrame} />}
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
