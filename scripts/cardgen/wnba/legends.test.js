// The legends set's rules, and the generated roster they produced.
//
// Two halves, and the split is deliberate. The first half tests the PURE rules
// in legends.js against hand-built rows, so a rule can be reasoned about
// without 4,900 player-seasons in the way. The second reads the COMMITTED
// cards-wnba-super-season.json and asserts the things that would be silently
// wrong in a file nobody re-reads: a legend missing, a season mislabelled, a
// franchise resolved to the wrong era.
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  DISTRIBUTION_MIN_MPG,
  INDICATOR_FEATURES,
  LEGEND_MIN_GAMES_SHARE,
  LEGEND_MIN_MPG,
  bestLegendSeason,
  eraShift,
  extrapolation,
  featureEnvelope,
  fittedDistribution,
  inputCoverage,
  minGamesFor,
  scheduleLength,
  scoringEnvironment,
  seasonScore,
  seasonTeam,
  shootingBasis,
} from './legends.js';
import { readLegends, logoShoppingList } from './generateWnbaLegends.js';
import { REPO_ROOT } from '../cache.js';
import { WNBA_SUPER_SEASON_SET, getSet } from '../../../src/cards/sets.js';
import { getWnbaTeam, wnbaFranchiseForSeason } from '../../../src/cards/teams.js';
import { SUPER_SEASON_BADGE } from '../../../src/cards/badges.js';
import { playerIdFromName } from '../../../src/cards/playerId.js';

describe('scheduleLength', () => {
  const table = (...games) => games.map(g => ({ games: g }));

  it('reads the schedule off the league table rather than being told it', () => {
    // 40 rows of a 34-game season plus one deep reserve.
    expect(scheduleLength(table(...Array(40).fill(34), 4))).toBe(34);
  });

  it('ignores the traded player who played one more game than the schedule', () => {
    // THE CASE THE MAXIMUM GETS WRONG, and it is real: the archive holds a
    // 35-game row in the 34-game 2010 season and a 45-game row in the 44-game
    // 2025 one.
    expect(scheduleLength(table(...Array(120).fill(34), 35))).toBe(34);
  });

  it('is not fooled by a league table that is mostly part-timers', () => {
    // Why the 99th percentile and not the 90th: a WNBA table carries far more
    // names than there are full-season starters, so p90 sits below the
    // schedule on the deepest seasons.
    const rows = table(...Array(20).fill(44), ...Array(180).fill(12));
    expect(scheduleLength(rows)).toBe(44);
  });

  it('has nothing to say about an empty table', () => {
    expect(scheduleLength([])).toBeNull();
    expect(scheduleLength(table(0, 0))).toBeNull();
  });
});

describe('minGamesFor', () => {
  it('is 70% of the schedule, whatever the schedule was', () => {
    expect(LEGEND_MIN_GAMES_SHARE).toBe(0.7);
    // The seven schedule lengths the WNBA has actually played.
    expect(minGamesFor(28)).toBe(20);
    expect(minGamesFor(32)).toBe(23);
    expect(minGamesFor(34)).toBe(24);
    expect(minGamesFor(40)).toBe(28);
    expect(minGamesFor(44)).toBe(31);
    // And the 2020 bubble, which was 22.
    expect(minGamesFor(22)).toBe(16);
  });

  it('demands nothing of a season whose schedule could not be measured', () => {
    expect(minGamesFor(null)).toBe(0);
    expect(minGamesFor(0)).toBe(0);
  });
});

describe('eraShift', () => {
  it('moves a percentage by the gap between the two leagues, not by a ratio', () => {
    // Lisa Leslie's 2004: .552 in a league that shot .501, restated in a league
    // that shoots .5582.
    expect(eraShift(0.552, 0.501, 0.5582)).toBeCloseTo(0.6092, 4);
  });

  it('leaves the value alone when either league mean is unknown', () => {
    expect(eraShift(0.5, null, 0.55)).toBe(0.5);
    expect(eraShift(0.5, 0.5, undefined)).toBe(0.5);
  });

  it('has nothing to shift when the player has no percentage', () => {
    expect(eraShift(null, 0.5, 0.55)).toBeNull();
  });
});

