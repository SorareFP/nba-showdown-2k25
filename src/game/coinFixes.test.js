// THE COIN FIXES (2026-09-18) — the pure halves.
//
// The user asked: "Is it currently possible to just spam-play really bad teams
// from team builder on deity and farm coins?" It was, four ways, and each fix
// here was failing before it:
//
//   A  a loss at Deity paid the 75 completion x 1.5 however badly it was lost
//      — the user: "Loss 1x, win 1.5x — losing pays the same at every rung;
//      only a win takes the rung's multiplier"
//   B  a coach handed a junk Team B (Team Builder Rosters), or drawn at the
//      plain cap (Quick Match), still paid the rung's premium — the user: "Pay
//      1x — any game where the coach did not draw its own team at the rung
//      pays the fair Prince rate"
//   C  a season with every own game simmed paid full title money — the user:
//      "Pay by share played"
//   D  the save forgot the opponent and the rung, so a reload re-priced a game
//      from this device's settings (the receipt half of D is tested beside the
//      server, functions/claimReceipts.test.js)
import { describe, it, expect } from 'vitest';
import {
  settleGameReward, gamePayFactor, payFactorOf, REWARD, CLOSE_LOSS, DAILY_MILESTONE_CAP, PAY_MAX,
} from './coinRewards.js';
import {
  ownGamesPlayed, playedShare, soloSeasonPurse, dynastyYearEarnings, dynastyCompletionEarnings, dynastyClaim,
  SEASON_REWARDS, DYNASTY_COMPLETION, SIMMED_OUT,
} from './modes/prizes.js';
import { makeSave, gameTerms, termsOf, claimIdOf } from './gameSave.js';
import { payNote } from './aiLevels.js';
import { createDynasty, startSeason, endSeason, HUMAN_ID } from './modes/dynasty.js';
import { buildAiLeague } from './modes/aiTeams.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE } from './modes/seasonCore.js';

const TODAY = '2026-09-18';
/** Already won today, milestone cap spent: what the NEXT game is worth. */
const spent = { date: TODAY, coins: DAILY_MILESTONE_CAP, firstWin: true };
const coins = claim => settleGameReward({ milestoneIds: [], ...claim }, spent, TODAY).coins;

describe('A — a loss pays the fair rate at every rung from Prince up', () => {
  it('pays a Deity loss the 75 completion, not 75 x 1.5 = 113', () => {
    expect(coins({ won: false, margin: -30, aiLevel: 'deity' })).toBe(REWARD.complete);
    expect(coins({ won: false, margin: -116, aiLevel: 'deity' })).toBe(REWARD.complete);
    expect(coins({ won: false, margin: -30, aiLevel: 'king' })).toBe(REWARD.complete);
    // A close loss keeps its consolation, at the fair rate.
    expect(coins({ won: false, margin: -3, aiLevel: 'deity' })).toBe(REWARD.complete + CLOSE_LOSS.coins);
  });

  it('treats a tie as a loss', () => {
    expect(coins({ won: false, margin: 0, aiLevel: 'deity' })).toBe(REWARD.complete + CLOSE_LOSS.coins);
  });

  it('still pays a Deity WIN its premium', () => {
    expect(coins({ won: true, margin: 20, aiLevel: 'deity' })).toBe(Math.round(coins({ won: true, margin: 20, aiLevel: 'prince' }) * PAY_MAX));
  });

  it('keeps the discount below Prince, so a Settler loss never out-pays a Settler win', () => {
    const loss = coins({ won: false, margin: -30, aiLevel: 'settler' });
    expect(loss).toBe(Math.round(REWARD.complete * 0.5));
    for (const m of [1, 10, 50]) expect(coins({ won: true, margin: m, aiLevel: 'settler' })).toBeGreaterThan(loss);
  });

  it('says why a premium rung paid the fair rate', () => {
    const r = settleGameReward({ won: false, margin: -30, aiLevel: 'deity', milestoneIds: [] }, spent, TODAY);
    expect(r.breakdown.some(b => /Deity premium · paid on a win/.test(b.label) && b.coins === 0)).toBe(true);
    expect(r.breakdown.reduce((t, b) => t + b.coins, 0)).toBe(r.coins);
  });

  it('leaves PvP at the top rate win or lose — the user\'s rule for PvP', () => {
    expect(coins({ won: false, pvp: true, margin: -30 })).toBe(Math.round(REWARD.complete * PAY_MAX));
  });
});

