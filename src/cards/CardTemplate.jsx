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
import {
  IMAGE_EXTENSIONS,
  cardTreatment,
  hidesEmptyRows,
  setBadge,
  setLeague,
  setStatsSeason,
  showsSeason,
} from './sets.js';
import { badgeLabel, badgeVars, pickBadge } from './badges.js';
import { awardImagePath, awardVars, pickAwards } from './awards.js';
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
  // only a hand-saved file needs this passed. See IMAGE_EXTENSIONS in sets.js
  // for what the studio serves.
  photoExt,
  teamOverrides,
  // A token that changes when this player's photo file is rewritten, so the
  // browser re-requests a URL that did not change. See resolvePhotoUrl.
  photoVersion,
  // Optional: the studio needs the source image's real dimensions to know how
  // far it can be panned. Nothing about the card depends on it.
  onPhotoLoad,
}) {
  // WHICH LEAGUE, which is a SET question like the three below it. Nine team
  // abbreviations mean different franchises in the two leagues, so the lookup
  // has to be told rather than left to guess — see getTeam.
  const league = setLeague(set);
  const team = getThemedTeam(card.team, teamOverrides, { league });
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
  //
  // AND THE TREATMENT IS A CARD QUESTION NOW, not purely a set one — see
  // `cardTreatment` in sets.js. A Super Season card under the salary line keeps
  // its team's own palette: the gold foil is the gilded tier's, and it is
  // withheld by the same comparison that turns its pill from SUPER SEASON into
  // BEST SEASON, so the two can never disagree about whether this card is gold.
  const base = deriveFieldTheme(team.primary, team.secondary, accent);
  const field = applyTreatment(base, cardTreatment(set, card.salary));
  const treatment = field.treatment ?? null;

  // THE SET IS PART OF THE PHOTO'S PATH, and leaving it out was a real bug:
  // photos live at card-art/sets/{set}/photos/{id}{ext}, so a card rendered
  // without it resolved every photo into the 2026-27 set's directory no matter
  // which set was on screen. It went unnoticed for as long as it did because
  // 2026-27 is `resolvePhotoUrl`'s default and was the only set with any
  // curated photos in it — the first photo dropped on any OTHER set listed as
  // present (the /__studio/state scan IS per set) and then rendered as a hole,
  // which is exactly how the WNBA set's one photo behaved.
  const photoUrl = resolvePhotoUrl({
    playerId: card.id,
    hasPhoto,
    personId: card.personId ?? null,
    version: photoVersion,
    set,
    ext: photoExt,
  });

  // The printed rows, and the rule the arrow sits on within them — searched
  // together so they cannot disagree. See visibleTiers and findShotLineBoundary.
  const chart = visibleTiers(card.chart, set);
  const shotLineRow = findShotLineBoundary(chart, card.shotLine);

  // THE BADGE IS BOTH QUESTIONS AT ONCE, and that union is the whole model.
  // A set may badge EVERY card in it (the two special sets do); a CARD may
  // carry badge ids of its own (140 of the 2026-27 pool do, because their best
  // or first season is the one that set is built from, so the Super Season and
  // Rookie sets have no card for them — see card-data/generated/card-badges.json).
  // pickBadge resolves the union to the ONE that prints, in badges.js's declared
  // priority order: Rookie before Super Season, because the 33 cards that carry
  // both are by definition rookies and "his best season" says nothing about a
  // player who has had exactly one.
  //
  // AND THE SALARY TIERS IT. `super-season` under SUPER_SEASON_MIN_SALARY comes
  // back as `best-season` — a plainer label in the team's accent instead of the
  // gold — which is why the salary is passed here and to `cardTreatment` above
  // and nowhere else: one comparison, in badges.js, asked twice.
  const badge = pickBadge(
    [setBadge(set), ...(Array.isArray(card.badges) ? card.badges : [])],
    card.salary
  );
  // The season, by contrast, IS purely a set question. A base-set record
  // carries no seasonLabel at all, and a 2025-26 legend card has its season
  // drawn into the hand-made art, so gating on the data instead of the set
  // would print a second season over the top of 23 finished cards. A badged
  // 2026-27 card does NOT gain one: the card is this season by definition, and
  // "keep the 26-27 design and just add the badge" is what was asked for.
  const season = showsSeason(set);
  // AND THAT IS EXACTLY WHEN THE PILL HAS TO CARRY THE YEAR ITSELF. A card with
  // no season row leaves the badge as the only place a year could appear, so
  // the badge is handed the set's stats season and dates itself if it can:
  // "25-26 ROOKIE" here, plain "ROOKIE" on a Rookie-set card whose own season
  // row sits one line below it. The SUPER SEASON pill has no dated form — see
  // badges.js — so this changes nothing for the other 107. Passing null when a
  // season IS printed is what keeps the year from being said twice.
  const label = badgeLabel(badge, season ? null : setStatsSeason(set));

  // THE AWARDS ARE PURELY A CARD PROPERTY — no set declares one, and no set
  // could: an award is a fact about the SEASON a card's numbers came from, and
  // the sets that can carry marks carry a different season on every card. The
  // generator resolves which season that is (scripts/cardgen/generateAwards.js);
  // by the time a record reaches here it holds the codes and nothing else.
  //
  // A LIST, NOT A CHOICE, which is the one structural difference from the badge
  // directly below it. Shai Gilgeous-Alexander won MVP and Clutch Player of the
  // Year in the same season and a rule that printed one of them would be
  // throwing away the fact the mark exists for. `pickAwards` orders them by
  // importance and caps the row at what the 135px bar can hold. See awards.js.
  const awards = pickAwards(card.awards);

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
        // Same argument, same theme: an award is a fact about a player's
        // season, so the foil must not gild the chip and the green must not
        // repaint it. Emits nothing at all when this card has no marks.
        ...awardVars(base, awards),
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
      <LeagueMark league={league} />

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
        {/* ABOVE THE BADGE, which is where the user put them: "I'd like to add
          * them to the sidebar above the badges if a player won them." The
          * column is bottom-anchored, so this row pushes the stack upward and
          * moves nothing below it — a card that wins nothing is byte-identical
          * to what it was before this row existed, exactly as a card with no
          * badge is.
          *
          * And the order reads downward as it should: what he WON, then what
          * KIND of card this is, then WHICH season, then the team. Each line is
          * more general than the one above it. */}
        {awards.length > 0 && (
          <div className={styles.awards}>
            {awards.map(award => (
              <AwardMark key={award.code} award={award} count={awards.length} />
            ))}
          </div>
        )}
        {badge && <div className={styles.badge}>{label}</div>}
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
 * Every path this asset could actually be on disk at, DECLARED ONE FIRST.
 *
 * ── THE PROBLEM ─────────────────────────────────────────────────────────────
 *
 * The user's question: "Can we really only do pngs? I thought we changed
 * things to be able to use other formats." He was half right, and the half he
 * was right about is the half that had already bitten once. PLAYER PHOTOS
 * accept six formats, because a `.avif` he had saved by hand was silently
 * invisible until they did. TEAM LOGOS and AWARD MARKS did not: their paths
 * are spelled in data — `/logos/CLE.png`, `/awards/MVP.png` — and `logoSrc`
 * passes the spelling straight through, so a file saved as `.webp` resolves to
 * nothing and falls back to a lettered chip that looks like a design decision.
 *
 * ── WHY A PROBE AND NOT A MANIFEST ──────────────────────────────────────────
 *
 * The photos' answer was a SERVER SCAN: the studio plugin reads the directory
 * and reports the real extension per player, and the browser is told. That
 * answer does not transfer, and the reason is where these files live. Photos
 * are under card-art/, outside public/, and are served by the studio plugin —
 * which is `apply: 'serve'` and therefore DEV ONLY. Logos and awards are under
 * public/, served by Vite itself in dev and copied verbatim into dist/ by
 * `vite build`. A scan endpoint would fix the studio and leave the built app
 * and the batch export exactly as broken as they are now, which is the half of
 * this that a dev-only fix would miss.
 *
 * A build-time manifest would cover both, and costs more than it is worth here:
 * it has to be regenerated or the dev server restarted every time the user
 * drops a file, and he curates these WHILE the studio is open. This asks the
 * browser instead, which is the one participant that is always present and
 * always right: try the declared path, and on error try the same stem under
 * every other format this build accepts before giving up. Dev, production
 * build and any browser-driven export all behave identically, and a file
 * swapped on disk is picked up on the next render with nothing to invalidate.
 *
 * The cost is one 404 per format skipped, against a local static server, only
 * for a file that is not where the data said it was. There is deliberately NO
 * memo of what resolved: the user replaces these files as he works — DPOY.avif
 * became DPOY.jpg during the session this was written — and a cache would hold
 * a dead URL until reload in exactly the workflow this exists to serve.
 *
 * DECLARED FIRST, ALWAYS. Every team logo is a `.png` and the data says so, so
 * the common path costs nothing extra; and where the data names something else
 * — `/logos/WNBA/HOU.gif`, the Comets' wordmark, the one non-PNG in the
 * directory — that spelling is still tried before any substitute, so a format
 * NOT on IMAGE_EXTENSIONS keeps working exactly as it did.
 *
 * Bare and root-relative, like the paths it is derived from: `logoSrc` puts the
 * app's base path on, and this must not do it twice. A path with no extension
 * has nothing to vary and comes back alone.
 */
export function assetCandidates(path) {
  if (typeof path !== 'string' || path === '') return [];
  const dot = path.lastIndexOf('.');
  if (dot <= path.lastIndexOf('/')) return [path];
  const stem = path.slice(0, dot);
  const declared = path.slice(dot).toLowerCase();
  return [path, ...IMAGE_EXTENSIONS.filter(ext => ext !== declared).map(ext => `${stem}${ext}`)];
}

/**
 * An <img> for a public/ asset, in whatever format it was actually saved, with
 * a DESIGNED fallback when it is in none of them.
 *
 * The three marks on a card — league, team, award — each used to hold their own
 * `failed` boolean and their own `onError`, and each would give up on the first
 * miss. They now share this, which is what makes "any format" one rule rather
 * than three copies of one: `onError` steps to the next candidate and only the
 * exhausted end of the list reaches `fallback`.
 *
 * THE FALLBACK IS NOT A PLACEHOLDER. A missing file has to look deliberate: no
 * browser broken-image glyph may ever reach the batch export, and a lettered
 * chip in the same slot at the same size means nothing in the column shifts
 * when real art lands on top of it.
 *
 * The counter is reset DURING RENDER when `path` changes, rather than in an
 * effect. React documents this for derived state, and it is load-bearing here:
 * the studio swaps one card for another under the same mounted tree, so without
 * it a new team's logo would inherit the previous team's exhausted counter and
 * draw a lettered circle over a file that exists.
 */
function AssetImage({ path, alt, className, fallback }) {
  const [tried, setTried] = useState({ path, index: 0 });
  const index = tried.path === path ? tried.index : 0;
  if (tried.path !== path) setTried({ path, index: 0 });

  const src = logoSrc(assetCandidates(path)[index]);
  if (!src) return fallback;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setTried({ path, index: index + 1 })}
    />
  );
}

