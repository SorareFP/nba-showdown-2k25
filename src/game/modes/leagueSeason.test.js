// A SHARED SEASON, end to end without a database: the host builds the season
// from the entrants exactly as SeasonTab's LeagueSeason does, the server's
// startSeason accepts it, results move the calendar, and the title money
// lands on every human at the end. Pins the seam between three modules —
// league.js, season.js and the seasons.js key round-trip — that no single
// module's tests cover.
import { describe, it, expect } from 'vitest';
import {
  newLeague, entrantFor, addEntrant, startSeason, applyResult, openFixtures, canReport, isHumanVsHumanFixture, STATUS,
} from './league.js';
import { createSeason, PHASE, roundFixtures, teamsById } from './season.js';
import { dehydrate, hydrate } from '../../firebase/seasons.js';
import { simulateFixture } from './simulate.js';
import { rostersOf } from './seasonCore.js';
import { CARDS } from '../cards.js';
import { cardKey } from '../cardSets.js';

const roster = n => CARDS.slice(n * 10, n * 10 + 10);
const entrant = (uid, n) => entrantFor(uid, { name: `Team ${uid}`, roster: roster(n).map(cardKey) });
const seeded = (s = 11) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };

/** What LeagueSeason.start does: entrants → createSeason → keys for the wire. */
function hostBuilds(league) {
  const humans = league.entrants.map(e => ({
    id: e.id, name: e.name, uid: e.uid,
    roster: e.roster.map(k => CARDS.find(c => cardKey(c) === k)),
    deck: e.deck ?? null, deckName: e.deckName ?? null,
  }));
  return dehydrate(createSeason({ id: league.id, humans, size: league.settings.size, length: league.settings.length, rng: seeded() }));
}

function twoHumanLeague() {
  let l = newLeague({
    id: 'L-season', kind: 'season', name: 'Ours', hostUid: 'u1',
    settings: { size: 4, fee: 0, length: 'short' }, entrant: entrant('u1', 0), joinCode: 'ABC123', now: 1,
  });
  l = addEntrant(l, entrant('u2', 1), 2);
  return l;
}

describe('a shared season', () => {
  it('starts from what the host builds, with the entrants as its human teams', () => {
    const l = startSeason(twoHumanLeague(), hostBuilds(twoHumanLeague()), { now: 3 });
    expect(l.status).toBe(STATUS.live);
    const season = hydrate(l.state);
    expect(season.id).toBe('L-season');
    expect(season.teams).toHaveLength(4);
    expect(season.teams.filter(t => t.human).map(t => t.id).sort()).toEqual(['h:u1', 'h:u2']);
    // The round trip put the cards back on every roster, AI teams included.
    for (const t of season.teams) expect(t.roster.every(c => c && c.name)).toBe(true);
  });

  it('refuses a season whose human teams are not the entrants', () => {
    const l = twoHumanLeague();
    const built = hostBuilds(l);
    const missing = { ...built, teams: built.teams.filter(t => t.id !== 'h:u2') };
    expect(() => startSeason(l, missing)).toThrow(/human teams/);
  });

  it('plays a round: a human reports their own game, the host sims the AI game, the round moves on', () => {
    let l = startSeason(twoHumanLeague(), hostBuilds(twoHumanLeague()), { now: 3 });
    let season = hydrate(l.state);
    const round1 = roundFixtures(season);
    const by = teamsById(season);
    for (const f of round1) {
      const hh = isHumanVsHumanFixture(l, { id: f.id, home: f.home, away: f.away });
      const humanIn = by.get(f.home)?.human || by.get(f.away)?.human;
      if (hh) {
        // Needs a room; neither can report it bare.
        expect(canReport(l, 'u1', f.id)).toMatch(/room/);
        continue;
      }
      if (humanIn) {
        const uid = (by.get(f.home)?.human ? by.get(f.home) : by.get(f.away)).uid;
        expect(canReport(l, uid, f.id)).toBe(null);
        expect(canReport(l, uid === 'u1' ? 'u2' : 'u1', f.id)).toMatch(/Not your fixture/);
        l = applyResult(l, { fixtureId: f.id, homeScore: 88, awayScore: 80 }, { now: 4 }).league;
      } else {
        expect(canReport(l, 'u2', f.id, { simulated: true })).toMatch(/commissioner/);
        expect(canReport(l, 'u1', f.id, { simulated: true })).toBe(null);
        const r = simulateFixture(f, rostersOf(season), { rng: seeded(5) });
        l = applyResult(l, { fixtureId: f.id, homeScore: r.homeScore, awayScore: r.awayScore, simulated: true }, { now: 4 }).league;
      }
      season = hydrate(l.state);
    }
    // Every game the humans and the host could resolve is in the book: either
    // the round is waiting on the two coaches' game alone, or it moved on.
    const left = openFixtures(l);
    const hadHH = round1.some(f => isHumanVsHumanFixture(l, { id: f.id, home: f.home, away: f.away }));
    if (hadHH) {
      expect(left).toHaveLength(1);
      expect(isHumanVsHumanFixture(l, left[0])).toBe(true);
      expect(hydrate(l.state).round).toBe(1);
    } else {
      expect(hydrate(l.state).round).toBe(2);
    }
  });

  it('pays every human title money when the last game is in', () => {
    let l = startSeason(twoHumanLeague(), hostBuilds(twoHumanLeague()), { now: 3 });
    let guard = 0;
    while (l.status === STATUS.live && guard++ < 200) {
      const f = openFixtures(l)[0];
      // The humans win every game against an AI team, and the home side wins
      // a game between the two of them — so both top the table, both make a
      // two-team playoff, and one of them lifts it.
      const humanHome = f.home.startsWith('h:');
      const humanAway = f.away.startsWith('h:');
      const homeWins = humanHome || !humanAway;
      l = applyResult(l, { fixtureId: f.id, homeScore: homeWins ? 90 : 70, awayScore: homeWins ? 70 : 90, forfeit: humanHome && humanAway }, { now: 10 + guard }).league;
    }
    expect(l.status).toBe(STATUS.done);
    expect(l.state.phase).toBe(PHASE.done);
    expect(l.state.champion.startsWith('h:')).toBe(true);
    const paidTo = new Set(l.payouts.map(p => p.uid));
    expect(paidTo.has('u1') && paidTo.has('u2')).toBe(true);
    expect(l.payouts.every(p => p.coins > 0)).toBe(true);
    // The champion's share is the larger one.
    const champUid = l.state.champion.slice(2);
    const other = champUid === 'u1' ? 'u2' : 'u1';
    const by = Object.fromEntries(l.payouts.map(p => [p.uid, p.coins]));
    expect(by[champUid]).toBeGreaterThan(by[other]);
  });
});
