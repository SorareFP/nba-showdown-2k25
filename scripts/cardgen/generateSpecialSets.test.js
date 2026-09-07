import fs from 'node:fs';
// The two generated rosters, checked against the rules that define them.
//
// These read the COMMITTED output files rather than regenerating, deliberately:
// the files are what the studio loads and what the user is about to spend hours
// curating photos against, so what is asserted is the artefact, not a fresh run
// of the code that made it. A regeneration that changed the rules would show up
// here as a failing claim about the file on disk.
import { describe, it, expect } from 'vitest';
import { readLegends } from './legends.js';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COMPOSITE_METRIC_SETS,
  COMPOSITE_REPLACEMENT,
  COMPOSITE_WEIGHTS,
  EPM_NAME_ALIASES,
  FULL_SEASON_MINUTES,
  REPLACEMENT_EPM,
  attachEpm,
  badgeCounts,
  loadBaseSalaries,
  historicalComposite,
  indexEpmSeasons,
  resolvePlayerIds,
  rowsById,
  seasonLabel, BEATEN_BY_BASE } from './generateSpecialSets.js';
import {
  BADGE_IDS,
  BEST_SEASON_BADGE,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  pickBadge,
} from '../../src/cards/badges.js';
import { PRINTED_SCALE, REFINEMENT_WEIGHT } from './speedPower.js';
import { LAST_SEASON, FIRST_SEASON, isAggregateTeam, loadPool } from './fetchHistory.js';
import { REPO_ROOT } from './cache.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { TEAMS, HISTORICAL_TEAMS, canonicalTeam } from '../../src/cards/teams.js';
import { CURRENT_SET, ROOKIE_SET, SUPER_SEASON_SET } from '../../src/cards/sets.js';

const readGenerated = name =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', name), 'utf8'));

const read = set => readGenerated(`cards-${set}.json`);

const SUPER = read(SUPER_SEASON_SET);
const ROOKIE = read(ROOKIE_SET);
/** The base set's card-type badges — the two exclusion lists, made printable. */
const BADGES = readGenerated('card-badges.json');
/**
 * The base set's cards, for their SALARIES and nothing else.
 *
 * They belong to generateCards.js, not to this generator, and the badge file
 * reads them for one purpose: `printed` claims what the template will draw, and
 * since the salary tier decides between SUPER SEASON and BEST SEASON, a count
 * computed without them would claim a distribution no card matches.
 */
const BASE = readGenerated(`cards-${CURRENT_SET}.json`);
const SALARIES = new Map(BASE.cards.map(c => [c.id, c.salary]));
const STANDOUTS = JSON.parse(
  readFileSync(path.join(REPO_ROOT, 'card-data', 'summer-standouts.json'), 'utf8')
);
const POOL = loadPool();

/** The scraped archive, when this checkout has one. See the runIf below. */
const HISTORY_FILE = path.join(REPO_ROOT, 'card-data', 'cache', 'bbref-history.json');
const HISTORY = existsSync(HISTORY_FILE)
  ? JSON.parse(readFileSync(HISTORY_FILE, 'utf8')).data
  : null;

