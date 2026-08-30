// The Card Studio's player list: where the records come from, and every pure
// operation the list UI performs on them.
//
// TWO SOURCES, and each one IS a set — that is the only thing a label here is
// allowed to leave ambiguous, because it already went wrong once:
//
//  - `pool` (the default) is the 2026-27 SET — the one being built right now,
//    the one every photo and crop in this tool belongs to, and the editable
//    one. Its 350 players always have names, teams and positions; they also
//    carry a full PROVISIONAL stat line — chart, Speed/Power, Shot Line, boosts
//    and salary — whenever `node scripts/cardgen/generateCards.js` has been run.
//    Before that they render placeholders, which is still a usable studio: the
//    photo is the thing being judged.
//
//  - `cards` is the 2025-26 SET — finished, printed, 306 cards, and the only
//    data with every field populated. It is here so the template can be judged
//    with real numbers in place, and for nothing else. READ-ONLY: nothing
//    curated against it belongs to the new set (see `editable` below).
//
// WHY THE LABELS SAY WHAT THEY SAY. A set is named for the season it will be
// PLAYED in; the stats printed on it come from the season before. So the
// 2026-27 set is built from 2025-26 stats, exactly as the finished 2025-26 set
// was built from 2024-25 stats. This toggle used to lead with the STATS season
// — "2025-26 pool" — which reads as the old set, and the user concluded they
// could not edit the set they were building. The stats season is now subtext
// and hover text; the primary label names the SET.
//
// The pool JSON is imported, not fetched: Vite handles JSON natively, so the
// list is present on first paint instead of arriving a round trip later, and a
// missing/renamed file becomes a build error rather than an empty studio.
import rawPool from '../../card-data/generated/player-pool-2026.json';
import { CARDS } from '../game/cards.js';
import {
  CURRENT_SET,
  STATS_SEASON,
  FINISHED_SET,
  FINISHED_STATS_SEASON,
  SUPER_SEASON_SET,
  ROOKIE_SET,
  WNBA_SET,
  WNBA_SUPER_SEASON_SET,
  getSet,
} from '../cards/sets.js';
import { playerIdFromName } from '../cards/playerId.js';

/**
 * The team-resolved pool, when `node scripts/cardgen/generateTeams.js` has been
 * run. PREFERRED over the raw pool, for two reasons:
 *
 *  - 46 of the 350 raw records carry Basketball-Reference's "2TM"/"3TM"
 *    mid-season-trade aggregate codes, which are not teams. Every one of those
 *    cards rendered on the neutral grey fallback with no logo and no colors.
 *    The resolved file replaces them with the player's real current team.
 *  - It carries `personId`, nba.com's player id, which is the ONLY thing that
 *    makes the headshot fallback (see src/cards/photo.js) work for a pool
 *    player who has no curated photo yet.
 *
 * import.meta.glob rather than a plain import so an absent file degrades to the
 * raw pool instead of breaking the studio: this file is GENERATED, and a
 * checkout that has never run the generator (or a season whose generator has
 * not been re-run yet) must still open a usable studio. Eager, so the list is
 * still there on first paint.
 */
const resolvedModules = import.meta.glob('../../card-data/generated/player-teams-2026.json', {
  eager: true,
});
const resolvedPool = Object.values(resolvedModules)[0]?.default ?? null;

/** True when the studio is showing real resolved teams rather than raw codes. */
export const TEAMS_RESOLVED = resolvedPool !== null;

/**
 * The raw pool with resolved records OVERLAID — not replaced by them.
 *
 * The resolved file is deliberately shorter than the pool: the generator emits
 * only players it could give a real team, which today leaves 4 out (they are on
 * no active roster AND carry an aggregate code, so no source knows their team).
 * Taking the resolved file as the list would quietly drop those 4 from a
 * 350-player set — the user would simply never be offered them to photograph.
 *
 * So the pool stays the spine and resolution is an overlay. The unresolved few
 * keep their raw "2TM" code and go on rendering the neutral fallback theme,
 * which is the correct signal: those are the cards still needing a human
 * decision, and they should look unfinished until they get one.
 *
 * Keyed by `name` because that is what the generator copies through verbatim.
 */
