// THE CLIMB'S PERKS (relics), 2026-10-19: the user's "relics dropped by
// rivalries and bosses", the first four from "Build a player".
import { describe, it, expect } from 'vitest';
import { PERKS, PERK_IDS, PERK_CAP, LEDGER_PERKS, LEDGER_PERK_KINDS, boostsOf, boostedCard, perkProblem, perkOffer, practicable } from './climbPerks.js';
import { newRun, chooseCamp, chooseStop, recordResult, pickPerk, skipOffers, presetFor, rosterCards, openStops } from './run.js';
import { climbRng, stopById } from './climbMap.js';
import { CARDS } from '../cards.js';
import { cardKey } from '../cardSets.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const camped = () => {
  const r = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
  return chooseCamp(r, { playbook: 'speed', boon: r.camp.boons.find(b => b !== 'cut_two') });
};
/** A run on the reward screen after its first Rivalry, by walking the map to one. */
function afterRivalry() {
  let r = { ...camped(), dropOdds: { player: -1, perk: 1 } };   // a perk with every Rivalry here
  for (let guard = 0; guard < 12; guard += 1) {
    const stops = openStops(r);
    const riv = stops.find(s => s.kind === 'rivalry');
    const next = riv ?? stops.find(s => s.kind === 'game') ?? stops[0];
    r = chooseStop(r, next.id);
    if (r.status === 'rest') { r = { ...r, status: 'map', at: r.restAt, restAt: null }; continue; }
    r = recordResult(r, { stopId: next.id, won: true, margin: 6 });
    if (stopById(r.map, next.id).kind === 'rivalry') return r;
    r = skipOffers(r);
  }
  throw new Error('no rivalry reached');
}
const ids = run => rosterCards(run).cards.map(c => c.id);

describe('the perks', () => {
  it('are the drafted perks, each with its text and its target', () => {
    // The first four of "Build a player" (2026-10-19), then the 2026-10-22 draft.
    expect(PERK_IDS.slice(0, 4)).toEqual(['gym_rat', 'extra_reps', 'signature_move', 'film_study']);
    expect(PERK_IDS).toHaveLength(24);
    for (const id of PERK_IDS) {
      expect(PERKS[id].text, id).toBeTruthy();
      expect(['player', 'card', 'team'], id).toContain(PERKS[id].target);
    }
    expect(PERKS.extra_reps.step).toBe(-1);   // a lower Shot Line is the better one
    // Signature Move is +2 now: Extra Reps made the +1 redundant (the user, 2026-10-22).
    expect(PERKS.signature_move.step).toBe(2);
    expect(PERK_IDS.filter(id => PERKS[id].boss)).toEqual(['second_chance', 'win_now_trade', 'max_contract', 'heavy_minutes', 'short_rotation', 'front_office']);
    expect(PERK_IDS.filter(id => PERKS[id].shooting)).toEqual(['extra_reps', 'signature_move', 'post_moves']);
    // The server's copy of which perks it keeps agrees with the perks' own flags.
    expect([...LEDGER_PERKS].sort()).toEqual(Object.keys(LEDGER_PERK_KINDS).sort());
    for (const id of LEDGER_PERKS) expect(LEDGER_PERK_KINDS[id] === 'boss', id).toBe(Boolean(PERKS[id].boss));
  });

  it('add up per player, on copies, never on the card', () => {
    const run = { perks: [{ id: 'gym_rat', target: 'p1' }, { id: 'gym_rat', target: 'p1' }, { id: 'extra_reps', target: 'p2' }, { id: 'film_study', target: 'close_out' }] };
    expect(boostsOf(run)).toEqual({ p1: { power: 2 }, p2: { shotLine: -1 } });
    const card = { id: 'p1', power: 10, shotLine: 15 };
    const copy = boostedCard(card, { power: 2 });
    expect(copy.power).toBe(12);
    expect(card.power).toBe(10);
  });

  it('stop at three on any one number, and Film Study needs a card with a "+"', () => {
    const run = { deck: { catch_and_shoot: 2, 'close_out+': 1, twin_towers: 1 }, perks: Array.from({ length: PERK_CAP }, () => ({ id: 'gym_rat', target: 'p1' })) };
    expect(perkProblem(run, 'gym_rat', 'p1', ['p1', 'p2'])).toMatch(/past 3/);
    expect(perkProblem(run, 'extra_reps', 'p1', ['p1', 'p2'])).toBeNull();
    expect(perkProblem(run, 'gym_rat', 'nobody', ['p1'])).toMatch(/your players/);
    expect(practicable(run.deck)).toEqual(['catch_and_shoot']);
    expect(perkProblem(run, 'film_study', 'twin_towers', ['p1'])).toMatch(/"\+"/);
    expect(perkProblem(run, 'film_study', 'catch_and_shoot', ['p1'])).toBeNull();
  });

  it('are offered three at a time, seeded, and only ones that can be taken', () => {
    const run = { deck: { twin_towers: 1 }, perks: [] };
    const a = perkOffer(run, climbRng(1, 'perks'), ['p1']);
    expect(a).toHaveLength(3);
    expect(a).not.toContain('film_study');   // nothing in the deck has a "+"
    expect(perkOffer(run, climbRng(1, 'perks'), ['p1'])).toEqual(a);
  });
});

describe('a Rivalry drops a perk', () => {
  it('offers perks after a Rivalry win, never after a Game', () => {
    const r = afterRivalry();
    expect(r.status).toBe('reward');
    expect(r.offers.perks.length).toBeGreaterThan(0);
    const game = camped();
    const g1 = openStops(game).find(s => s.kind === 'game').id;
    expect(recordResult(chooseStop(game, g1), { stopId: g1, won: true, margin: 6 }).offers.perks).toEqual([]);
  });

  it('takes a player perk onto the player the game is dealt with, and keeps it', () => {
    // A player perk on offer, whatever the seed drew (twenty-four perks now).
    const drawn = afterRivalry();
    const perk = 'gym_rat';
    const r = { ...drawn, offers: { ...drawn.offers, perks: [perk, ...drawn.offers.perks.filter(id => id !== perk)].slice(0, 3) } };
    const who = ids(r)[0];
    const took = pickPerk(r, perk, who);
    expect(took.perks).toEqual([{ id: perk, target: who, at: r.cleared.length }]);
    expect(took.offers?.perks ?? []).toEqual([]);
    expect(() => pickPerk(took, perk, who)).toThrow();
    // The next game deals him with the boost; the card in the pool is untouched.
    const next = openStops({ ...took, status: 'map', offers: null }).find(s => s.kind !== 'rest');
    if (next) {
      const p = presetFor(chooseStop({ ...took, status: 'map', offers: null }, next.id));
      const him = p.rosterA.find(c => c.id === who);
      const plain = rosterCards(took).cards.find(c => c.id === who);
      for (const [stat, step] of Object.entries(boostsOf(took)[who])) expect(him[stat]).toBe((plain[stat] ?? 0) + step);
    }
  });

  it('Film Study upgrades one copy at once; a perk can be skipped', () => {
    const r = afterRivalry();
    const withStudy = { ...r, offers: { ...r.offers, perks: ['film_study'] } };
    const took = pickPerk(withStudy, 'film_study', 'catch_and_shoot');
    expect(took.deck['catch_and_shoot+']).toBe(1);
    expect(took.deck.catch_and_shoot).toBe(r.deck.catch_and_shoot - 1);
    const skipped = skipOffers(r, 'perks');
    expect(skipped.offers?.perks ?? []).toEqual([]);
    expect(skipped.perks ?? []).toEqual([]);
  });
});
