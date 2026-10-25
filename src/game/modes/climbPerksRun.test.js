// THE CLIMB'S PERKS BETWEEN GAMES (2026-10-22, docs/plans/2026-10-22-the-
// climb-perks-draft.md). What the run reads: the offers (one shooting perk an
// offer, the boss's own pool, a team perk once), what a perk does when taken,
// Training Staff, Scouting Network, Advance Scout, Shootaround, Win-Now
// Trade, Front Office Shake-Up, Travel Day, Second Chance, and the pot's two
// (Sponsorship, Max Contract), which the server prices too (climbMap.js).
import { describe, it, expect } from 'vitest';
import {
  newRun, chooseCamp, chooseStop, recordResult, pickPerk, presetFor, openStops, isTravel, restDay,
  takeFreePractice, takeFreeCut, rosterCards, recoveryFor, gamePerksOf, CLIMB, continueClimb,
} from './run.js';
import { samePlayer } from '../teamRules.js';
import { PERKS, PERK_IDS, perkOffer, perkProblem, boostsOf, WIN_NOW_CAP, TRAVEL_DAYS } from './climbPerks.js';
import { climbRng, stopById, nextStops, potOfRun, travelCost, reachableGame, SPONSOR_SHARE } from './climbMap.js';
import { CARDS } from '../cards.js';
import { cardKey, getCardByKey } from '../cardSets.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const QUIET = { player: -1, perk: -1 };
function camped() {
  const r = newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
  return { ...chooseCamp(r, { playbook: 'speed', boon: r.camp.boons.find(b => b !== 'cut_two') }), dropOdds: QUIET };
}
const withPerks = (run, ...ids) => ({ ...run, perks: [...(run.perks ?? []), ...ids.map(id => ({ id, target: null, at: run.cleared.length }))] });
const onOffer = (run, id) => ({ ...run, status: 'reward', offers: { stopId: 'x', strats: [], picks: 0, players: [], perks: [id] } });
const ids = run => rosterCards(run).cards.map(c => c.id);
/** The first Game, played: the run on its stop. */
const atFirstGame = run => chooseStop(run, openStops(run).find(s => s.kind === 'game').id);

describe('the offers', () => {
  it('never show two shooting perks, and a Game\'s or Rivalry\'s never shows a boss\'s', () => {
    const run = camped();
    for (let seed = 1; seed <= 300; seed += 1) {
      const offer = perkOffer(run, climbRng(seed, 'perks'), ids(run));
      expect(offer.filter(id => PERKS[id].shooting).length, String(seed)).toBeLessThanOrEqual(1);
      expect(offer.some(id => PERKS[id].boss), String(seed)).toBe(false);
      const boss = perkOffer(run, climbRng(seed, 'perks'), ids(run), 'boss');
      expect(boss.every(id => PERKS[id].boss), String(seed)).toBe(true);
      expect(boss).toHaveLength(3);
    }
  });

  it('offer a team perk once a run', () => {
    const run = withPerks(camped(), 'training_staff');
    expect(perkProblem(run, 'training_staff', null, ids(run))).toMatch(/Already/);
    for (let seed = 1; seed <= 100; seed += 1) expect(perkOffer(run, climbRng(seed, 'perks'), ids(run))).not.toContain('training_staff');
  });

  it('cap a player\'s number at three, a +2 perk included; Max Contract moves two', () => {
    const run = camped();
    const who = ids(run)[0];
    const two = { ...run, perks: [{ id: 'signature_move', target: who, at: 0 }] };
    expect(boostsOf(two)[who]).toEqual({ threePtBoost: 2 });
    expect(perkProblem(two, 'signature_move', who, ids(run))).toMatch(/past 3/);
    expect(perkProblem({ ...run, perks: [{ id: 'gym_rat', target: who, at: 0 }, { id: 'gym_rat', target: who, at: 0 }] }, 'max_contract', who, ids(run))).toMatch(/past 3/);
    expect(boostsOf({ perks: [{ id: 'max_contract', target: who, at: 0 }] })[who]).toEqual({ speed: 2, power: 2 });
  });
});

