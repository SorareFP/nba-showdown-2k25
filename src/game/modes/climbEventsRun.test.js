// THE CLIMB'S ? STOPS (2026-10-25, docs/plans/2026-10-25-the-climb-events-and-
// styles-draft.md; the user: "Those work"). A scene with two choices, each a
// trade-off; like a Rest Day it is no game, clears the floor and raises the
// cap, and each scene comes once a run.
import { describe, it, expect } from 'vitest';
import {
  newRun, chooseCamp, chooseStop, chooseEvent, eventView, drawEvent, presetFor, recordResult, pickPlayer,
  rosterCards, twoWayCard, openStops, needsRelease, runView, runFromView, CLIMB,
} from './run.js';
import { EVENT_IDS, EVENTS } from './climbEvents.js';
import { boostsOf } from './climbPerks.js';
import { stopById, generateMap, potOfRun, MAP_VERSION } from './climbMap.js';
import { capSal } from '../teamRules.js';
import { getStrat } from '../strats.js';
import { canPlayCard } from '../canPlay.js';
import { execCard } from '../execCard.js';
import { newGame, getTeam } from '../engine.js';
import { CARDS } from '../cards.js';
import { cardKey, getCardByKey } from '../cardSets.js';

const SIX = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).filter((c, i, all) => all.findIndex(d => d.id === c.id) === i).slice(60, 66);   // six that fit the $2,200 cap
function camped(n = 6) {
  const r = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: SIX.slice(0, n).map(cardKey), now: 1 });
  return { ...chooseCamp(r, { playbook: 'speed', boon: r.camp.boons.find(b => b !== 'cut_two') }), dropOdds: { player: -1, perk: -1 } };
}
/** The run on a ? stop with this scene, as the draw deals it (its own player). */
function at(id, run = camped()) {
  const ev = run.map.floors.flat().find(s => s.kind === 'event') ?? run.map.floors[1][0];
  for (let seed = 0; seed < 500; seed += 1) {
    const e = drawEvent({ ...run, seed }, ev.id);
    if (e.id === id) return { ...run, seed, status: 'event', event: e };
  }
  throw new Error(`no seed draws ${id}`);
}
const ids = run => rosterCards(run).cards.map(c => c.id);
/** The first Game of the map, chosen. */
const atGame = run => chooseStop({ ...run, status: 'map', at: null }, openStops({ ...run, status: 'map', at: null }).find(s => s.kind === 'game').id);

describe('a ? stop', () => {
  it('opens its scene, and leaving it clears the floor, raises the cap and spends the scene', () => {
    const run = camped();
    const ev = run.map.floors.flat().find(s => s.kind === 'event');
    expect(ev).toBeTruthy();
    const below = run.map.floors[ev.floor - 2].find(s => s.next.includes(ev.id));
    const there = chooseStop({ ...run, at: below.id, cleared: [below.id] }, ev.id);
    expect(there.status).toBe('event');
    expect(EVENT_IDS).toContain(there.event.id);
    const v = eventView(there);
    expect(v.choices).toHaveLength(2);
    const choice = v.choices.find(c => !c.problem);
    const left = chooseEvent(there, choice.id);
    expect(['map', 'reward']).toContain(left.status);
    expect(left.at).toBe(ev.id);
    expect(left.cap).toBe(run.cap + CLIMB.capPerFloor);
    expect(left.eventsSeen).toEqual([there.event.id]);
    // The same scene never comes twice.
    for (let i = 0; i < 20; i += 1) expect(drawEvent({ ...left, seed: 1000 + i }, ev.id).id).not.toBe(there.event.id);
  });

  it('come only on new runs: a run saved without a map version rebuilds its version 1 map', () => {
    const run = camped();
    expect(run.mapVersion).toBe(MAP_VERSION);
    const { mapVersion, ...unstamped } = runView(run);
    expect(generateMap(run.seed, 1)).not.toEqual(generateMap(run.seed, 2));
    expect(runFromView(unstamped).map).toEqual(generateMap(run.seed, 1));
    const won = generateMap(run.seed, 1).floors.slice(0, 3).map(f => f.find(s => s.kind === 'game')?.id).filter(Boolean);
    expect(potOfRun({ ...unstamped, cleared: won }).coins).toBeGreaterThan(0);
    expect(potOfRun({ ...unstamped, cleared: won })).toEqual(potOfRun({ ...unstamped, mapVersion: 1, cleared: won }));
  });

  it('names each scene\'s words and its two choices', () => {
    for (const id of EVENT_IDS) {
      expect(EVENTS[id].title, id).toBeTruthy();
      expect(Object.keys(EVENTS[id].choices), id).toHaveLength(2);
    }
  });
});

