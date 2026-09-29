// THE SUPER SEASON IS THE MOST VALUABLE SEASON (2026-09-24) — the value pick's
// choice and bookkeeping, on hand-made cards.
import { describe, it, expect } from 'vitest';
import {
  candidateSelections, pickByValue, nextRetired, absorbedCard, asThrowback, VALUE_REPICK,
} from './superSeasonValue.js';
import { BEST_SEASON_MIN_GAMES, BEST_SEASON_MIN_MINUTES } from './history.js';

const row = (season, games = 70, minutes = 2200) => ({ season, games, minutes });
const incumbent = (id, season) => ({ player: { name: id, pos: 'G' }, season: { playerId: id, season } });

describe('candidateSelections', () => {
  const careers = {
    a: [row(2010), row(2011), row(2012, 20, 400), row(2013), row(2026)],
  };
  const selectionFor = (inc, season) => incumbent(inc.season.playerId, season);

  it('offers every eligible season but the incumbent, and none the caller excludes', () => {
    const out = candidateSelections([incumbent('a', 2011)], {
      careerOf: id => careers[id],
      selectionFor,
      exclude: (id, s) => s >= 2026 || s === 2010,
    });
    expect(out.map(s => s.season.season)).toEqual([2013]);
    expect(out[0].candidateFor).toBe('a');
  });

  it('uses the box-score rule\'s own floors: a thin season never competes while a full one exists', () => {
    const out = candidateSelections([incumbent('a', 2011)], { careerOf: id => careers[id], selectionFor });
    expect(out.map(s => s.season.season)).not.toContain(2012);
    expect(BEST_SEASON_MIN_GAMES).toBeGreaterThan(20);
    expect(BEST_SEASON_MIN_MINUTES).toBeGreaterThan(400);
  });
});

describe('pickByValue', () => {
  const card = (bbrefId, season, salary, extra = {}) => ({ bbrefId, name: bbrefId, season, salary, ...extra });

  it('keeps the most valuable season and reports the move', () => {
    const cards = [card('a', 2014, 1400), card('a', 2016, 1410), card('b', 2001, 800), card('b', 2003, 790)];
    const { winners, repicks, losers } = pickByValue(cards, new Map([['a', 2014], ['b', 2001]]));
    expect(winners.get('a').season).toBe(2016);
    expect(winners.get('b').season).toBe(2001);
    expect(repicks).toEqual([{ name: 'a', bbrefId: 'a', from: { season: 2014, salary: 1400 }, to: { season: 2016, salary: 1410 } }]);
    expect(losers.map(c => `${c.bbrefId}${c.season}`).sort()).toEqual(['a2014', 'b2003']);
  });

  it('keeps the declared season on a tie', () => {
    const { winners } = pickByValue([card('a', 2014, 1400), card('a', 2016, 1400)], new Map([['a', 2014]]));
    expect(winners.get('a').season).toBe(2014);
  });

  it('never lets a synthetic chart win, and lists it to be fetched', () => {
    const { winners, unweighed } = pickByValue(
      [card('a', 2014, 1400), card('a', 2013, 1950, { provisional: true })],
      new Map([['a', 2014]])
    );
    expect(winners.get('a').season).toBe(2014);
    expect(unweighed.map(c => c.season)).toEqual([2013]);
  });

  // THE SHIPPED SEASON HOLDS THE CARD (2026-09-29): a rebuild that changed only
  // rebounds and assists re-chose fifteen Super Seasons on gaps of $0-50.
  describe('with a holder and a margin', () => {
    const declared = new Map([['a', 2014]]);
    const holder = new Map([['a', 2016]]);   // 2016 ships today, though 2014 is the declared season

    it('keeps the shipped season against a challenger inside the margin, ties included', () => {
      const { winners, repicks } = pickByValue([card('a', 2014, 1420), card('a', 2016, 1400), card('a', 2018, 1440)], declared, { holderSeason: holder, margin: 50 });
      expect(winners.get('a').season).toBe(2016);
      expect(repicks).toEqual([]);
    });

    it('hands the card over when a challenger clears the margin, and reports the move from the holder', () => {
      const { winners, repicks } = pickByValue([card('a', 2014, 1400), card('a', 2016, 1400), card('a', 2018, 1460)], declared, { holderSeason: holder, margin: 50 });
      expect(winners.get('a').season).toBe(2018);
      expect(repicks).toEqual([{ name: 'a', bbrefId: 'a', from: { season: 2016, salary: 1400 }, to: { season: 2018, salary: 1460 } }]);
    });

    it('lets challengers that both clear the holder compete on price alone', () => {
      const { winners } = pickByValue([card('a', 2016, 1400), card('a', 2018, 1460), card('a', 2019, 1470)], declared, { holderSeason: holder, margin: 50 });
      expect(winners.get('a').season).toBe(2019);
    });

    it('applies no margin to a player with nothing shipped, and none when the shipped season is not in the batch', () => {
      const plain = pickByValue([card('b', 2001, 800), card('b', 2003, 810)], new Map([['b', 2001]]), { holderSeason: holder, margin: 50 });
      expect(plain.winners.get('b').season).toBe(2003);
      const gone = pickByValue([card('a', 2014, 1400), card('a', 2018, 1410)], declared, { holderSeason: new Map([['a', 1999]]), margin: 50 });
      expect(gone.winners.get('a').season).toBe(2018);
    });

    it('is the old rule at margin zero', () => {
      const { winners } = pickByValue([card('a', 2014, 1400), card('a', 2016, 1400), card('a', 2018, 1410)], declared, { holderSeason: holder, margin: 0 });
      expect(winners.get('a').season).toBe(2018);
    });
  });
});