const resolvedByName = new Map((resolvedPool ?? []).map(p => [p.name, p]));
const pool = rawPool.map(p => ({ ...p, ...(resolvedByName.get(p.name) ?? {}) }));

// The id rule itself lives in src/cards/playerId.js and is re-exported here so
// every existing importer keeps working. It moved because the Node card
// generators need the SAME rule — cards-2026-27.json is keyed by it, and the
// studio joins those stats onto a player it may already hold a photo for — and
// they cannot import this module (JSON imports, import.meta.glob). One rule that
// names photo files, in one place.
// Imported as well as re-exported: a bare `export ... from` does not bind the
// name locally, and POOL_PLAYERS below calls it.
export { playerIdFromName };


/**
 * The generated 2026-27 stat lines, when `node scripts/cardgen/generateCards.js`
 * has been run.
 *
 * Same import.meta.glob treatment as the resolved-teams file above, for the same
 * reason: this file is GENERATED and gitignore-free but not guaranteed present,
 * and a checkout that has never run the generator must still open a studio you
 * can curate photos in. Eager, so the numbers are on the card at first paint
 * rather than one repaint later.
 *
 * Every value in it is PROVISIONAL — synthesized charts, refitted Shot Line and
 * boosts (see scripts/cardgen/variance.js). The studio says so on screen, and
 * this is why: numbers that look finished get trusted, and these are a first
 * pass to react to, not a set to sign off.
 */
const generatedModules = import.meta.glob('../../card-data/generated/cards-2026-27.json', {
  eager: true,
});
const generatedFile = Object.values(generatedModules)[0]?.default ?? null;
const generatedCards = generatedFile?.cards ?? null;

/** True when the studio is rendering generated stats rather than placeholders. */
export const STATS_GENERATED = Array.isArray(generatedCards) && generatedCards.length > 0;

/**
 * Keyed by ID, not by name, because the id is what both sides already agree on:
 * the generator derives it with src/cards/playerId.js and so does this file, and
 * it is the same key the photo store uses. Matching on the raw name would work
 * today and break the first time a source spells one differently.
 */
const generatedById = new Map((generatedCards ?? []).map(c => [c.id, c]));

/**
 * The stat fields a generated card contributes, listed rather than spread.
 *
 * An `{...pool, ...card}` spread would look equivalent and would not be: the
 * generated record also carries `name`, `team` and `pos`, and letting those
 * through would put the generator's snapshot of a roster on screen instead of
 * the studio's own resolved one — silently reverting a team the user fixed in
 * card-data/manual-teams.json. Stats come from the stat file; identity stays
 * with the pool.
 */
const STAT_FIELDS = [
  'speed',
  'power',
  'shotLine',
  'paintBoost',
  'threePtBoost',
  'defBoost',
  'salary',
  'chart',
];

/**
 * The base set's CARD-TYPE BADGES, when generateSpecialSets.js has been run.
 *
 * Same import.meta.glob treatment as the two files above, for the same reason:
 * generated, not guaranteed present, and a checkout without it must still open
 * a studio you can curate photos in — it simply shows no pills.
 *
 * ── WHY A BADGE IS ON THE CARD AND NOT ON THE SET ───────────────────────────
 *
 * A player whose best season is the one this set is built from gets NO card in
 * the Super Season set: his base card already is that season. The exclusion is
 * right and it stays — but it used to be the end of the story, so nothing on
 * any card said that 149 players had just had the best year of their careers.
 * The fact now rides onto the base card as a badge. Same for the 33 whose
 * rookie season is the current one. "If last year was their super season, keep
 * the 26-27 design and just add the badge", in the user's words — so the pill
 * is all these cards gain: no treatment, no season line.
 *
 * THE SET IS CHECKED, not assumed. The file names the set it was generated for,
 * and a stale one from another season degrades to no badges rather than badging
 * the wrong 149 players.
 */
const badgeModules = import.meta.glob('../../card-data/generated/card-badges.json', {
  eager: true,
});
export const BADGE_FILE = Object.values(badgeModules)[0]?.default ?? null;

