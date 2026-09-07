// The dynasty: a finite league, contracts in Dynasty Dollars, an off-season.
import { describe, it, expect } from 'vitest';
import {
  createDynasty, DD, MIN_ROSTER, MAX_ROSTER, resignCost, signCost, capHit,
  freeAgents, rosteredIds, rosterOf, contractsOf, endSeason, tickContracts, expiringOf,
  resign, release, releaseExpiring, signFreeAgent, draftOrder, runDraft, fillRosters,
  startNextSeason, runOffseason, CONTRACT_YEARS,
} from './dynasty.js';
import { buildAiLeague } from './aiTeams.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE } from './season.js';
import { CARDS } from '../cards.js';
import { CAP } from '../teamRules.js';

const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };

function makeDynasty({ size = 4, startMode = 'own', length = 'short' } = {}) {
  const pool = buildAiLeague(1, { rng: seeded(1) });
  return createDynasty({
    id: 'dyn',
    size,
    length,
    startMode,
    rng: seeded(2),
    humans: [{ id: 'me', name: 'Me', roster: pool[0].roster }],
  });
}

/** Drive the live season to a finished state with fed results. */
function finishSeason(dynasty) {
  let s = dynasty.season;
  for (let r = 0; r < totalRounds(s); r += 1) {
    for (const f of roundFixtures(s)) {
      if (f.result) continue;
      s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 100, awayScore: 90 });
    }
    s = advance(s);
  }
  const final = s.bracket.matches[0];
  s = recordResult(s, { fixtureId: final.id, home: final.a, away: final.b, homeScore: 120, awayScore: 100 });
  expect(s.phase).toBe(PHASE.done);
  return { ...dynasty, season: s };
}

describe('createDynasty', () => {
  it('puts every team on a contract and records the coin factor', () => {
    const d = makeDynasty();
    expect(d.teams).toHaveLength(4);
    expect(d.year).toBe(1);
    expect(d.coinFactor).toBe(1);
    for (const t of d.teams) {
      expect(t.dd).toBe(DD.perSeason);
      expect(t.contracts).toHaveLength(10);
      for (const k of t.contracts) expect(k.years).toBe(CONTRACT_YEARS.brought);
    }
    expect(makeDynasty({ startMode: 'fantasy' }).coinFactor).toBe(0.5);
    expect(() => createDynasty({ humans: [] })).toThrow(/at least one human/);
  });

  it('keeps the pool finite: rostered plus free agents is the whole set, always', () => {
    const d = makeDynasty();
    const held = rosteredIds(d);
    expect(held.size).toBe(40);
    expect(freeAgents(d).length + held.size).toBe(CARDS.length);
    // No card is on two rosters.
    const all = Object.values(d.rosters).flat();
    expect(new Set(all).size).toBe(all.length);
    for (const fa of freeAgents(d).slice(0, 20)) expect(held.has(fa.id)).toBe(false);
  });
});

describe('contracts', () => {
  it('prices re-signing at a tenth of salary a year and signing at a twentieth', () => {
    const card = { id: 'x', salary: 1000 };
    expect(resignCost(card, 1)).toBe(100);
    expect(resignCost(card, 3)).toBe(300);
    expect(signCost(card, 2)).toBe(100);
    // Never free, however cheap the card.
    expect(resignCost({ salary: 5 }, 1)).toBe(1);
  });

  it('ticks down, marks the expiring, and re-signs one for DD', () => {
    let d = makeDynasty();
    expect(expiringOf(d, 'me')).toHaveLength(0);
    d = tickContracts(tickContracts(d)); // two years: everyone is up
    const expiring = expiringOf(d, 'me');
    expect(expiring).toHaveLength(10);
    const keep = expiring[0];
    const before = d.teams.find(t => t.id === 'me').dd;
    d = resign(d, 'me', keep.cardId, 2);
    const after = d.teams.find(t => t.id === 'me');
    expect(after.dd).toBe(before - resignCost(keep.card, 2));
    expect(after.contracts.find(k => k.cardId === keep.cardId).years).toBe(2);
    // Cannot re-sign someone still under contract, or a card that is not here.
    expect(() => resign(d, 'me', keep.cardId, 1)).toThrow(/still under contract/);
    expect(() => resign(d, 'me', 'not_a_card', 1)).toThrow(/is not on/);
  });

  it('refuses a re-signing the team cannot afford', () => {
    let d = makeDynasty();
    d = tickContracts(tickContracts(d));
    d = { ...d, teams: d.teams.map(t => (t.id === 'me' ? { ...t, dd: 1 } : t)) };
    const keep = expiringOf(d, 'me')[0];
    expect(() => resign(d, 'me', keep.cardId, 3)).toThrow(/cannot afford/);
  });

  it('releases a card straight back into free agency', () => {
    let d = makeDynasty();
    const goner = d.rosters.me[0];
    d = release(d, 'me', goner);
    expect(d.rosters.me).not.toContain(goner);
    expect(freeAgents(d).some(c => c.id === goner)).toBe(true);
    expect(contractsOf(d, 'me').some(k => k.cardId === goner)).toBe(false);
    // Still conserved.
    expect(freeAgents(d).length + rosteredIds(d).size).toBe(CARDS.length);
  });

  it('signs a free agent under the cap and the roster limit', () => {
    let d = makeDynasty();
    d = release(d, 'me', d.rosters.me[0]);
    const roster = rosterOf(d, 'me');
    const room = CAP - capHit(roster);
    const target = freeAgents(d).filter(c => (c.salary ?? 0) <= room).sort((a, b) => b.salary - a.salary)[0];
    const before = d.teams.find(t => t.id === 'me').dd;
    d = signFreeAgent(d, 'me', target.id, 2);
    expect(d.rosters.me).toContain(target.id);
    expect(d.teams.find(t => t.id === 'me').dd).toBe(before - signCost(target, 2));
    expect(capHit(rosterOf(d, 'me'))).toBeLessThanOrEqual(CAP);
    // A full roster takes nobody.
    const other = freeAgents(d)[0];
    expect(() => signFreeAgent(d, 'me', other.id, 1)).toThrow(/is full/);
    // Nor can you sign a card somebody owns.
    expect(() => signFreeAgent(d, 'me', d.rosters.me[1], 1)).toThrow(/not a free agent/);
  });
});

