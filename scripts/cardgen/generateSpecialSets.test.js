// The two generated rosters, checked against the rules that define them.
//
// These read the COMMITTED output files rather than regenerating, deliberately:
// the files are what the studio loads and what the user is about to spend hours
// curating photos against, so what is asserted is the artefact, not a fresh run
// of the code that made it. A regeneration that changed the rules would show up
// here as a failing claim about the file on disk.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  COMPOSITE_METRIC_SETS,
  COMPOSITE_WEIGHTS,
  FULL_SEASON_MINUTES,
  REPLACEMENT_BPM,
  compositeBasis,
  historicalComposite,
  resolvePlayerIds,
  rowsById,
  seasonLabel,
} from './generateSpecialSets.js';
import { LAST_SEASON, FIRST_SEASON, isAggregateTeam, loadPool } from './fetchHistory.js';
import { REPO_ROOT } from './cache.js';
import { playerIdFromName } from '../../src/cards/playerId.js';
import { TEAMS, HISTORICAL_TEAMS, canonicalTeam } from '../../src/cards/teams.js';
import { ROOKIE_SET, SUPER_SEASON_SET } from '../../src/cards/sets.js';

const read = set =>
  JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', `cards-${set}.json`), 'utf8')
  );

const SUPER = read(SUPER_SEASON_SET);
const ROOKIE = read(ROOKIE_SET);
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
    // These cards carry substitutes for three stats that do not exist before
    // this season. A card that renders a complete stat line reads as finished,
    // so the file has to be the thing that disagrees.
    expect(file.provisional).toBe(true);
    expect(file.sources.missing).toEqual(['EPM', 'Estimated Wins', 'rim FG%']);
    for (const card of file.cards) expect(card.provisional).toBe(true);
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
      expect(card.season, card.name).toBeGreaterThanOrEqual(FIRST_SEASON);
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
    // The scale runs 10-28, and it means the same thing here as on a 2026-27
    // card BECAUSE the map was calibrated on the current pool rather than on
    // these seasons — see mapToReferenceScale's `calibrateOn`.
    for (const card of file.cards) {
      const total = card.speed + card.power;
      expect(total, card.name).toBeGreaterThanOrEqual(10);
      expect(total, card.name).toBeLessThanOrEqual(28);
    }
  });

  it('is sorted by name, like every other list the studio shows', () => {
    const names = file.cards.map(c => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('draws only from the card pool', () => {
    const pool = new Set(POOL.map(p => p.name));
    for (const card of file.cards) expect(pool.has(card.name), card.name).toBe(true);
  });

  it('accounts for every pool player exactly once, carded or excluded', () => {
    // The exclusion is a RULE, not a filter that quietly drops people. Every
    // player is either in the set or on the excluded list with a reason.
    const carded = new Set(file.cards.map(c => c.name));
    const excluded = new Set(file.excluded.map(e => e.name));
    expect(carded.size + excluded.size).toBe(POOL.length);
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

describe('Super Season', () => {
  it('excludes the players having their best season right now', () => {
    for (const e of SUPER.excluded) expect(e.reason).toBe('best season is the current one');
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
    expect(durant.team).toBe('SEA');
    expect(durant.season).toBe(2008);
    expect(ROOKIE.cards.find(c => c.name === 'Brook Lopez').team).toBe('NJN');
    expect(ROOKIE.cards.find(c => c.name === 'Anthony Davis').team).toBe('NOH');
  });

  it('does not let a 50-minute rookie year outrank a real one', () => {
    // Unshrunk, Leonard Miller's 17-game, 53-minute rookie season carried a BPM
    // of +9.6 — the single highest composite in the set — and his card came out
    // a step above Victor Wembanyama's. See FULL_SEASON_MINUTES.
    const miller = ROOKIE.cards.find(c => c.name === 'Leonard Miller');
    const wemby = ROOKIE.cards.find(c => c.name === 'Victor Wembanyama');
    expect(miller.games * miller.mpg).toBeLessThan(100);
    expect(miller.speed + miller.power).toBeLessThan(wemby.speed + wemby.power);
  });

  it('has the top of the set look like the rookie classes people remember', () => {
    const top = [...ROOKIE.cards]
      .sort((a, b) => b.speed + b.power - (a.speed + a.power))
      .slice(0, 8)
      .map(c => c.name);
    for (const name of ['Victor Wembanyama', 'Luka Dončić', 'Nikola Jokić']) {
      expect(top, `${name} missing from the top of the rookie set`).toContain(name);
    }
  });
});

describe('the Speed+Power composite', () => {
  const basis = { bpm: { mean: 0, sd: 2 }, vorpPerGame: { mean: 0.02, sd: 0.02 } };

  it('is BPM alone — WIN SHARES CANNOT MOVE IT', () => {
    // WS per game used to be the 0.35 refinement term, on the argument that it
    // was the analogue of the live pipeline's Estimated Wins per game. It is
    // not: EW comes from EPM, WS comes from a TEAM's win total. Two identical
    // players, one on a 60-win team and one on a 20-win team, now price the
    // same.
    const goodTeam = historicalComposite({ bpm: 4, ws: 12, games: 80, minutes: 2500 }, basis);
    const badTeam = historicalComposite({ bpm: 4, ws: 2, games: 80, minutes: 2500 }, basis);
    expect(goodTeam).toBe(badTeam);
    expect(Object.keys(COMPOSITE_WEIGHTS)).toEqual(['bpm']);
    for (const weights of Object.values(COMPOSITE_METRIC_SETS)) {
      expect(Object.keys(weights)).not.toContain('wsPerGame');
    }
  });

  it('shrinks a season toward replacement in proportion to how little of it there was', () => {
    // THE ONLY DURABILITY CORRECTION LEFT once the volume term is gone, which
    // is why it matters more than it did.
    const full = historicalComposite({ bpm: 8, games: 70, minutes: 2400 }, basis);
    const sliver = historicalComposite({ bpm: 8, games: 17, minutes: 53 }, basis);
    expect(sliver).toBeLessThan(full / 4);
  });

  it('leaves a full season completely untouched', () => {
    const a = historicalComposite({ bpm: 4, games: 80, minutes: 2500 }, basis);
    const b = historicalComposite({ bpm: 4, games: 80, minutes: FULL_SEASON_MINUTES }, basis);
    expect(a).toBeCloseTo(b, 10);
  });

  it('pulls a tiny season toward REPLACEMENT, not toward average', () => {
    // Shrinking toward the pool mean would be wrong at both ends: it would hand
    // a 53-minute flier an average card, and a 53-minute disaster one too.
    const nothing = historicalComposite({ bpm: 8, games: 3, minutes: 0 }, basis);
    expect(nothing).toBeCloseTo((REPLACEMENT_BPM - basis.bpm.mean) / basis.bpm.sd, 10);
    expect(nothing).toBeLessThan(0);
  });

  it('buys volume back through VORP, not Win Shares, when asked to', () => {
    // VORP is BPM times minutes share, so VORP per game is BPM weighted by
    // playing time — what EW/GP is to EPM, this time honestly. Same BPM, more
    // minutes behind it, higher composite.
    const w = COMPOSITE_METRIC_SETS.bpmVorp;
    const heavy = historicalComposite({ bpm: 4, vorp: 4, games: 80, minutes: 2500 }, basis, w);
    const light = historicalComposite({ bpm: 4, vorp: 1, games: 80, minutes: 2500 }, basis, w);
    expect(heavy).toBeGreaterThan(light);
    // ...and it changes nothing under the active rule.
    expect(historicalComposite({ bpm: 4, vorp: 4, games: 80, minutes: 2500 }, basis)).toBe(
      historicalComposite({ bpm: 4, vorp: 1, games: 80, minutes: 2500 }, basis)
    );
  });

  it('measures its basis off the current pool, so the sets share a yardstick', () => {
    const rows = [
      { bpm: 1, vorp: 1.6, games: 80 },
      { bpm: 3, vorp: 4.4, games: 80 },
    ];
    expect(compositeBasis(rows).bpm.mean).toBe(2);
    // And it measures exactly the inputs the declared weighting names.
    expect(Object.keys(compositeBasis(rows))).toEqual(['bpm']);
    const alt = compositeBasis(rows, COMPOSITE_METRIC_SETS.bpmVorp);
    expect(alt.vorpPerGame.mean).toBeCloseTo(0.0375, 10);
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