const badgesById = new Map(
  BADGE_FILE?.set === CURRENT_SET && Array.isArray(BADGE_FILE.badges)
    ? BADGE_FILE.badges.map(b => [b.id, b.badges])
    : []
);

/** True when the studio is showing the base set's badges. */
export const BADGES_GENERATED = badgesById.size > 0;

function withGeneratedStats(player) {
  const card = generatedById.get(player.id);
  if (!card) return player;
  const stats = {};
  for (const field of STAT_FIELDS) {
    if (card[field] !== undefined && card[field] !== null) stats[field] = card[field];
  }
  return { ...player, ...stats, provisional: true };
}

/** The pool, shaped like a card. Missing stats stay missing. */
export const POOL_PLAYERS = pool.map(p => ({
  id: playerIdFromName(p.name),
  name: p.name,
  team: p.team,
  pos: p.pos,
  games: p.games,
  mpg: p.mpg,
  // Present only on the resolved file. `?? null` rather than left undefined so
  // the field always exists and resolvePhotoUrl's `if (personId)` reads the
  // same either way.
  personId: p.personId ?? null,
  // EVERY badge that is true of this player, in priority order — not the one
  // that prints. CardTemplate resolves that with pickBadge, so the rule lives
  // in one place and re-prioritising needs no regeneration. Always an array, so
  // nothing downstream has to test for the file's absence.
  badges: badgesById.get(playerIdFromName(p.name)) ?? [],
  // Chart / Speed / Power / Shot Line / boosts / salary arrive from
  // cards-2026-27.json when it exists. When it does not, they stay absent and
  // CardTemplate renders a placeholder for each — never a crash, never a zero
  // pretending to be a rating.
})).map(withGeneratedStats);

/** The shipped 306-card set, already in card shape. */
export const CARD_PLAYERS = CARDS;

/**
 * The two computable SPECIAL sets — Super Season and Rookie.
 *
 * Same import.meta.glob treatment as the generated files above, and for a
 * sharper version of the same reason: these rosters take a five-minute polite
 * scrape of twenty-seven Basketball-Reference season tables to produce
 * (scripts/cardgen/fetchHistory.js) and are then generated by
 * scripts/cardgen/generateSpecialSets.js. A checkout that has neither must
 * still open a studio the base set can be curated in, so a missing file
 * degrades to an EMPTY set rather than a build error — and the studio says so
 * on the selector, because an empty list with no explanation reads as a bug.
 *
 * Their records are already in card shape: the generator writes the same
 * fields, with `season`/`seasonLabel` added, so nothing has to be reshaped
 * here the way the pool does.
 */
const specialModules = import.meta.glob(
  '../../card-data/generated/cards-{super-season,rookie,wnba,wnba-super-season}.json',
  { eager: true }
);

function loadSpecialSet(id) {
  for (const mod of Object.values(specialModules)) {
    const file = mod?.default;
    if (file?.set === id && Array.isArray(file.cards)) return file;
  }
  return null;
}

export const SUPER_SEASON_FILE = loadSpecialSet(SUPER_SEASON_SET);
export const ROOKIE_FILE = loadSpecialSet(ROOKIE_SET);
export const WNBA_FILE = loadSpecialSet(WNBA_SET);
export const WNBA_SUPER_SEASON_FILE = loadSpecialSet(WNBA_SUPER_SEASON_SET);

const byName = (a, b) => a.name.localeCompare(b.name);

/**
 * One source entry for a generated special set.
 *
 * `label` composes the set's declared name with the list's own length, exactly
 * as the two season sets do, so neither the name nor the count can drift from
 * what the tool is actually holding. `sub` carries the provenance, which for
 * these sets is the thing most worth saying out loud: every number on them is
 * a Basketball-Reference substitute for a stat that does not exist before this
 * season.
 */
/**
 * `missingHint` is a parameter because the sets no longer share a generator.
 * Super Season and Rookie come out of fetchHistory + generateSpecialSets; the
 * WNBA set comes out of its own three-step pipeline, and telling someone to run
 * the wrong script is worse than telling them nothing.
 */
const HISTORY_MISSING_HINT =
  '`node scripts/cardgen/fetchHistory.js` then `node scripts/cardgen/generateSpecialSets.js`';