describe('the off-season', () => {
  it('pays Dynasty Dollars on wins and the title, and files the year', () => {
    let d = finishSeason(makeDynasty());
    const before = Object.fromEntries(d.teams.map(t => [t.id, t.dd]));
    d = endSeason(d);
    expect(d.phase).toBe('offseason');
    expect(d.history).toHaveLength(1);
    expect(d.history[0].year).toBe(1);
    for (const t of d.teams) {
      const wins = t.lastSeason.wins;
      const title = t.lastSeason.title ? DD.forTitle : 0;
      expect(t.dd).toBe(before[t.id] + DD.perSeason + wins * DD.perWin + title);
    }
    expect(d.teams.filter(t => t.lastSeason.title)).toHaveLength(1);
  });

  it('refuses to close a season that is still being played', () => {
    expect(() => endSeason(makeDynasty())).toThrow(/not finished/);
  });

  it('drafts worst-first and snakes back', () => {
    let d = endSeason(finishSeason(makeDynasty()));
    const order = draftOrder(d, 2);
    expect(order).toHaveLength(8);
    const firstRound = order.slice(0, 4);
    const secondRound = order.slice(4);
    expect(secondRound).toEqual([...firstRound].reverse());
    // The worst team of the year picks first.
    const table = d.history[0].table;
    expect(firstRound[0]).toBe([...table].sort((a, b) => b.rank - a.rank)[0].id);
  });

  it('runs a whole off-season and keeps every roster legal and the pool conserved', () => {
    let d = endSeason(finishSeason(makeDynasty()));
    d = tickContracts(tickContracts(d)); // everybody expires
    d = runOffseason(d);
    for (const t of d.teams) {
      const roster = rosterOf(d, t.id);
      expect(roster.length).toBeGreaterThanOrEqual(MIN_ROSTER);
      expect(roster.length).toBeLessThanOrEqual(MAX_ROSTER);
      expect(capHit(roster)).toBeLessThanOrEqual(CAP);
      for (const k of contractsOf(d, t.id)) expect(k.years).toBeGreaterThan(0);
    }
    const all = Object.values(d.rosters).flat();
    expect(new Set(all).size).toBe(all.length);
    expect(freeAgents(d).length + rosteredIds(d).size).toBe(CARDS.length);
  });

  it('starts the next season on the dynasty rosters, not a fresh league', () => {
    let d = endSeason(finishSeason(makeDynasty()));
    d = tickContracts(d); // one year left: nobody expires
    d = runOffseason(d);
    const mine = [...d.rosters.me];
    d = startNextSeason(d, { rng: seeded(3) });
    expect(d.year).toBe(2);
    expect(d.phase).toBe('season');
    expect(d.season.teams).toHaveLength(4);
    const meTeam = d.season.teams.find(t => t.id === 'me');
    expect(meTeam.human).toBe(true);
    expect(meTeam.roster.map(c => c.id).sort()).toEqual(mine.sort());
    expect(d.season.teams.filter(t => t.human)).toHaveLength(1);
    expect(d.season.fixtures.every(f => f.result === null)).toBe(true);
  });

  it('will not start a season with a short roster', () => {
    let d = makeDynasty();
    for (const id of [...d.rosters.me].slice(0, 4)) d = release(d, 'me', id);
    expect(rosterOf(d, 'me')).toHaveLength(6);
    expect(() => startNextSeason(d)).toThrow(/below 8 players/);
  });
});