describe('B — a coach that did not draw its own team pays at most 1x', () => {
  it('pays a Team Builder Rosters win at Deity what a Prince win pays (263 before)', () => {
    // The investigation's farm: best ten against a built junk ten, 100% wins by ~90.
    const farm = coins({ won: true, margin: 90, aiLevel: 'deity', rungDraw: false });
    expect(farm).toBe(coins({ won: true, margin: 90, aiLevel: 'prince' }));
    expect(farm).toBeLessThan(263);
  });

  it('pays a Quick Match at Deity (both teams at the plain cap) at most 1x', () => {
    for (const m of [-20, -3, 5, 40]) {
      expect(coins({ won: m > 0, margin: m, aiLevel: 'deity', rungDraw: false }), `margin ${m}`)
        .toBe(coins({ won: m > 0, margin: m, aiLevel: 'prince' }));
    }
  });

  it('keeps the Settler discount on a custom game — it never pays MORE for being custom', () => {
    expect(coins({ won: true, margin: 20, aiLevel: 'settler', rungDraw: false })).toBe(coins({ won: true, margin: 20, aiLevel: 'settler' }));
  });

  it('names the reason in the breakdown', () => {
    const r = settleGameReward({ won: true, margin: 20, aiLevel: 'deity', rungDraw: false, milestoneIds: [] }, spent, TODAY);
    expect(r.breakdown.some(b => /only when the coach draws its own team/.test(b.label))).toBe(true);
  });

  it('is one factor for every caller', () => {
    expect(gamePayFactor({ aiLevel: 'deity', won: true, rungDraw: true })).toBe(1.5);
    expect(gamePayFactor({ aiLevel: 'deity', won: true, rungDraw: false })).toBe(1);
    expect(gamePayFactor({ aiLevel: 'deity', won: false, rungDraw: true })).toBe(1);
    expect(gamePayFactor({ aiLevel: 'warlord', won: false, rungDraw: false })).toBe(payFactorOf('warlord'));
    // Missing is "drawn" in the table; the server never lets it go missing.
    expect(gamePayFactor({ aiLevel: 'king', won: true })).toBe(1.25);
  });

  it('tells the picker that the premium is a win\'s', () => {
    expect(payNote('deity')).toBe('a win pays 150%');
    expect(payNote('prince')).toBe('full rate');
    expect(payNote('settler')).toBe('pays 50%');
  });
});

// ── C ────────────────────────────────────────────────────────────────────────

const you = { id: 'you', human: true };
const r = (home, away, simulated = false) => ({ home, away, homeScore: 100, awayScore: 90, ...(simulated ? { simulated: true } : {}) });

describe('C — title money by the share of your own games you played', () => {
  // Four of yours (two played, two simmed), and AI games that never count.
  const results = [r('you', 'a'), r('b', 'you', true), r('a', 'b', true), r('you', 'b'), r('a', 'you', true), r('b', 'a', true)];

  it('counts your games only, a simulated one as not played', () => {
    expect(ownGamesPlayed(results, 'you')).toEqual({ played: 2, total: 4 });
    expect(playedShare({ played: 2, total: 4 })).toBe(0.5);
    expect(playedShare({ played: 0, total: 0 })).toBe(1);
  });

  it('pays a champion who simmed half of their games half the purse', () => {
    const season = { teams: [you, { id: 'a' }, { id: 'b' }], length: 'quick', phase: 'done', champion: 'you', results };
    const p = soloSeasonPurse(season);
    expect(p.coins).toBe(SEASON_REWARDS.quick.champion / 2);
    expect(p.label).toBe('Season Champion · 2 of 4 games played');
  });

  it('pays the full purse for a season played in full, and nothing for one simmed in full', () => {
    const played = results.map(x => ({ ...x, simulated: x.home !== 'you' && x.away !== 'you' }));
    expect(soloSeasonPurse({ teams: [you], length: 'quick', champion: 'you', results: played }).coins).toBe(SEASON_REWARDS.quick.champion);
    const simmed = results.map(x => ({ ...x, simulated: true }));
    const p = soloSeasonPurse({ teams: [you], length: 'quick', champion: 'you', results: simmed });
    expect(p.coins).toBe(0);
    expect(p.simmedOut).toBe(true);
  });

  it('pays a solo dynasty year and its ten-year bonus by the share, and a friends dynasty in full', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({ year: i + 1, champion: 'you', runnerUp: 'x', playoffSeeds: ['you', 'x'], own: { played: 3, total: 6 } }));
    const solo = { humanId: 'you', humans: ['you'], length: 'quick', startMode: 'own', phase: 'done', history };
    expect(dynastyYearEarnings(solo, 1).coins).toBe(SEASON_REWARDS.quick.champion / 2);
    expect(dynastyYearEarnings(solo, 1).label).toMatch(/3 of 6 games played/);
    expect(dynastyClaim(solo, 1).coins).toBe(SEASON_REWARDS.quick.champion / 2);
    const full = Math.floor(DYNASTY_COMPLETION.quick + 10 * 150);
    expect(dynastyCompletionEarnings(solo).coins).toBe(Math.floor(full / 2));
    // A year closed before the count existed has no `own` — paid in full.
    const legacy = { ...solo, history: history.map(({ own, ...h }) => h) };
    expect(dynastyYearEarnings(legacy, 1).coins).toBe(SEASON_REWARDS.quick.champion);
    // Every game simmed: nothing, and the claim says why.
    const idle = { ...solo, history: history.map(h => ({ ...h, own: { played: 0, total: 6 } })) };
    expect(dynastyClaim(idle, 1)).toEqual({ error: SIMMED_OUT });
    // A coach of a friends dynasty is paid by league.js with their own team
    // id, and friends' entries carry no count: untouched.
    const friends = { ...legacy, humanId: 'h:u1', humans: ['h:u1', 'h:u2'], history: legacy.history.map(h => ({ ...h, champion: 'h:u2' })) };
    expect(dynastyYearEarnings(friends, 1, 'h:u2').coins).toBe(SEASON_REWARDS.quick.champion);
  });
});