describe.each([
  [SUPER_SEASON_SET, SUPER],
  [ROOKIE_SET, ROOKIE],
])('the %s roster', (set, file) => {
  it('names itself, so the studio can tell the two files apart', () => {
    expect(file.set).toBe(set);
    expect(Array.isArray(file.cards)).toBe(true);
    expect(file.cards.length).toBeGreaterThan(100);
  });

  it('says out loud that every number on it is provisional', () => {
    // These cards carry a substitute for a stat that does not exist before this
    // season. A card that renders a complete stat line reads as finished, so the
    // file has to be the thing that disagrees.
    //
    // The list used to be three. EPM and Estimated Wins came off it when the
    // Speed+Power budget stopped being a BPM stand-in and became the base set's
    // own composite on dunksandthrees' 2002-2026 archive; rim FG% is still
    // genuinely absent and 2P% is still standing in for it.
    expect(file.provisional).toBe(true);
    expect(file.sources.missing).toEqual(['rim FG%']);
    expect(file.sources.speedPower).toMatch(/z\(EPM\)/);
    expect(file.sources.speedPower).toMatch(/2002-2026 archive/);
    // Since the real-log rebuild the per-card flag means "synthetic chart",
    // and most of these cards now carry their season's actual games — the
    // flag survives only where no log page could serve.
    const synthetic = file.cards.filter(c => c.provisional === true);
    const real = file.cards.filter(c => c.provisional === false);
    expect(synthetic.length + real.length).toBe(file.cards.length);
    expect(real.length).toBeGreaterThan(synthetic.length);
  });

  it('gives every card a photo id no other card in the set shares', () => {
    // The id names the photo file. Two cards sharing one would be two players
    // curating over each other.
    const ids = file.cards.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const card of file.cards) {
      expect(card.id).toBe(playerIdFromName(card.name));
      expect(card.id).toMatch(/^[A-Za-z0-9_.-]+$/);
    }
  });

  it('gives every card a season the card can print', () => {
    for (const card of file.cards) {
      expect(card.season, card.name).toBeGreaterThanOrEqual(
        // 1977, not 1987: the force-included LEGENDS reach back to Kareem's
        // and Julius Erving's 1976-77, and the 1970s tables are cached to
        // carry them. (The standout newcomers alone only reached Rodman's
        // 1986-87 debut, which is what this floor used to encode.)
        1977
      );
      expect(card.season, card.name).toBeLessThan(LAST_SEASON);
      expect(card.seasonLabel).toBe(seasonLabel(card.season));
    }
  });

  it('gives every card a team the theming knows, never an aggregate code', () => {
    // A "2TM" card renders on the neutral grey fallback with no colours and no
    // logo, which is exactly the look these sets exist to avoid.
    for (const card of file.cards) {
      expect(isAggregateTeam(card.team), `${card.name} ${card.team}`).toBe(false);
      const key = canonicalTeam(card.team);
      const known = Object.hasOwn(TEAMS, key) || Object.hasOwn(HISTORICAL_TEAMS, key);
      expect(known, `${card.name} on ${card.team}`).toBe(true);
    }
  });

  it('gives every card a complete, printable stat line', () => {
    for (const card of file.cards) {
      expect(card.speed, card.name).toBeGreaterThanOrEqual(1);
      expect(card.power, card.name).toBeGreaterThanOrEqual(1);
      expect(card.shotLine, card.name).toBeGreaterThan(0);
      expect(card.salary, card.name).toBeGreaterThan(0);
      expect(Number.isFinite(card.defBoost), card.name).toBe(true);
      // Five printed rows plus the structural blank one the set hides.
      expect(card.chart.length, card.name).toBeGreaterThan(1);
      expect(card.chart.length, card.name).toBeLessThanOrEqual(6);
      expect(card.chart[0].lo).toBe(1);
      expect(card.chart[card.chart.length - 1].hi).toBe(99);
    }
  });

  it('sits on the same Speed+Power scale as the base set', () => {
    // The printed scale is PRINTED_SCALE's range, and it means the same thing
    // here as on a 2026-27 card BECAUSE the map is calibrated on the 2002-2026
    // EPM archive rather than on either set — see epmArchive.js. Read from the
    // constant rather than written out, so a re-derived widening does not need
    // this file edited to keep telling the truth.
    for (const card of file.cards) {
      const total = card.speed + card.power;
      expect(total, card.name).toBeGreaterThanOrEqual(PRINTED_SCALE.min);
      expect(total, card.name).toBeLessThanOrEqual(PRINTED_SCALE.max);
    }
  });

  it('is sorted by name, like every other list the studio shows', () => {
    const names = file.cards.map(c => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('draws only from the card pool, plus the named standout Super Seasons', () => {
    // The one sanctioned exception: card-data/summer-standouts.json names the
    // Super Seasons the conflict rule kept instead of a playoff card, and most
    // of those players are retirees no pool has ever held. Named list, not a
    // loophole — anyone else from outside the pool still fails the test.
    const pool = new Set(POOL.map(p => p.name));
    // BOTH standout blocks: the standout Super Seasons land in that set, and
    // the newcomer ROOKIE cards draw from either block's names.
    const standouts = new Set([
      ...Object.keys(STANDOUTS.superSeasons ?? {}),
      ...Object.keys(STANDOUTS.playoffCards ?? {}),
    ]);
    // The SECOND sanctioned exception: card-data/legends-2026.json names the
    // all-time greats who retired before the pool existed and so had no path
    // into any generated set. Also a named list, also not a loophole.
    const legends = new Set([...readLegends().map(l => l.name), ...ROOKIE_LEGEND_NAMES]);
    for (const card of file.cards) {
      expect(
        pool.has(card.name) || standouts.has(card.name) || legends.has(card.name),
        card.name
      ).toBe(true);
    }
  });

  it('accounts for every pool player exactly once, carded or excluded', () => {
    // The exclusion is a RULE, not a filter that quietly drops people. Every
    // player is either in the set or on the excluded list with a reason.
    const carded = new Set(file.cards.map(c => c.name));
    const excluded = new Set(file.excluded.map(e => e.name));
    // Standout Super Seasons from outside the pool sit on top of the
    // one-per-pool-player accounting; the displaced picks were pool members
    // and stay counted through their replacements.
    const pool = new Set(POOL.map(p => p.name));
    // Legends sit on top of that accounting the same way: named, off-pool,
    // and carded — see card-data/legends-2026.json.
    const offPool = [...new Set([
      ...Object.keys(STANDOUTS.superSeasons ?? {}),
      ...Object.keys(STANDOUTS.playoffCards ?? {}),
      ...readLegends().map(l => l.name),
      ...ROOKIE_LEGEND_NAMES,
    ])].filter(name => carded.has(name) && !pool.has(name)).length;
    const ceded = (file.mergedIntoTwin ?? []).length;
    // The playing-time cut is a THIRD way out of the rookie set, and it has to
    // be counted here or the rule stops being "everyone is accounted for" and
    // becomes "everyone we happened to look at".
    const thin = (file.excludedThin ?? []).length;
    expect(carded.size + excluded.size + ceded + thin).toBe(POOL.length + offPool);
    for (const name of carded) expect(excluded.has(name)).toBe(false);
    for (const e of file.excluded) expect(e.reason).toBeTruthy();
    expect(file.excludedCount).toBe(file.excluded.length);
  });

  it('never carries the most recent season — the exclusion rule', () => {
    // THE RULE THAT MAKES BOTH SETS. A player whose chosen season is the
    // current one already has that card in the base set, so a second one would
    // be the same card twice.
    for (const card of file.cards) expect(card.season).not.toBe(LAST_SEASON);
    expect(file.excluded.length).toBeGreaterThan(0);
  });
});

// The forced rookie seasons (card-data/rookie-legends-2026.json) are off-pool
// by definition — that file exists for players with no base card.
const ROOKIE_LEGEND_NAMES = Object.keys(
  JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'rookie-legends-2026.json'), 'utf8'))
).filter(k => !k.startsWith('_'));