describe('taking one', () => {
  it('records when it was taken, and does its "now" at once', () => {
    const run = camped();
    const cap = pickPerk(onOffer(run, 'win_now_trade'), 'win_now_trade');
    expect(cap.cap).toBe(run.cap + WIN_NOW_CAP);
    expect(cap.perks).toEqual([{ id: 'win_now_trade', target: null, at: 0 }]);
    const fo = pickPerk(onOffer(run, 'front_office'), 'front_office');
    expect([fo.freePractice, fo.freeCut]).toEqual([2, 2]);
    expect(pickPerk(onOffer(run, 'travel_day'), 'travel_day').travel).toBe(TRAVEL_DAYS);
  });

  it('sends only the game-long ones to the engine', () => {
    const run = atFirstGame(withPerks(camped(), 'closers', 'training_staff', 'rim_deterrent'));
    expect(gamePerksOf(run)).toEqual(['closers', 'rim_deterrent']);
    expect(presetFor(run).gameOpts.perks).toEqual({ A: ['closers', 'rim_deterrent'] });
    expect(presetFor(atFirstGame(camped())).gameOpts.perks).toBeUndefined();
  });
});

describe('between games', () => {
  const win = (run, extra = {}) => {
    const r = atFirstGame(run);
    const endMinutes = Object.fromEntries(ids(r).map(id => [id, 12]));
    return recordResult(r, { stopId: r.game.stopId, won: true, margin: 6, endMinutes, ...extra });
  };

  it('Training Staff takes two more minutes off every tracker', () => {
    expect(Object.values(win(camped()).fatigue)).toEqual(ids(camped()).map(() => 12 - recoveryFor(6)));
    expect(win(withPerks(camped(), 'training_staff')).fatigue).toEqual({});
  });

  it('Scouting Network makes every Game\'s player sure', () => {
    expect(win(camped()).offers.players).toEqual([]);
    expect(win(withPerks(camped(), 'scouting_network')).offers.players).toHaveLength(3);
  });

  it('Advance Scout shows four strategy cards', () => {
    expect(win(camped()).offers.strats).toHaveLength(3);
    const four = win(withPerks(camped(), 'advance_scout')).offers.strats;
    expect(four).toHaveLength(4);
    // The first three are the draw without it.
    expect(four.slice(0, 3)).toEqual(win(camped()).offers.strats);
  });

  const atRest = run => ({ ...run, status: 'rest', restAt: '7-0', fatigue: { [ids(run)[0]]: 8 } });

  it('Shootaround: resting also leaves a practice on the map', () => {
    expect(restDay(atRest(camped()), { choice: 'rest' }).freePractice).toBe(0);
    const r = restDay(atRest(withPerks(camped(), 'shootaround')), { choice: 'rest' });
    expect(r.fatigue).toEqual({});
    expect(r.freePractice).toBe(1);
    const id = Object.keys(r.deck).find(k => r.deck[k] > 0 && /^close_out$/.test(k)) ?? 'close_out';
    expect(takeFreePractice(r, id).deck[`${id}+`]).toBe(1);
  });

  it('Win-Now Trade: a Rest Day cannot rest, but practises and cuts', () => {
    const run = atRest(withPerks(camped(), 'win_now_trade'));
    expect(() => restDay(run, { choice: 'rest' })).toThrow(/Win-Now/);
    expect(restDay(run, { choice: 'practice', cardId: 'close_out' }).deck['close_out+']).toBe(1);
  });

  it('Front Office Shake-Up\'s cuts come off the deck from the map', () => {
    const run = { ...camped(), freeCut: 2 };
    const cut = takeFreeCut(run, 'close_out');
    expect(cut.deck.close_out ?? 0).toBe((run.deck.close_out ?? 0) - 1);
    expect(cut.freeCut).toBe(1);
    expect(() => takeFreeCut({ ...run, freeCut: 0 }, 'close_out')).toThrow();
  });
});

describe('Travel Day', () => {
  it('opens every stop on the next floor while it lasts, and spends one going off the links', () => {
    // From a floor-1 Game, find a floor-2 stop it does not link to.
    const base = camped();
    const from = base.map.floors[0].find(s => s.next.length < 3);
    const unlinked = base.map.floors[1].find(s => !from.next.includes(s.id));
    const run = { ...base, at: from.id, travel: 1 };
    expect(openStops({ ...run, travel: 0 }).map(s => s.id)).not.toContain(unlinked.id);
    expect(openStops(run).map(s => s.id)).toContain(unlinked.id);
    expect(isTravel(run, unlinked.id)).toBe(true);
    expect(isTravel(run, from.next[0])).toBe(false);
    expect(chooseStop(run, unlinked.id).travel).toBe(0);
    expect(chooseStop(run, from.next[0]).travel).toBe(1);
  });

  it('is what the server counts: the jumps a way through Rest Days needs', () => {
    const map = camped().map;
    const from = map.floors[0].find(s => s.next.length < 3);
    const linked = stopById(map, from.next[0]);
    const unlinked = map.floors[1].find(s => !from.next.includes(s.id));
    if (!['rest', 'event'].includes(linked.kind)) expect(travelCost(map, from.id, linked.id)).toBe(0);
    if (!['rest', 'event'].includes(unlinked.kind)) {
      expect(travelCost(map, from.id, unlinked.id)).toBe(1);
      expect(reachableGame(map, from.id, unlinked.id)).toBe(false);
    }
    // Floor 1 is open to a run that has played nothing.
    expect(travelCost(map, null, map.floors[0][2].id)).toBe(0);
    expect(nextStops(map, null)).toHaveLength(3);
  });
});