describe('bestLegendSeason', () => {
  const season = (o = {}) => ({
    season: 2005, games: 30, mpg: 32, minGames: 24, score: 1, ...o,
  });

  it('picks the highest-scoring eligible season', () => {
    const { best, eligibility } = bestLegendSeason([
      season({ season: 2004, score: 2 }),
      season({ season: 2005, score: 3 }),
      season({ season: 2006, score: 1 }),
    ]);
    expect(best.season).toBe(2005);
    expect(eligibility).toBe('both');
  });

  it('will not crown a season she barely played', () => {
    // Elena Delle Donne's 2021 is THREE GAMES. Without this it would be her
    // card, because a three-game rate can be anything.
    const { best } = bestLegendSeason([
      season({ season: 2019, games: 33, score: 2 }),
      season({ season: 2021, games: 3, score: 9 }),
    ]);
    expect(best.season).toBe(2019);
  });

  it('will not crown a season she barely played IN', () => {
    const { best } = bestLegendSeason([
      season({ season: 2015, mpg: 30, score: 2 }),
      season({ season: 2016, mpg: LEGEND_MIN_MPG - 1, score: 9 }),
    ]);
    expect(best.season).toBe(2015);
    expect(LEGEND_MIN_MPG).toBe(20);
  });

  it('drops the GAMES floor first, keeping the minutes-per-game floor standing', () => {
    // The tiering, and the order is the substance of it. This career has one
    // real-but-short season and one three-game flier; dropping both floors at
    // once would reopen the pool to the flier.
    const { best, eligibility } = bestLegendSeason([
      season({ season: 2011, games: 3, mpg: 8, score: 9 }),
      season({ season: 2012, games: 20, mpg: 31, score: 1 }),
    ]);
    expect(best.season).toBe(2012);
    expect(eligibility).toBe('mpgOnly');
  });

  it('still produces a card for a career of nothing but fragments', () => {
    const { best, eligibility } = bestLegendSeason([
      season({ season: 2011, games: 3, mpg: 8, score: 1 }),
      season({ season: 2012, games: 5, mpg: 9, score: 4 }),
    ]);
    expect(best.season).toBe(2012);
    expect(eligibility).toBe('none');
  });
});

describe('seasonScore', () => {
  it('is the fitted BPM in its own league\'s standard deviations', () => {
    expect(seasonScore(11.42, { mean: 0.5, sd: 3.32 })).toBeCloseTo(3.29, 2);
  });

  it('scores nothing rather than dividing by a spread it does not have', () => {
    expect(seasonScore(5, { mean: 0, sd: 0 })).toBe(0);
    expect(seasonScore(null, { mean: 0, sd: 3 })).toBe(0);
  });
});

describe('seasonTeam', () => {
  it('leaves a real franchise alone', () => {
    expect(seasonTeam('SEA', [])).toBe('SEA');
  });

  it('resolves TOT to the split she played the most MINUTES for', () => {
    // MINUTES, not games, and deliberately not the LAST stint the current WNBA
    // set uses: a card that represents a whole season should wear the jersey
    // she wore for most of it, and every player here retired years ago so
    // "where she is now" is not a question.
    expect(
      seasonTeam('TOT', [
        { team: 'TOT', minutes: 900 },
        { team: 'CHI', minutes: 600 },
        { team: 'MIN', minutes: 300 },
      ])
    ).toBe('CHI');
  });

  it('keeps TOT rather than inventing a team when there are no splits', () => {
    expect(seasonTeam('TOT', [])).toBe('TOT');
  });
});

describe('shootingBasis and scoringEnvironment', () => {
  const rows = [
    { minutes: 1000, tsPct: 0.6, fgPct2: 0.5, fgPct3: 0.4, ptsTotal: 500 },
    { minutes: 100, tsPct: 0.3, fgPct2: 0.2, fgPct3: 0.1, ptsTotal: 20 },
  ];

  it('weights the league mean by MINUTES, not by names on the roster', () => {
    // The ten-minute cups of coffee are most of a WNBA table and their
    // percentages are noise. Unweighted this would read .45.
    expect(shootingBasis(rows).tsPct).toBeCloseTo((0.6 * 1000 + 0.3 * 100) / 1100, 6);
  });

  it('measures the scoring environment as league points per four minutes', () => {
    expect(scoringEnvironment(rows)).toBeCloseTo((4 * 520) / 1100, 6);
  });

  it('reports nothing rather than zero for a league with no minutes', () => {
    expect(scoringEnvironment([{ minutes: 0, ptsTotal: 0 }])).toBeNull();
  });
});

describe('fittedDistribution', () => {
  it('measures the spread among a season\'s real contributors only', () => {
    const rows = [
      { games: 30, minutes: 900, bpmHat: 4 },
      { games: 30, minutes: 900, bpmHat: 0 },
      // A garbage-time rate that would inflate the spread it is measuring.
      { games: 30, minutes: 30, bpmHat: -40 },
    ];
    const d = fittedDistribution(rows);
    expect(d.n).toBe(2);
    expect(d.mean).toBe(2);
    expect(DISTRIBUTION_MIN_MPG).toBe(10);
  });
});