describe('Super Season', () => {
  it('excludes the players having their best season right now', () => {
    // Two detections, one meaning. The metric finds most of them; the rest are
    // caught by comparing the finished cards, because a season can win on BPM
    // and still build the weaker card (see BEATEN_BY_BASE).
    const reasons = new Set(SUPER.excluded.map(e => e.reason));
    expect([...reasons].sort()).toEqual([BEATEN_BY_BASE, 'best season is the current one'].sort());
  });

  it('never prints a card the player\'s own base card beats', () => {
    // The rule the user set on 2026-09-07. Every remaining Super Season card
    // is stronger than that player's current card, or he has no current card.
    const base = new Map(
      JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', `cards-${CURRENT_SET}.json`), 'utf8'))
        .cards.map(c => [c.id, c.salary])
    );
    const beaten = SUPER.cards.filter(c => base.has(c.id) && base.get(c.id) >= c.salary);
    expect(beaten.map(c => `${c.name} $${c.salary} vs base $${base.get(c.id)}`)).toEqual([]);
  });

  it('chooses on BPM alone, and says so on the file', () => {
    // The rule is a property of the artefact, not just of the code that made
    // it: anyone reading the roster should be able to see that Win Shares was
    // taken out on purpose rather than lost by accident.
    expect(SUPER.sources.bestSeason).toMatch(/BPM/);
    expect(SUPER.sources.bestSeason).toMatch(/Win Shares/);
    expect(SUPER.sources.speedPower).not.toMatch(/WS per game/);
  });

  it('leans on seasons a player really played', () => {
    // The 1000-minute eligibility floor at work: a career-best season should
    // essentially never be a handful of games. Under BPM-only this floor is the
    // ONLY thing holding the line — the volume metrics that used to penalise a
    // thin season a second time are gone — and the margin moved accordingly,
    // from 13/197 of the roster under the old rule to 14/201 under this one.
    // Every one of the 14 is a player with no 1000-minute season anywhere in
    // his career, i.e. the floor's declared fallback rather than a leak.
    const thin = SUPER.cards.filter(c => c.games * c.mpg < 800);
    expect(thin.length / SUPER.cards.length).toBeLessThan(0.1);
  });

  it('sits ABOVE the current pool, which is what a set of peaks should do', () => {
    const totals = SUPER.cards.map(c => c.speed + c.power).sort((a, b) => a - b);
    expect(totals[Math.floor(totals.length / 2)]).toBeGreaterThan(17.8);
  });
});