/**
 * The league mark's file, the one logo that is not a team's.
 *
 * Lives next to the team logos in public/logos/ and is resolved through the
 * same logoSrc(), so it picks up the app's base path like everything else.
 * The `.png` here is the SPELLING TRIED FIRST rather than a requirement — see
 * assetCandidates.
 */
export const LEAGUE_LOGO = '/logos/NBA.png';

/**
 * The mark for each league a set can belong to.
 *
 * LEAGUE_LOGO stays exported and stays the NBA's: logoFiles.test.js asserts
 * its aspect ratio, and every set that existed before the WNBA arrived resolves
 * to it through DEFAULT_LEAGUE.
 */
export const LEAGUE_LOGOS = {
  NBA: LEAGUE_LOGO,
  // Supplied by the user, and kept inside public/logos/WNBA/ alongside that
  // league's team marks rather than beside NBA.png — the directory is what
  // separates the two leagues' files everywhere else, and the league mark is
  // not an exception to that.
  //
  // 380x905 (0.42:1), which is the shape .leagueMark's 28x63 box wants; the NBA
  // file is 0.44:1. logoFiles.test.js holds both to it.
  WNBA: '/logos/WNBA/WNBA.png',
};

/**
 * The class list for the LETTERED league fallback, which is a four-letter
 * problem and not a three-letter one.
 *
 * The box is 28px wide, MEASURED off the printed art for the three letters of
 * "NBA"; "WNBA" at the same size spills over the band's left edge. Exported
 * because the fallback is no longer reachable from a render — every declared
 * league now has a real mark file, so the only way to see it is an <img> that
 * fails to load at runtime, which static markup cannot produce. The rule it
 * encodes still has to be pinned, so it is pinned here rather than deleted
 * along with the render path that used to reach it.
 */