describe('inputCoverage', () => {
  const featureOf = (r, key) => r[key];

  it('says nothing when every row carries every input', () => {
    const c = inputCoverage([{ minutes: 500, per: 20 }], ['per'], featureOf);
    expect(c.complete).toBe(true);
    expect(c.missing).toEqual({});
  });

  it('counts a gap the model would silently read as league average', () => {
    // THE FAILURE THIS EXISTS FOR: centredFeatures returns 0 for a missing
    // value, which IS the league mean, so a hollow column produces a perfectly
    // ordinary-looking rating.
    const c = inputCoverage(
      [{ minutes: 500, per: 20 }, { minutes: 500, per: null }],
      ['per'],
      featureOf
    );
    expect(c.complete).toBe(false);
    expect(c.missing.per).toEqual({ absent: 1, of: 2 });
  });

  it('does not count a player who never played as a data gap', () => {
    const c = inputCoverage([{ minutes: 0, per: null }], ['per'], featureOf);
    expect(c.rows).toBe(0);
    expect(c.complete).toBe(true);
  });
});

describe('extrapolation', () => {
  const envelope = { a: { lo: -1, hi: 1 }, isGuard: { lo: -0.5, hi: 0.5 } };

  it('counts feature values outside the range the model was fitted on', () => {
    const e = extrapolation([[0, 0], [2, 0], [-3, 0]], envelope, ['a', 'isGuard']);
    expect(e.cells).toBe(3);
    expect(e.outside).toBe(2);
    expect(e.byFeature.a).toBe(2);
  });

  it('EXCLUDES the position indicators, which cannot extrapolate', () => {
    // The first version's mistake. `isGuard` takes two values; centred on a
    // league whose guard share differs from the NBA's, one of them falls
    // outside the band — which measures roster composition, not the model
    // being asked something new. It inflated 1997 from 12% to 17%.
    expect(INDICATOR_FEATURES).toContain('isGuard');
    expect(INDICATOR_FEATURES).toContain('isCenter');
    const e = extrapolation([[0, 9], [0, -9]], envelope, ['a', 'isGuard']);
    expect(e.outside).toBe(0);
    expect(e.cells).toBe(2);
  });
});