describe('Rookie', () => {
  it('excludes the players whose rookie year IS the current season', () => {
    // The user's open question, answered the same way the Super Season rule
    // answers its own version of it.
    for (const e of ROOKIE.excluded) expect(e.reason).toBe('rookie season is the current one');
  });

  it('puts defunct franchises on the cards that earned them', () => {
    // Kevin Durant's rookie year was Seattle's last. Mapping it to OKC would be
    // a factual error printed on the card.
    const durant = ROOKIE.cards.find(c => c.name === 'Kevin Durant');
    // SEA06 — the 2001-08 SuperSonics identity, whose mark the user supplied
    // for exactly this card. Still Seattle; the era key names which Seattle.
    expect(durant.team).toBe('SEA06');
    expect(durant.season).toBe(2008);
    expect(ROOKIE.cards.find(c => c.name === 'Brook Lopez').team).toBe('NJN');
    expect(ROOKIE.cards.find(c => c.name === 'Anthony Davis').team).toBe('NOH');
  });

  it('does not card a 50-minute rookie year at all any more', () => {
    // Unshrunk, Leonard Miller's 17-game, 53-minute rookie season carried a BPM
    // of +9.6 — the single highest composite in the set — and his card came out
    // a step above Victor Wembanyama's. Shrinking it fixed the ORDERING, which
    // is what this test used to assert.
    //
    // The playing-time bar now answers the question one level up: 17 games at
    // 3.1 MPG is not a rookie season, so there is no card to rank. Asserting
    // his ABSENCE is the stronger claim, and it is checked against the reason
    // rather than just the gap, so a card vanishing for some unrelated bug
    // could not pass this by accident.
    expect(ROOKIE.cards.find(c => c.name === 'Leonard Miller')).toBeUndefined();
    const cut = (ROOKIE.excludedThin ?? []).find(e => e.name === 'Leonard Miller');
    expect(cut, 'Leonard Miller should be on the thin list').toBeTruthy();
    expect(cut.games).toBeLessThan(20);
    expect(ROOKIE.cards.find(c => c.name === 'Victor Wembanyama')).toBeTruthy();
  });

  it('has the top of the set look like the rookie classes people remember', () => {
    // Top TWELVE now: the standout newcomers put Chris Paul's, Carmelo's and
    // Dwight Howard's rookie years into this set, and those classes are also
    // ones people remember — the window widens rather than evicting anyone.
    const top = [...ROOKIE.cards]
      .sort((a, b) => b.speed + b.power - (a.speed + a.power))
      // Twenty since 2026-09-06: seven forced rookie seasons (Jordan first among
      // them) sit above some of these — Dončić is 18th of 271.
      .slice(0, 20)
      .map(c => c.name);
    for (const name of ['Victor Wembanyama', 'Luka Dončić', 'Nikola Jokić', 'Michael Jordan']) {
      expect(top, `${name} missing from the top of the rookie set`).toContain(name);
    }
  });
});