// ── D: the save knows its terms ──────────────────────────────────────────────

describe('D — a save carries the terms it was dealt with', () => {
  const game = { done: true, teamA: { score: 120, stats: [] }, teamB: { score: 70, stats: [] } };

  it('keeps a hotseat game hotseat through a reload', () => {
    const save = JSON.parse(JSON.stringify(makeSave(game, null, 'g1', { terms: gameTerms({ opponent: 'human', aiLevel: 'deity' }) })));
    expect(termsOf(save, 'deity')).toEqual({ opponent: 'human', aiLevel: null, rungDraw: false });
  });

  it('keeps the rung it was dealt at, whatever this device says now', () => {
    const save = JSON.parse(JSON.stringify(makeSave(game, null, 'g2', { terms: gameTerms({ opponent: 'ai', aiLevel: 'settler', rungDraw: true }) })));
    expect(termsOf(save, 'deity').aiLevel).toBe('settler');
  });

  it('prices an old save with no terms as a custom game against the coach — paid once, at most 1x', () => {
    const old = makeSave(game, null, null);
    expect(termsOf(old, 'deity')).toEqual({ opponent: 'ai', aiLevel: 'deity', rungDraw: false });
  });

  it('carries the paid stamp and the claim key', () => {
    const save = makeSave(game, { key: 's1:r3m1' }, null, { paid: { coins: 98, breakdown: [] } });
    expect(save.paid.coins).toBe(98);
    expect(claimIdOf(save)).toBe('fixture:s1:r3m1');
    expect(claimIdOf(makeSave(game, null, 'abc'))).toBe('game:abc');
  });
});

// ── C, where the dynasty keeps the count ─────────────────────────────────────

describe('C — a solo dynasty year files the share its coach played', () => {
  const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };

  /** Every regular-season game home-wins; every other game of YOURS is simmed. */
  function finishHalfSimmed(d) {
    let s = d.season;
    let mine = 0;
    for (let r = 0; r < totalRounds(s); r += 1) {
      for (const f of roundFixtures(s)) {
        if (f.result) continue;
        const yours = f.home === HUMAN_ID || f.away === HUMAN_ID;
        const simulated = yours ? (mine++ % 2 === 1) : true;
        s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 100, awayScore: 90, simulated });
      }
      s = advance(s);
    }
    for (let guard = 0; guard < 20 && s.phase !== PHASE.done; guard += 1) {
      const m = s.bracket.matches.find(x => !x.winner && x.a && x.b);
      if (!m) break;
      s = recordResult(s, { fixtureId: m.id, home: m.a, away: m.b, homeScore: 120, awayScore: 100, simulated: true });
    }
    return { ...d, season: s };
  }

  it('records own: { played, total } from the season\'s results, and the year pays by it', () => {
    const rng = seeded(4);
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    let d = createDynasty({ id: 'dyn', size: 4, length: 'short', startMode: 'own', rng: seeded(2), human: { name: 'Me', roster: brought } });
    d = startSeason(d, { rng });
    const played = finishHalfSimmed(d);
    const own = ownGamesPlayed(played.season.results, HUMAN_ID);
    d = endSeason(played, { rng });
    expect(d.history[0].own).toEqual(own);
    expect(own.total).toBeGreaterThan(own.played);
    expect(own.played).toBeGreaterThan(0);
    const full = dynastyYearEarnings({ ...d, history: [{ ...d.history[0], own: undefined }] }, 1);
    const paid = dynastyYearEarnings(d, 1);
    expect(paid.coins).toBe(Math.floor(full.coins * (own.played / own.total)));
  });
});