describe('nextRetired', () => {
  const names = new Map([['a', 'A'], ['b', 'B']]);

  it('retires a shipped season that is no longer the Super Season, and keeps it retired', () => {
    const first = nextRetired([], { shipped: [['a', 2014], ['b', 2001]], current: new Map([['a', 2016], ['b', 2001]]), names, today: 'D1' });
    expect(first).toEqual([{ name: 'A', bbrefId: 'a', season: 2014, since: 'D1', reason: VALUE_REPICK }]);
    // Next run: the shipped file now holds 2016; 2014 stays retired.
    const second = nextRetired(first, { shipped: [['a', 2016]], current: new Map([['a', 2016]]), names, today: 'D2' });
    expect(second).toEqual(first);
  });

  it('un-retires a season that becomes the Super Season again', () => {
    const was = [{ name: 'A', bbrefId: 'a', season: 2014, since: 'D1', reason: VALUE_REPICK }];
    const out = nextRetired(was, { shipped: [['a', 2016]], current: new Map([['a', 2014]]), names, today: 'D3' });
    expect(out.map(r => r.season)).toEqual([2016]);
  });

  it('retires a shipped Throwback season too (one player, two shipped seasons)', () => {
    const out = nextRetired([], { shipped: [['a', 2002], ['a', 2007]], current: new Map(), names, today: 'D1' });
    expect(out.map(r => r.season).sort()).toEqual([2002, 2007]);
  });
});

describe('the swap and the demotion', () => {
  it('absorbs a requested card of the same regular season, never a playoff run', () => {
    const ss = { bbrefId: 'moorema01w', season: 2016 };
    const fa = { bbrefId: 'moorema01w', season: 2016, set: 'wnba-throwbacks', id: 'Maya_Moore_2016' };
    expect(absorbedCard(ss, [fa])).toEqual({ set: 'wnba-throwbacks', id: 'Maya_Moore_2016' });
    expect(absorbedCard(ss, [{ ...fa, playoffRun: true }])).toBeNull();
    expect(absorbedCard(ss, [{ ...fa, season: 2014 }])).toBeNull();
  });

  it('demotes under the Throwback id and look, remembering where it came from', () => {
    const t = asThrowback(
      { id: 'Maya_Moore', season: 2014, badges: ['super-season', 'rookie'], notBestSeason: true, migratedFrom: { set: 'x', id: 'y' } },
      { set: 'wnba-throwbacks', fromSet: 'wnba-super-season', reason: 'r' }
    );
    expect(t).toMatchObject({ id: 'Maya_Moore_2014', set: 'wnba-throwbacks', demoted: 'r', demotedFrom: { set: 'wnba-super-season', id: 'Maya_Moore' }, badges: ['rookie'] });
    expect(t.notBestSeason).toBeUndefined();
    expect(t.migratedFrom).toBeUndefined();
  });
});