describe('the base set\'s badges', () => {
  // THE EXCLUSION LISTS, RESTATED AS SOMETHING PRINTABLE. Every assertion here
  // is about the artefact the studio actually loads, like the two above it: a
  // regeneration that changed the rule shows up as a failing claim about the
  // file on disk rather than as a silently different set of pills.

  it('names the set it belongs to, so a stale file cannot badge the wrong season', () => {
    expect(BADGES.set).toBe(CURRENT_SET);
    expect(BADGES.provisional).toBe(true);
    expect(Array.isArray(BADGES.badges)).toBe(true);
  });

  it('records the priority for provenance and applies it nowhere', () => {
    // The order that DECIDES lives in src/cards/badges.js and is applied at
    // render time. Recording it here is documentation; if the two ever
    // disagree, the file is the one that is wrong.
    expect(BADGES.priority).toEqual(BADGE_IDS);
  });

  it('badges exactly the players the two sets excluded, and nobody else', () => {
    // The join that makes this a restatement rather than a second rule.
    const expected = new Map();
    for (const [file, badge] of [[SUPER, SUPER_SEASON_BADGE], [ROOKIE, ROOKIE_BADGE]]) {
      for (const e of file.excluded) {
        expect(e.badge, `${e.name} in ${file.set}`).toBe(badge);
        if (!expected.has(e.name)) expected.set(e.name, []);
        expected.get(e.name).push(badge);
      }
    }
    expect(BADGES.badges.length).toBe(expected.size);
    for (const record of BADGES.badges) {
      expect(record.badges.slice().sort(), record.name)
        .toEqual(expected.get(record.name).slice().sort());
    }
  });

  it('keys every record by the id the studio joins on', () => {
    const pool = new Map(POOL.map(p => [playerIdFromName(p.name), p.name]));
    for (const record of BADGES.badges) {
      expect(record.id, record.name).toBe(playerIdFromName(record.name));
      expect(pool.get(record.id), `${record.name} is not in the pool`).toBe(record.name);
    }
  });

  it('declares only badges the card layer knows how to draw', () => {
    for (const record of BADGES.badges) {
      expect(record.badges.length, record.name).toBeGreaterThan(0);
      for (const id of record.badges) expect(BADGE_IDS, record.name).toContain(id);
      // Stored in priority order, so the file reads the way the card resolves.
      expect(record.badges).toEqual(BADGE_IDS.filter(id => record.badges.includes(id)));
    }
  });

  it('leaves the two special sets exactly as big as they were', () => {
    // The badge is what the EXCLUDED players get. Nobody moves into or out of
    // either roster because of it, and these two numbers are how you know.
    //
    // SUPER SEASON MOVED 201 -> 209 WHEN THE GAMES FLOOR ARRIVED, and that is
    // the floor's doing rather than the badge's. It cuts both ways and the net
    // is small: 16 players whose best was a SHORT 2026 now have a longer
    // earlier season carded instead of a badge, and 8 whose best was a short
    // earlier season now have 2026 as their best and take the badge instead of
    // a card. The rookie set cannot move at all — a rookie year carries no
    // floor, because it is whatever it was.
    //
    // AND 210 -> 214 WHEN THE CARRIED-FORWARD PLAYERS JOINED THE POOL, which is
    // not the badge either: Haliburton, Irving, Lillard and VanVleet are carded
    // from their last healthy season and are pool members like anyone else, so
    // each has a best season to card. See carryForward.js.
    //
    // AND 209 -> 210 WHEN VORP JOINED THE RULE, which is the same mechanism a
    // second time: three players (Josh Hart, Mitchell Robinson, Norman Powell)
    // whose 2026 outscored an earlier year on RATE now have that longer earlier
    // year carded, and two (Jamal Murray, Moses Moody) go the other way. The
    // rookie set is untouched by the metric set entirely — WHICH season a
    // rookie card is cannot depend on how seasons are scored.
    //
    // AND 214 -> 221 WHEN THE STANDOUT SUPER SEASONS ARRIVED — the nine calls
    // in card-data/standout-conflict-decisions.json where the Super Season
    // beat the playoff card. Seven are retirees new to the set; Jokic and
    // Doncic displaced their own algorithmic picks in place.
    //
    // AND 221 -> 206 WHEN THE SAME-SEASON TWINS COLLAPSED: fifteen players
    // whose best season IS their rookie season keep ONE card of it, on the
    // rookie side under the gold line, wearing the best-season badge too.
    // AND 206 -> 208 when Rodman's 1991-92 and Pippen's 1993-94 arrived — the
    // missing legends the standout work was asked for at the very start.
    // 219, not 224: the five players on no current NBA roster were cut with him (card-data/retired-2026.json), and each had a Super Season card.
    // 225: the rookie playing-time bar removed 91 rookie cards, and six of them
    // were TWINS a super-season card had been merged into. No twin, no merge,
    // so those six stay in this set — mergedIntoTwin fell from 15 to 9.
    // 233 since 2026-09-06: eight capstone legends joined (the file keeps the
    // one moved into set-rewards; cardSets filters it at load).
    // 233 -> 194 on 2026-09-07, and this one IS the badge moving players: the
    // beaten-by-base rule (BEATEN_BY_BASE) drops a Super Season pick whose own
    // base card is at least as strong, and hands it the pill instead. So the
    // title of this test now holds only for the metric-detected exclusion; the
    // second rule deliberately trades cards for badges, 39 of them.
    expect(SUPER.cards.length).toBe(194);
    //
    // AND 321 -> 348 WHEN THE STANDOUT NEWCOMERS' ROOKIE YEARS ARRIVED — every
    // standout outside the pool whose career begins inside the cache-and-EPM
    // window gets his rookie season carded — and since the 1990s tables were
    // fetched (1992 as the sentinel that proves a 1993 first appearance is a
    // debut), that window reaches Shaq's, Kidd's and Garnett's actual rookie
    // years. 348 -> 367 when the pre-2000 nineteen arrived over the BPM bridge.
    // 363, not 368: the five players on no current NBA roster were cut
    // (card-data/retired-2026.json), and each had a Rookie card too.
    //
    // AND 363 -> 263 WHEN THE PLAYING-TIME BAR ARRIVED. The comment above says
    // "a rookie year carries no floor, because it is whatever it was" — that is
    // no longer true and was the thing worth changing. The set carded every
    // first season including 1-game, 3-MPG call-ups; 91 of those are gone, on
    // MPG >= 12 and G >= 20. The games floor is HALF the pool rule's so that a
    // rookie year ended by injury still counts — Embiid on 31 games, Zion on
    // 24 — while Julius Randle's single game does not.
    // 271 since 2026-09-06: seven forced rookie seasons (rookie-legends-2026.json).
    expect(ROOKIE.cards.length).toBe(271);
    const poolNames = new Set(POOL.map(p => p.name));
    const bothBlocks = [...new Set([
      ...Object.keys(STANDOUTS.superSeasons ?? {}),
      ...Object.keys(STANDOUTS.playoffCards ?? {}),
      // The forced rookie seasons are off-pool by construction.
      ...ROOKIE_LEGEND_NAMES,
    ])];
    // Legends are off-pool by definition — they retired before the pool
    // existed, which is the whole reason the list exists.
    const ssOffPool = [...new Set([
      ...Object.keys(STANDOUTS.superSeasons ?? {}),
      ...readLegends().map(l => l.name),
    ])].filter(name => !poolNames.has(name)).length;
    const rookieOffPool = bothBlocks
      .filter(name => ROOKIE.cards.some(c => c.name === name) && !poolNames.has(name)).length;
    expect(SUPER.cards.length + SUPER.excluded.length + (SUPER.mergedIntoTwin ?? []).length)
      .toBe(POOL.length + ssOffPool);
    // The playing-time bar is the third exit from the rookie set, alongside the
    // badge exclusion and the twin merge. Counted here for the same reason the
    // other two are: this assertion is the one that would notice a player
    // disappearing for no recorded reason.
    expect(
      ROOKIE.cards.length +
        ROOKIE.excluded.length +
        (ROOKIE.mergedIntoTwin ?? []).length +
        (ROOKIE.excludedThin ?? []).length
    ).toBe(POOL.length + rookieOffPool);
  });

  it('has NESTED lists, which is why the rookie badge is the one that prints', () => {
    // Structural, not a coincidence: a player whose FIRST season is the most
    // recent one has exactly one season, so it is also his BEST one. Every
    // rookie-badged player is therefore super-season-badged too.
    //
    // THIS TEST ONCE ASSERTED THE OPPOSITE OUTCOME from the same premise —
    // "which is why the rookie badge never prints", because Super Season
    // outranked Rookie and so the gold pill won all 33. The premise was right
    // and is unchanged; what it was taken to justify was not. The overlap set
    // is not a mixed population needing a tie-break, it IS the 2025-26 rookie
    // class, and telling a reader that a one-season career's only season was
    // its best one is telling him nothing. So ROOKIE outranks SUPER SEASON, and
    // these 33 are the cards that say so.
    const rookieBadged = BADGES.badges.filter(b => b.badges.includes(ROOKIE_BADGE));
    expect(rookieBadged.length).toBe(ROOKIE.excluded.length);
    for (const record of rookieBadged) {
      expect(record.badges, record.name).toContain(SUPER_SEASON_BADGE);
      expect(pickBadge(record.badges).id, record.name).toBe(ROOKIE_BADGE);
    }
    // Cooper Flagg by name — the card the user was looking at when he asked.
    expect(rookieBadged.map(r => r.id)).toContain('Cooper_Flagg');
  });

  it('counts what applies and what actually prints, and they differ', () => {
    const counts = badgeCounts(BADGES.badges, SALARIES);
    expect(BADGES.counts).toEqual(counts);
    expect(counts.players).toBe(SUPER.excluded.length);
    expect(counts.applies[SUPER_SEASON_BADGE]).toBe(SUPER.excluded.length);
    expect(counts.applies[ROOKIE_BADGE]).toBe(ROOKIE.excluded.length);
    // NO PLAYER RECORD CLAIMS `best-season` and none ever will: it is not a
    // fact about a player, it is what the gilded badge becomes below the salary
    // line. `applies` 0 against a non-zero `printed` is the correct shape here,
    // and the one row in the table where it is.
    expect(counts.applies[BEST_SEASON_BADGE]).toBe(0);
    // THE FIRST GAP IS THE NESTING, and it falls on the Super Season side:
    // every rookie is also a Super Season, so the 33 that print ROOKIE are 33
    // the pill loses. `applies` still reports both facts in full.
    expect(counts.printed[ROOKIE_BADGE]).toBe(ROOKIE.excluded.length);
    // AND THE SECOND IS THE SALARY TIER. Of the 107 left, the ones under
    // SUPER_SEASON_MIN_SALARY print BEST SEASON — the same rule the Super
    // Season SET is tiered by, because it is the same pill on the same player.
    const contested = SUPER.excluded.length - ROOKIE.excluded.length;
    expect(counts.printed[SUPER_SEASON_BADGE] + counts.printed[BEST_SEASON_BADGE])
      .toBe(contested);
    // 14/93, not the 13/94 the linear salary model produced: pricing a card by
    // what it does in play moved one more base card across
    // SUPER_SEASON_MIN_SALARY. The split is a measurement of the price, so it
    // is expected to move whenever the price does.
    // 12/95, moved again by the ceiling suppression in generate.js: pulling the
    // top tier in lowers play value, which lowers salary, which moves cards
    // across SUPER_SEASON_MIN_SALARY. The split is a MEASUREMENT of the price,
    // so it moves whenever the price does.
    // 15/92 after the progressive ceiling shave and the four carried-forward
    // players joined the pool: both move play value, which moves salary, which
    // moves cards across SUPER_SEASON_MIN_SALARY. The split is a MEASUREMENT.
    // 15/92 after the defBoost contest reprice — defence value now includes
    // conversion denial, and two badged defenders crossed the gilded line.
    // 16/91 after the LAST-82 WINDOW landed (windowEpm.js): Speed+Power now
    // pools each season by its share of the player's last 82 games, 173 of 353
    // budgets moved, and four more cards cleared SUPER_SEASON_MIN_SALARY.
    // 14/93 after the five players on no current NBA roster were cut (card-data/retired-2026.json), taking the pool 353 -> 348.
    // 21/125 on 2026-09-07: the beaten-by-base rule moved 39 players out of
    // the set and onto the badge, and most of them are the cheap role players
    // the rule exists to catch — so the BEST SEASON side of the split grew far
    // more than the gilded one.
    expect(counts.printed[BEST_SEASON_BADGE]).toBe(125);
    expect(counts.printed[SUPER_SEASON_BADGE]).toBe(21);
    // Nobody loses their pill entirely in the resolution.
    expect(BADGE_IDS.reduce((n, id) => n + counts.printed[id], 0)).toBe(counts.players);
    expect(counts.multiple).toBe(ROOKIE.excluded.length);
  });

  it('degrades to the untiered counts when there are no salaries to tier on', () => {
    // The salaries belong to generateCards.js, not to this generator, so an
    // absent lookup has to be a legitimate answer rather than an error — a
    // checkout that has never run the other generator still reports something
    // true. `tierBadge` treats an unknown salary as gilded, so `printed` falls
    // back to exactly the distribution this reported before the tier existed.
    const untiered = badgeCounts(BADGES.badges);
    expect(untiered.printed[BEST_SEASON_BADGE]).toBe(0);
    expect(untiered.printed[SUPER_SEASON_BADGE])
      .toBe(SUPER.excluded.length - ROOKIE.excluded.length);
    expect(loadBaseSalaries(path.join(REPO_ROOT, 'no-such-file.json')).size).toBe(0);
    expect(untiered.applies).toEqual(BADGES.counts.applies);
  });

  it('reads the salaries out of the base set the studio actually loads', () => {
    // Not recomputed here: the tier is a comparison against the number PRINTED
    // on the card, so the number this reads has to be the one the card draws.
    expect(SALARIES.size).toBe(BASE.cards.length);
    for (const record of BADGES.badges) {
      expect(SALARIES.get(record.id), record.name).toBe(
        BASE.cards.find(c => c.id === record.id)?.salary
      );
    }
  });
});