describe('the scenes', () => {
  it('Trade Call: one of three better players for your lowest-paid, the cap still fitting', () => {
    const run = at('trade_call');
    const low = [...rosterCards(run).cards].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id))[0];
    expect(run.event.target).toBe(low.id);
    const offer = chooseEvent(run, 'take');
    expect(offer.status).toBe('reward');
    expect(offer.offers.players.length).toBeGreaterThan(0);
    const k = offer.offers.players[0];
    expect(getCardByKey(k).salary).toBeGreaterThan(low.salary);
    const done = pickPlayer(offer, k);
    expect(ids(done)).not.toContain(low.id);
    expect(done.roster).toContain(k);
    expect(done.roster).toHaveLength(run.roster.length);
    expect(done.status).toBe('map');
  });

  it('Locker-Room Dispute: the highest-paid sits the next game, or everyone carries 4 minutes', () => {
    const run = at('locker_room');
    const top = [...rosterCards(run).cards].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).at(-1);
    expect(run.event.target).toBe(top.id);
    expect(eventView(run).choices[0].label).toBe(`${top.name} sits the next game`);
    const sat = chooseEvent(run, 'sit');
    const p = presetFor(atGame(sat));
    expect(p.rosterA.map(c => c.id)).not.toContain(top.id);
    expect(p.rosterA).toHaveLength(5);
    const tired = chooseEvent(run, 'grind');
    expect(Object.values(tired.fatigue)).toEqual(ids(run).map(() => 4));
  });

  it('Film Room and Team Meeting: a practice or two cuts on the map; a rested team', () => {
    expect(chooseEvent(at('film_room'), 'upgrade').freePractice).toBe(1);
    expect(chooseEvent(at('film_room'), 'cut').freeCut).toBe(2);
    expect(chooseEvent({ ...at('team_meeting'), fatigue: { x: 9 } }, 'rest').fatigue).toEqual({});
    expect(chooseEvent(at('team_meeting'), 'upgrade').freePractice).toBe(1);
  });

  it('Two-Way Contract: a cheap player, off the cap and the roster, for three games', () => {
    const offer = chooseEvent(at('two_way'), 'sign');
    const k = offer.offers.players[0];
    expect(getCardByKey(k).salary).toBeLessThanOrEqual(250);
    const signed = pickPlayer(offer, k);
    expect(signed.roster).toHaveLength(6);
    expect(twoWayCard(signed)?.id).toBe(getCardByKey(k).id);
    let r = signed;
    for (let g = 0; g < 3; g += 1) {
      const game = atGame({ ...r, cleared: [] });
      expect(presetFor(game).rosterA.map(c => c.id)).toContain(getCardByKey(k).id);
      r = recordResult(game, { stopId: game.game.stopId, won: true, margin: 6 });
      r = { ...r, status: 'map', offers: null };
    }
    expect(twoWayCard(r)).toBeNull();
  });

  it('Summer-League Tape: a rare and a Bad Contract, which is never played', () => {
    const run = at('summer_tape');
    const done = chooseEvent(run, 'take');
    expect(done.deck.bad_contract).toBe(1);
    const added = Object.keys(done.deck).filter(id => (done.deck[id] ?? 0) > (run.deck[id] ?? 0) && id !== 'bad_contract');
    expect(getStrat(added[0]).rarity).toBe('rare');
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
    g.phase = 'matchup_strats'; g.placementStep = 10; getTeam(g, 'A').hand = ['bad_contract'];
    expect(canPlayCard(g, 'A', 'bad_contract').canPlay).toBe(false);
    expect(execCard(g, 'A', 'bad_contract', {}).ok).toBe(false);
  });

  it('Injury Scare: a gamble on the next game, or a sure rest with a fresh tracker', () => {
    const run = { ...at('injury_scare'), fatigue: {} };
    const who = run.event.target;
    const gamble = chooseEvent(run, 'gamble').nextGame;
    expect(gamble.sit?.[0] === who || gamble.hot?.[who] === 2).toBe(true);
    const rest = chooseEvent({ ...run, fatigue: { [who]: 10 } }, 'rest');
    expect(rest.nextGame.sit).toEqual([who]);
    expect(rest.fatigue[who]).toBeUndefined();
  });

  it('Veteran Minimum: a long-career player, half their salary on the cap', () => {
    const offer = chooseEvent(at('veteran_min', camped(5)), 'sign');
    const k = offer.offers.players[0];
    const signed = pickPlayer(offer, k);
    const vet = rosterCards(signed).cards.find(c => c.id === getCardByKey(k).id);
    expect(vet.salary).toBe(Math.round(getCardByKey(k).salary * 0.5));
    // Room for half their salary is room enough: no release asked.
    const half = Math.round(getCardByKey(k).salary * 0.5);
    const tight = { ...offer, cap: capSal(rosterCards(offer).cards) + half };
    expect(needsRelease(tight, k)).toBe(false);
    expect(pickPlayer(tight, k).roster).toContain(k);
    expect(needsRelease({ ...tight, cap: tight.cap - 1 }, k)).toBe(true);
    // A trade for them asks for better than their card, not their cap hit; and
    // once they are gone, their half salary goes with them.
    const call = { ...signed, status: 'event', event: { id: 'trade_call', stopId: signed.event?.stopId ?? offer.offers.stopId, target: getCardByKey(k).id } };
    const traded = chooseEvent(call, 'take');
    for (const t of traded.offers.players) expect(getCardByKey(t).salary).toBeGreaterThan(getCardByKey(k).salary);
    expect(traded.offers.players.length).toBeGreaterThan(0);
    const after = pickPlayer(traded, traded.offers.players[0]);
    expect(after.roster).not.toContain(k);
    expect(after.discounts?.[k]).toBeUndefined();
  });

  it('Front-Office Leak: the next two floors scouted, or $200 of cap', () => {
    const run = at('front_office_leak');
    const scout = chooseEvent(run, 'scout');
    const floor = stopById(run.map, run.event.stopId).floor;
    expect(scout.scouted.length).toBeGreaterThan(0);
    for (const id of scout.scouted) expect(stopById(run.map, id).floor).toBeGreaterThan(floor);
    expect(chooseEvent(run, 'cap').cap).toBe(run.cap + CLIMB.capPerFloor + 200);
  });

  it('Hot Streak: hot markers for the two highest-paid, or +1 Power for all, in the next game', () => {
    const run = at('hot_streak');
    const hot = presetFor(atGame(chooseEvent(run, 'hot')));
    expect(Object.keys(hot.gameOpts.hot.A)).toHaveLength(2);
    const power = presetFor(atGame(chooseEvent(run, 'power')));
    const plain = presetFor(atGame(run));
    expect(power.rosterA[0].power).toBe(plain.rosterA[0].power + 1);
  });

  it('Contract Year: +1 Speed and +1 Power for the run, $150 more on the cap', () => {
    const run = at('contract_year');
    const who = run.event.target;
    const paid = chooseEvent(run, 'pay');
    expect(boostsOf(paid)[who]).toEqual({ speed: 1, power: 1 });
    const before = rosterCards(run).cards.find(c => c.id === who).salary;
    expect(rosterCards(paid).cards.find(c => c.id === who).salary).toBe(before + 150);
  });

  it('Back-to-Back: tired legs and a sure perk on a win, or a full rest', () => {
    const run = { ...at('back_to_back'), fatigue: {} };
    const played = chooseEvent(run, 'play');
    expect(Object.values(played.fatigue).every(n => n === 4)).toBe(true);
    const game = atGame(played);
    const won = recordResult(game, { stopId: game.game.stopId, won: true, margin: 6 });
    expect(won.offers.perks.length).toBeGreaterThan(0);
    expect(won.nextGame).toBeNull();
    expect(chooseEvent({ ...run, fatigue: { x: 5 } }, 'rest').fatigue).toEqual({});
  });

  it('never deals a scene that needs a sixth to a team of five', () => {
    const five = camped(5);
    for (let i = 0; i < 40; i += 1) {
      const e = drawEvent({ ...five, seed: i }, five.map.floors[1][0].id);
      expect(['locker_room', 'injury_scare']).not.toContain(e.id);
    }
  });
});