export function leagueMarkFallbackClass(league, sheet = styles) {
  const wide = String(league ?? '').length > 3 ? ` ${sheet.leagueMarkFallbackWide}` : '';
  return `${sheet.leagueMarkFallback}${wide}`;
}

/**
 * The league mark in the card's top-left corner.
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
function LeagueMark({ league = 'NBA' }) {
  // `??` would be wrong: a declared league whose mark file is missing stores
  // null, and `??` would quietly hand it the NBA's — an NBA mark on a WNBA card
  // is a factual error printed on the face of it, and worse than no mark at
  // all. Own-property lookup separates "this league has no art" from "this is
  // not a league I know".
  const path = Object.hasOwn(LEAGUE_LOGOS, league) ? LEAGUE_LOGOS[league] : LEAGUE_LOGO;
  return (
    <AssetImage
      path={path}
      alt={league}
      className={styles.leagueMark}
      fallback={<div className={leagueMarkFallbackClass(league)}>{league}</div>}
    />
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
  return (
    <AssetImage
      path={team.logo}
      alt={team.name}
      className={styles.logo}
      fallback={<div className={styles.logoFallback}>{abbr ?? ''}</div>}
    />
  );
}

/**
 * One award mark, with a LETTERED CHIP fallback.
 *
 * ── THE FALLBACK IS THE FEATURE UNTIL THE FILE IS NAMED RIGHT ───────────────
 *
 * public/awards/ is filling up, and the files are in four different formats —
 * .avif, .webp, .jpg, .jfif — which is why AssetImage probes rather than
 * assuming. What it CANNOT do is guess a different stem: the code is the
 * filename, so the All-Star mark is `AS.…` and a file called `All-Star.webp` is
 * a file nothing asks for.
 *
 * So the chip still matters, and it is drawn in the same slot at the same size:
 * nothing in the column moves when a real trophy lands on top of it, and no
 * browser broken-image glyph can ever reach the batch export.
 *
 * ── WHY A CODE AND NOT NOTHING ──────────────────────────────────────────────
 *
 * The alternative was to render nothing at all until the art exists, and it is
 * the wrong one for a reason the team logos already demonstrated: a feature
 * that renders nothing is indistinguishable from a feature that is broken, and
 * every card in every set would look untouched while the join, the priority
 * order, the cap and the season selection all went unverified. "MVP" in a chip
 * is also not a placeholder — it is the label the user named the awards by, so
 * a card that never gets art is still a card that says what he won.
 *
 * The chip's two colours are the BEST SEASON pill's, derived rather than
 * chosen, and swept over all thirty-seven franchises on treated and untreated
 * fields in treatments.test.js. See `awardColors` in awards.js.
 *
 * EXPORTED FOR THE SAME REASON leagueMarkFallbackClass is: the fallback cannot
 * be reached from a static render of a CARD. `onError` needs a real fetch, and
 * markup rendered to a string never makes one — so the only way to test the
 * thing the user is actually looking at today is to render this component with
 * an award that has no path at all. See CardTemplate.test.js.
 */