describe('the Speed+Power composite', () => {
  // The archive's own shape, near enough: composite = z(EPM) + 0.35 * z(EW/GP).
  const basis = { epm: { mean: -0.32, sd: 2.14 }, ewinsPerGame: { mean: 0.051, sd: 0.049 } };

  it('is the base set own composite — real EPM, not a BPM stand-in', () => {
    // These sets used to be priced on `z(BPM) + 0.35 * z(VORP per game)`,
    // because dunksandthrees' prior seasons were paywalled. They are not any
    // more: `season-epm` serves 2002-2026 and every carded season falls inside
    // it, so a Super Season card is now priced on the same two numbers a
    // 2026-27 card is. Nothing derived from a TEAM's win column can move it,
    // and neither can BPM.
    const w = { epm: 4, ewinsPerGame: 0.15, games: 80, minutes: 2500 };
    expect(historicalComposite({ ...w, ws: 12 }, basis)).toBe(
      historicalComposite({ ...w, ws: 2 }, basis)
    );
    expect(historicalComposite({ ...w, bpm: 9 }, basis)).toBe(
      historicalComposite({ ...w, bpm: -9 }, basis)
    );
    expect(Object.keys(COMPOSITE_WEIGHTS).sort()).toEqual(['epm', 'ewinsPerGame']);
    expect(COMPOSITE_WEIGHTS.ewinsPerGame).toBe(REFINEMENT_WEIGHT);
    for (const weights of Object.values(COMPOSITE_METRIC_SETS)) {
      expect(Object.keys(weights)).not.toContain('wsPerGame');
      expect(Object.keys(weights)).not.toContain('bpm');
    }
  });

  it('shrinks a season toward replacement in proportion to how little of it there was', () => {
    const w = { epm: 8, ewinsPerGame: 0.25 };
    const full = historicalComposite({ ...w, games: 70, minutes: 2400 }, basis);
    const sliver = historicalComposite({ ...w, games: 17, minutes: 53 }, basis);
    expect(sliver).toBeLessThan(full / 4);
  });

  it('leaves a full season completely untouched', () => {
    const a = historicalComposite({ epm: 4, games: 80, minutes: 2500 }, basis);
    const b = historicalComposite({ epm: 4, games: 80, minutes: FULL_SEASON_MINUTES }, basis);
    expect(a).toBeCloseTo(b, 10);
  });

  it('pulls a tiny season toward REPLACEMENT, not toward average', () => {
    // Shrinking toward the pool mean would be wrong at both ends: it would hand
    // a 53-minute flier an average card, and a 53-minute disaster one too.
    // Replacement is MEASURED in EPM units — the mean EPM and EW/GP of the
    // player-seasons sitting at Basketball-Reference's -2.0 BPM — and crucially
    // EW/GP is NOT zero there, which is where the old analogy with VORP broke.
    const nothing = historicalComposite(
      { epm: 8, ewinsPerGame: 0.25, games: 3, minutes: 0 },
      basis
    );
    const target =
      (REPLACEMENT_EPM - basis.epm.mean) / basis.epm.sd +
      REFINEMENT_WEIGHT *
        ((COMPOSITE_REPLACEMENT.ewinsPerGame - basis.ewinsPerGame.mean) / basis.ewinsPerGame.sd);
    expect(nothing).toBeCloseTo(target, 10);
    expect(nothing).toBeLessThan(0);
    expect(COMPOSITE_REPLACEMENT.ewinsPerGame).toBeGreaterThan(0);
  });

  it('prices an unrated season at replacement outright, whatever minutes it had', () => {
    // One rookie season in 317 — Jordan Goodwin's 2021-22, two NBA games in a
    // G-League year — has no EPM at all. A z-score of null would read as the
    // archive MEAN, i.e. an average card for no evidence, so the trust weight
    // goes to zero instead.
    const unrated = historicalComposite({ epm: null, games: 80, minutes: 2500 }, basis);
    const none = historicalComposite({ epm: null, games: 3, minutes: 0 }, basis);
    expect(unrated).toBe(none);
    expect(unrated).toBeLessThan(0);
  });

  it('buys volume back through Estimated Wins, not through the rate alone', () => {
    // EW/GP is EPM multiplied by playing time, so the same rate over more of a
    // game prices higher — and the rate alone is what cannot tell them apart.
    const heavy = historicalComposite(
      { epm: 4, ewinsPerGame: 0.16, games: 80, minutes: 2500 },
      basis
    );
    const light = historicalComposite(
      { epm: 4, ewinsPerGame: 0.06, games: 80, minutes: 2500 },
      basis
    );
    expect(heavy).toBeGreaterThan(light);
    const w = COMPOSITE_METRIC_SETS.epmOnly;
    expect(
      historicalComposite({ epm: 4, ewinsPerGame: 0.16, games: 80, minutes: 2500 }, basis, w)
    ).toBe(historicalComposite({ epm: 4, ewinsPerGame: 0.06, games: 80, minutes: 2500 }, basis, w));
  });

  it('joins a season to EPM by name and year, aliases included', () => {
    const index = indexEpmSeasons([
      { name: 'Ronald Holland II', season: 2025, epm: -2.4, ewinsPerGame: 0.02, games: 86 },
      { name: 'LeBron James', season: 2009, epm: 9.2, ewinsPerGame: 0.298, games: 81 },
    ]);
    const { selections, unmatched } = attachEpm(
      [
        { player: { name: 'Ron Holland' }, season: { season: 2025 } },
        { player: { name: 'LeBron James' }, season: { season: 2009 } },
        { player: { name: 'LeBron James' }, season: { season: 2010 } },
      ],
      index
    );
    expect(EPM_NAME_ALIASES['Ron Holland']).toBe('Ronald Holland II');
    expect(selections[0].season.epm).toBe(-2.4);
    expect(selections[1].season.ewinsPerGame).toBeCloseTo(0.298, 10);
    // A player who really has no row for that year comes back null AND named.
    expect(selections[2].season.epm).toBe(null);
    expect(unmatched).toEqual(['LeBron James 2010']);
  });
});