describe('Second Chance', () => {
  it('replays a loss once, under a key of its own, and the next loss ends the run', () => {
    const run = atFirstGame(withPerks(camped(), 'second_chance'));
    expect(presetFor(run).climb.secondChance).toBe(true);
    const replay = recordResult(run, { stopId: run.game.stopId, won: false });
    expect(replay.status).toBe('game');
    expect(replay.secondChanceUsed).toBe(true);
    expect(replay.game.key).toBe(`${run.game.key}:2`);
    expect(presetFor(replay).key).toBe(`${run.game.key}:2`);
    expect(presetFor(replay).climb.secondChance).toBe(false);
    expect(recordResult(replay, { stopId: run.game.stopId, won: false }).status).toBe('lost');
    expect(recordResult(atFirstGame(camped()), { stopId: run.game.stopId, won: false }).status).toBe('lost');
  });
});

describe('the pot\'s perks', () => {
  const base = camped();
  const games = base.map.floors.flat().filter(s => s.kind === 'game').slice(0, 3).map(s => s.id);
  const rivalry = base.map.floors.flat().find(s => s.kind === 'rivalry').id;
  const cleared = [...games, rivalry];
  const plain = potOfRun({ ...base, cleared }).coins;

  it('Sponsorship adds a fifth more to every win after it', () => {
    const at2 = potOfRun({ ...base, cleared: cleared.slice(0, 2) }).coins;
    const sponsored = potOfRun({ ...base, cleared, perks: [{ id: 'sponsorship', at: 2 }] }).coins;
    expect(sponsored).toBe(Math.round(at2 + (plain - at2) * (1 + SPONSOR_SHARE)));
  });

  it('Max Contract: a Game after it adds nothing, a Rivalry still does', () => {
    const maxed = potOfRun({ ...base, cleared, perks: [{ id: 'max_contract', target: 'x', at: 1 }] }).coins;
    const first = potOfRun({ ...base, cleared: cleared.slice(0, 1) }).coins;
    const riv = potOfRun({ ...base, cleared: [rivalry] }).coins;
    expect(maxed).toBe(first + riv);
  });

  it('every perk in the list has a name, an icon and words the screens can show', () => {
    for (const id of PERK_IDS) expect([PERKS[id].name, PERKS[id].icon].every(Boolean), id).toBe(true);
    expect(CLIMB.surePlayer).toEqual(['rivalry']);
  });
});

// A BOSS ALWAYS PAYS A PLAYER (the user, 2026-10-22: "I want to make sure that
// the Act 1 boss gives a player reward"): three players however the roster
// stands, never one already on it in another season's card.
describe('the Act I boss\'s reward', () => {
  const sorted = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id));
  const won = extra => ({ ...camped(), status: 'won', at: 'boss', cleared: ['1-0', 'boss'], ...extra });
  it('offers three players: five with room, ten under the cap, ten at it, and no room at all', () => {
    const capOf = keys => keys.reduce((t, k) => t + (CARDS.find(c => cardKey(c) === k)?.salary ?? 0), 0);
    const ten = sorted.slice(300, 310).map(cardKey);
    const seven = sorted.slice(300, 307).map(cardKey);
    for (const run of [
      won({ cap: 4800 }),
      won({ cap: 9000, roster: sorted.slice(100, 110).map(cardKey) }),
      won({ cap: capOf(ten), roster: ten }),
      won({ cap: capOf(seven) - CLIMB.capPerFloor, roster: seven }),
    ]) {
      const next = continueClimb(run);
      expect(next.status).toBe('reward');
      expect(next.offers.players).toHaveLength(3);
      const mine = rosterCards(next).cards;
      for (const k of next.offers.players) {
        const c = getCardByKey(k);
        expect(mine.some(m => samePlayer(m, c)), c.name).toBe(false);
      }
    }
  });
});