function specialSource(id, file, { sub, hint, missingHint = HISTORY_MISSING_HINT }) {
  const declared = getSet(id);
  const players = [...(file?.cards ?? [])].sort(byName);
  return {
    key: id,
    set: id,
    label: `${declared?.name ?? id} · ${players.length} cards`,
    sub: file ? sub : 'not generated yet',
    editable: declared?.editable !== false,
    hint: file
      ? hint
      : `card-data/generated/cards-${id}.json is missing — run ${missingHint}. ` +
        'Until then this set is empty.',
    players,
  };
}

/**
 * The two lists, each labelled with the SET it is.
 *
 * `label` is the whole primary string, count included, composed from the
 * constants in sets.js and from the lists themselves — so neither the season a
 * label claims nor the number it quotes can drift from what the tool actually
 * holds.
 *
 * `sub` carries the stats season, and it is subtext ON PURPOSE. That fact —
 * true, and the reason the two seasons differ — is what made the old label
 * unreadable when it led. It belongs one size down, or in `hint` on hover.
 *
 * `editable` is not decoration. Both lists derive player ids with the same
 * rule and both render against the same photo store, so a photo dropped while
 * the reference set is on screen would land in the 2026-27 set under whatever
 * id that 2025-26 player happens to share. The reference set exists to be
 * looked at; the studio enforces that.
 */