describe('joining a pool player to his career', () => {
  const rows = [
    { season: LAST_SEASON, playerId: 'jacksja02', name: 'Jaren Jackson Jr.', games: 70 },
    { season: 2002, playerId: 'jacksja01', name: 'Jaren Jackson', games: 60 },
    { season: 2019, playerId: 'jacksja02', name: 'Jaren Jackson Jr.', games: 58 },
  ];

  it('resolves the id from the most recent season only', () => {
    const { ids, missing } = resolvePlayerIds([{ name: 'Jaren Jackson Jr.' }], rows);
    expect(ids.get('Jaren Jackson Jr.')).toBe('jacksja02');
    expect(missing).toEqual([]);
  });

  it('KEEPS FATHER AND SON APART, which matching by name cannot', () => {
    // normalizeName strips "Jr."/"II"/"III" — correct everywhere else in the
    // pipeline and catastrophic here. Without the id join, Jaren Jackson Jr.
    // would have inherited his father's 2001-02 Spurs season as a career best
    // and nothing downstream would have looked wrong.
    const byId = rowsById(rows);
    expect(byId.get('jacksja02').map(r => r.season).sort()).toEqual([2019, LAST_SEASON]);
    expect(byId.get('jacksja01')).toHaveLength(1);
  });

  it('reports a pool player it could not place instead of silently dropping him', () => {
    const { missing } = resolvePlayerIds([{ name: 'Nobody At All' }], rows);
    expect(missing).toEqual(['Nobody At All']);
  });

  // The archive itself is gitignored — card-data/cache is a bulk copy of
  // Basketball-Reference's tables and this repo is public — so this one runs
  // only where `node scripts/cardgen/fetchHistory.js` has been run. Same
  // treatment the calibration snapshot's tests already get.
  it.runIf(HISTORY)('finds all 350 pool players in the archive', () => {
    const { ids, missing } = resolvePlayerIds(POOL, HISTORY.rows);
    expect(missing).toEqual([]);
    expect(ids.size).toBe(POOL.length);
    // And 350 distinct people, not 349 and a collision.
    expect(new Set(ids.values()).size).toBe(POOL.length);
  });
});

describe('seasonLabel', () => {
  it('prints a Basketball-Reference end year the way the card set names seasons', () => {
    expect(seasonLabel(2009)).toBe('2008-09');
    expect(seasonLabel(2000)).toBe('1999-00');
    expect(seasonLabel(2026)).toBe('2025-26');
  });

  it('returns null rather than a label made of undefined', () => {
    expect(seasonLabel(null)).toBeNull();
  });
});