describe('featureEnvelope', () => {
  it('is a percentile band, so one outlier season cannot widen it to everything', () => {
    const rows = Array.from({ length: 100 }, (_, i) => [i]);
    rows.push([100000]);
    const env = featureEnvelope(rows, ['a']);
    expect(env.a.hi).toBeLessThan(1000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const CARDS_FILE = path.join(REPO_ROOT, 'card-data', 'generated', `cards-${WNBA_SUPER_SEASON_SET}.json`);
const ROSTER_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'wnba-legends-roster.json');
const has = fs.existsSync(CARDS_FILE);
const SET = has ? JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8')) : null;
const ROSTER = has ? JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8')) : null;
const NAMED = readLegends();

describe.runIf(has)('the generated WNBA Super Season set', () => {
  it('cards EVERY named legend and nobody else', () => {
    // The whole point of a NAMED roster: this is the one set in the repo where
    // the right answer is a list somebody wrote down, so it is checked against
    // that list rather than against a count.
    expect(NAMED).toHaveLength(16);
    expect(SET.cards.map(c => c.name).sort()).toEqual(NAMED.map(l => l.name).sort());
    expect(ROSTER.map(r => r.name).sort()).toEqual(NAMED.map(l => l.name).sort());
  });

  it('corrects the one typo in the user\'s list', () => {
    // "Lisa Lesia" would have matched no row and cost her a card silently, so
    // the corrected spelling is pinned rather than left to be re-broken.
    expect(NAMED.map(l => l.name)).toContain('Lisa Leslie');
    expect(NAMED.map(l => l.name)).not.toContain('Lisa Lesia');
  });

  it('names a WNBA season as ONE year, never as a span', () => {
    // An NBA season is 2008-09 and a WNBA season is 2008. The NBA sets'
    // seasonLabel spans two years for a real reason and copying it here would
    // print a season that never happened.
    for (const c of SET.cards) {
      expect(c.seasonLabel, c.name).toBe(String(c.season));
      expect(c.seasonLabel, c.name).toMatch(/^\d{4}$/);
    }
  });

  it('prints the season, unlike the current WNBA set', () => {
    expect(getSet(WNBA_SUPER_SEASON_SET).showsSeason).toBe(true);
    expect(getSet('wnba').showsSeason).toBe(false);
  });

  it('is gold foil and wears the Super Season badge', () => {
    const declared = getSet(WNBA_SUPER_SEASON_SET);
    expect(declared.treatment).toBe('gold-foil');
    expect(declared.badge).toBe(SUPER_SEASON_BADGE);
    expect(declared.league).toBe('WNBA');
    expect(declared.editable).toBe(true);
  });

  it('resolves every franchise to a real record, era included', () => {
    // A card whose team resolves to nothing renders on the neutral grey
    // fallback, which is the correct signal for unknown data and a bug here:
    // every one of these franchises is known, several of them just no longer
    // exist.
    for (const c of SET.cards) {
      const team = getWnbaTeam(c.team);
      expect(team, `${c.name} ${c.season} -> ${c.team}`).not.toBeNull();
      expect(team.league, c.name).toBe('WNBA');
      expect(team.primary, c.name).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('puts the 2000s Storm in hunter green, not today\'s Storm green', () => {
    // THE ERA CHECK, on the case that would otherwise be invisible: Seattle is
    // still a WNBA team, so a card resolving it to the LIVE row would look
    // perfectly fine and be the wrong decade's colours. Lauren Jackson and Sue
    // Bird are both carded inside 2000-2015.
    const jackson = SET.cards.find(c => c.name === 'Lauren Jackson');
    expect(jackson.statRowTeam).toBe('SEA');
    expect(jackson.team).toBe(wnbaFranchiseForSeason('SEA', jackson.season));
    expect(jackson.team).not.toBe('SEA');
    expect(getWnbaTeam(jackson.team).primary).toBe('#00573F');
  });

  it('keeps every card inside its own season\'s schedule', () => {
    for (const c of SET.cards) {
      expect(c.games, c.name).toBeGreaterThan(0);
      expect(c.games, c.name).toBeLessThanOrEqual(c.schedule + 1);
    }
  });

  it('carries the audit that says how far back the model can be applied', () => {
    // The set's central caveat, and it lives in the FILE rather than only in a
    // run report nobody keeps. A season with no coverage record is a season
    // whose numbers cannot be judged.
    expect(SET.audit.length).toBeGreaterThanOrEqual(28);
    for (const a of SET.audit) {
      expect(a.coverage, String(a.season)).toBeTruthy();
      expect(a.extrapolation.share, String(a.season)).toBeGreaterThan(0);
      expect(a.fittedBpm.sd, String(a.season)).toBeGreaterThan(0);
    }
    // And every carded season has an audit row, which is what makes the caveat
    // attachable to a specific card.
    const audited = new Set(SET.audit.map(a => a.season));
    for (const c of SET.cards) expect(audited.has(c.season), c.name).toBe(true);
  });

  it('says out loud that the shooting numbers were era-shifted', () => {
    expect(SET.sources.shotLine).toMatch(/ERA-SHIFTED/i);
    // And that the chart was NOT, which is the more surprising half.
    expect(SET.sources.chart).toMatch(/NOT era-shifted/i);
  });

  it('reports the historical logos it needs', () => {
    expect(SET.logosNeeded).toBeTruthy();
    for (const e of [...SET.logosNeeded.missing, ...SET.logosNeeded.anachronistic]) {
      expect(e.cards.length).toBeGreaterThan(0);
      expect(e.team).toMatch(/\w/);
    }
    // A franchise on the MISSING list must genuinely have no file, and one on
    // the wrong-era list must genuinely have one — otherwise the shopping list
    // is asking for the wrong thing.
    for (const e of SET.logosNeeded.missing) expect(getWnbaTeam(e.key).logo).toBeNull();
    for (const e of SET.logosNeeded.anachronistic) {
      expect(getWnbaTeam(e.key).logo).toBeTruthy();
      expect(getWnbaTeam(e.key).logoEra).toBeTruthy();
    }
  });

  it('keys every card by the id the studio and the photo store join on', () => {
    for (const c of SET.cards) expect(c.id, c.name).toBe(playerIdFromName(c.name));
  });
});

describe('logoShoppingList', () => {
  it('asks for a mark only where one is missing or from the wrong era', () => {
    const teams = {
      HOU: { city: 'Houston', name: 'Comets', era: '1997-2008', logo: null },
      SEA00: { city: 'Seattle', name: 'Storm', era: '2000-2015', logo: '/x/SEA.png', logoEra: '2021-present' },
      LAS: { city: 'Los Angeles', name: 'Sparks', logo: '/x/LAS.png' },
    };
    const list = logoShoppingList(
      [
        { name: 'A', season: 2000, team: 'HOU' },
        { name: 'B', season: 2006, team: 'SEA00' },
        // An era-correct mark asks for nothing at all, which is the case that
        // keeps the list short enough to act on.
        { name: 'C', season: 2004, team: 'LAS' },
      ],
      abbr => teams[abbr] ?? null
    );
    expect(list.missing.map(e => e.key)).toEqual(['HOU']);
    expect(list.anachronistic.map(e => e.key)).toEqual(['SEA00']);
    expect(list.missing[0].file).toBe('public/logos/WNBA/HOU.png');
    expect(list.missing[0].cards).toEqual(['A 2000']);
  });
});