export const SOURCES = {
  pool: {
    key: 'pool',
    // The SET these records belong to, not a label. CardTemplate reads it to
    // decide whether rows that produce nothing are printed — see hidesEmptyRows.
    set: CURRENT_SET,
    label: `${CURRENT_SET} set · ${POOL_PLAYERS.length} players`,
    sub: STATS_GENERATED
      ? `${STATS_SEASON} stats · provisional numbers`
      : `built from ${STATS_SEASON} season stats`,
    editable: true,
    hint:
      `THE SET YOU ARE BUILDING. Every player getting a card this cycle, and the only list you ` +
      `can edit — photos and crops save into the ${CURRENT_SET} set. ` +
      `Its stats come from the ${STATS_SEASON} season, because a set is named for the season it ` +
      `will be played in and printed with the numbers from the season before.` +
      (BADGES_GENERATED
        ? ` ${badgesById.size} of them carry a card-type badge, because their best or rookie ` +
          'season is the one this set is built from — so the separate set has no card for them ' +
          'and the fact is printed here instead.'
        : '') +
      (STATS_GENERATED
        ? ' The numbers on these cards are a PROVISIONAL first pass — charts synthesized from ' +
          'season rates, Shot Line and boosts refitted against the finished set. Re-run ' +
          '`node scripts/cardgen/generateCards.js` after changing anything upstream.'
        : ' No numbers yet — run `node scripts/cardgen/generateCards.js` to fill them in.'),
    players: [...POOL_PLAYERS].sort(byName),
  },
  cards: {
    key: 'cards',
    set: FINISHED_SET,
    label: `${FINISHED_SET} set · ${CARD_PLAYERS.length} cards (reference)`,
    sub: 'finished — template preview only',
    editable: false,
    hint:
      `THE FINISHED ${FINISHED_SET} SET, already printed (its stats came from the ` +
      `${FINISHED_STATS_SEASON} season, one year back, for the same reason). ` +
      `Here for one reason: it is the only data with every chart, Speed/Power and salary filled in, ` +
      `so the template can be judged with real numbers. Read-only — nothing you do here becomes ` +
      `part of the ${CURRENT_SET} set.`,
    players: [...CARD_PLAYERS].sort(byName),
  },
  // ── The special sets ──────────────────────────────────────────────────────
  //
  // Keyed by their SET ID rather than by a nickname, unlike `pool` and `cards`
  // above, whose keys are historical and kept only because everything already
  // refers to them. A new set's key IS its id, so `SOURCES[id].set === id` and
  // there is nothing to keep in step.
  [SUPER_SEASON_SET]: specialSource(SUPER_SEASON_SET, SUPER_SEASON_FILE, {
    sub: `best season per player · ${SUPER_SEASON_FILE?.excludedCount ?? 0} badged instead`,
    hint:
      'EACH ACTIVE PLAYER\'S BEST INDIVIDUAL SEASON, chosen on Basketball-Reference\'s BPM, ' +
      'scored against its own season\'s league. Win Shares is deliberately NOT in it: it ' +
      'allocates team wins, so it docks a good player on a bad team. A player whose best ' +
      `season is the CURRENT one gets no card here — his base card already is that season — but ` +
      `his ${CURRENT_SET} card now carries a SUPER SEASON badge instead, so the fact is on a ` +
      'card rather than only in a file. Every number is provisional and more so than the base ' +
      'set — EPM, Estimated Wins and rim FG% do not exist for past seasons, so BPM and 2P% ' +
      'stand in for them. Re-run `node scripts/cardgen/generateSpecialSets.js`.',
  }),
  [ROOKIE_SET]: specialSource(ROOKIE_SET, ROOKIE_FILE, {
    sub: `rookie-year cards · ${ROOKIE_FILE?.excludedCount ?? 0} badged instead`,
    hint:
      'EACH ACTIVE PLAYER\'S ROOKIE SEASON, on the team he played it for — which is why some of ' +
      'these say SEA or NJN. A player whose rookie year IS the current season gets no card ' +
      'here, the same rule and the same reason as the Super Season set, and the same ' +
      `consolation: a badge on his ${CURRENT_SET} card. In practice every one of those players ` +
      'is ALSO having his best season — a first season is the only season — and Super Season ' +
      'outranks Rookie, so what they actually print is the gold pill. Same ' +
      'Basketball-Reference substitutions, same provisional numbers.',
  }),
  // A different LEAGUE, which is the third kind of thing a set can be. It is
  // listed here rather than in a second selector because everything the studio
  // does to it — photos, crops, team colours, the card preview — is identical.
  [WNBA_SET]: specialSource(WNBA_SET, WNBA_FILE, {
    // The force-include COUNT is read off the payload rather than written out.
    // It was a literal "plus 6 named", and the first time the user added a
    // player the label went stale while the card count beside it updated —
    // two numbers from one file disagreeing on screen. Both come from the file
    // now.
    sub:
      `${WNBA_FILE?.statsSeason ?? '2026'} season · ` +
      `MPG>=${WNBA_FILE?.poolRule?.minMpg ?? 16} & G>=${WNBA_FILE?.poolRule?.minGames ?? 20}` +
      `, plus ${WNBA_FILE?.forced?.length ?? 0} named`,
    hint:
      'THE WNBA SET, built from the 2026 Basketball-Reference WNBA tables. Two things about it ' +
      'are unlike every other set here. FIRST, the WNBA has no BPM, OBPM, DBPM or VORP anywhere ' +
      '— nothing publishes a plus/minus estimate for it — so the Speed+Power budget and the Def ' +
      'Boost run on a BPM EQUIVALENT fitted on fifteen NBA seasons using only the inputs the ' +
      'WNBA pages also carry, every input centred on its own league. SECOND, a WNBA game is 40 ' +
      'minutes and the league plays slower, so a four-minute section is 7.92 possessions rather ' +
      "than the NBA's 8.33 — every chart on every card is scaled by that. Six players are " +
      'carded on 2025 AND 2026 pooled by volume, because their 2026 seasons were injury-' +
      'shortened and Basketball-Reference publishes the prior WNBA season in full. Teams are ' +
      "resolved against wnba.com's live roster, so a player who moved shows her CURRENT club " +
      'rather than the TOT aggregate her stat row carries. Re-run ' +
      '`node scripts/cardgen/wnba/generateWnbaCards.js`.',
    missingHint:
      '`node scripts/cardgen/wnba/fetchWnba.js`, `node scripts/cardgen/wnba/fitBpmModel.js` ' +
      'then `node scripts/cardgen/wnba/generateWnbaCards.js`',
  }),
  // BOTH a card type and a league, which is why it is its own set rather than
  // rows added to either of the two above. Its roster is also the only NAMED
  // one in the tool — sixteen players the user asked for, not a threshold.
  [WNBA_SUPER_SEASON_SET]: specialSource(WNBA_SUPER_SEASON_SET, WNBA_SUPER_SEASON_FILE, {
    sub: `${WNBA_SUPER_SEASON_FILE?.firstSeason ?? 1997}-${WNBA_SUPER_SEASON_FILE?.lastSeason ?? 2024} · named roster`,
    hint:
      'SIXTEEN RETIRED WNBA GREATS, each on her best individual season — the Super Season ' +
      'question asked of the WNBA. Three things about it differ from every other set here. ' +
      'FIRST, the roster is a NAMED LIST (card-data/wnba-legends.json), not a threshold: no ' +
      'rule can add a seventeenth player or drop one of the sixteen. SECOND, the WNBA publishes ' +
      'no BPM in any season, so the best season is chosen on the FITTED BPM equivalent, rated ' +
      'against her own season\'s league — the run reports how far back that can honestly be ' +
      'applied, and the answer is in the file\'s `audit` block. THIRD, the shooting numbers are ' +
      'ERA-SHIFTED onto the current league\'s scale, because this set spans 1997 to 2024 and a ' +
      '1997 true-shooting percentage compared with 2026 would read as a bad shooter rather ' +
      'than a different league. Teams resolve THROUGH THE ERA, so Lauren Jackson\'s Storm is ' +
      'hunter green and Diana Taurasi\'s Mercury is Planet Red — several of those franchises ' +
      'have no logo file yet and draw the lettered circle until one arrives. Re-run ' +
      '`node scripts/cardgen/wnba/generateWnbaLegends.js`.',
    missingHint:
      '`node scripts/cardgen/wnba/fetchWnbaHistory.js` then ' +
      '`node scripts/cardgen/wnba/generateWnbaLegends.js`',
  }),
};