export function AwardMark({ award, count = 1 }) {
  const slot = `${styles.awardSlot}${awardSizeClass(count, 'awardSlot')}`;
  const chip = `${styles.awardFallback}${awardSizeClass(count, 'awardFallback')}`;
  return (
    <div className={slot}>
      <AssetImage
        path={awardImagePath(award.code)}
        alt={award.name}
        className={styles.award}
        fallback={
          <div className={chip} title={award.name}>
            {award.code}
          </div>
        }
      />
    </div>
  );
}

/**
 * The size modifier for a row of `count` marks, or '' for the base size.
 *
 * ── THE COUNT IS A CLASS, NOT AN INLINE STYLE ──────────────────────────────
 *
 * Every dimension on this card is declared in the stylesheet and measured back
 * out of it by the test suite — that is how raising a type size fails in
 * CardTemplate.test.js instead of silently pushing the logo out through the top
 * of the sidebar. Inline `style={{ height: … }}` would put three numbers
 * somewhere no CSS-reading test can see them, and the award block is now the
 * TALLEST optional row in the column, so it is the last one that should
 * disappear from that arithmetic.
 *
 * ONE AND TWO ARE THE MODIFIERS; three and four take the base rule. That is not
 * arbitrary — three and four are the two counts that WRAP, and a wrapped row is
 * two lines of the same slot whichever it is, so they are one case and not two.
 * A count past MAX_CARD_AWARDS cannot reach here (`pickAwards` caps it) and
 * would take the base size if it did, which is the safe direction.
 */
export function awardSizeClass(count, base, sheet = styles) {
  if (count === 1) return ` ${sheet[`${base}One`]}`;
  if (count === 2) return ` ${sheet[`${base}Two`]}`;
  return '';
}

function Boost({ label, value }) {
  return (
    <div className={styles.boost}>
      <div className={styles.boostLabel}>{label}</div>
      <div className={styles.boostValue}>{formatBoost(value)}</div>
    </div>
  );
}