export const DEFAULT_SOURCE = 'pool';

/** Accepts an array or a Set of photo ids and returns a Set. */
function asSet(photoIds) {
  if (photoIds instanceof Set) return photoIds;
  return new Set(Array.isArray(photoIds) ? photoIds : []);
}

/**
 * How far through the set the photo curation is.
 *
 * Counts only photos belonging to the ACTIVE source list: the set's photos/
 * accumulates files from both sources, and reporting "310 / 350" because the
 * shipped-card photos were counted too would make the progress number useless.
 */
export function photoProgress(players, photoIds) {
  const have = asSet(photoIds);
  let withPhoto = 0;
  for (const p of players) if (have.has(p.id)) withPhoto += 1;
  return { withPhoto, total: players.length, missing: players.length - withPhoto };
}

/**
 * The visible slice of the list.
 *
 * `missingOnly` is the one that earns its keep across sessions: on session
 * five, "who still needs a photo" is the only question being asked, and
 * scrolling 350 rows looking for hollow dots is not an answer.
 */
export function filterPlayers(players, { query = '', missingOnly = false, photoIds } = {}) {
  const have = asSet(photoIds);
  const q = query.trim().toLowerCase();
  return players.filter(p => {
    if (missingOnly && have.has(p.id)) return false;
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      String(p.team ?? '').toLowerCase().includes(q) ||
      String(p.pos ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * The id `delta` steps away from `currentId` in a list — the keyboard nav.
 *
 * Clamps at both ends rather than wrapping: wrapping from the last player back
 * to the first, mid-session, silently loses your place in a 350-row list.
 *
 * `anchorIndex` is where the selection last WAS in this list, and it carries
 * the main workflow. Filter to "needs photo", drop a photo on someone, and
 * they leave the list on the spot — with no anchor the very next keypress
 * would jump to the top of 350 rows instead of continuing to the next player
 * who needs one. Stepping forward from a vanished row lands on whoever took
 * its place; stepping back lands on the row above it.
 */
export function stepSelection(players, currentId, delta, anchorIndex = 0) {
  if (!players.length) return null;
  const clamp = i => Math.min(Math.max(i, 0), players.length - 1);
  const at = players.findIndex(p => p.id === currentId);
  if (at !== -1) return players[clamp(at + delta)].id;
  const anchor = clamp(anchorIndex);
  return players[clamp(delta > 0 ? anchor : anchor - 1)].id;
}
