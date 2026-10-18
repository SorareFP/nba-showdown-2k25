// THE RUN (The Climb, docs/plans/2026-10-18-the-climb.md, Task 5): from five
// owned players and Training Camp to the boss, as pure seeded steps.
import { describe, it, expect } from 'vitest';
import {
  CLIMB, BOONS, recoveryFor, newRun, chooseCamp, openStops, chooseStop, gameSetup, presetFor,
  recordResult, stratOffer, pickStrat, pickPlayer, skipOffers, restDay, useFreeRest, retire,
  rosterCards, deckLine, potPreview,
} from './run.js';
import { stopById, potOf, climbRng } from './climbMap.js';
import { kitDeck, KIT_CARD_IDS, leanOf } from './climbKits.js';
import { CARDS } from '../cards.js';
import { STRAT_MAP } from '../strats.js';
import { cardKey, getCardByKey } from '../cardSets.js';
import { capSal } from '../teamRules.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const KEYS = FIVE.map(cardKey);
const total = deck => Object.values(deck).reduce((t, n) => t + n, 0);
const start = (over = {}) => newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: KEYS, now: 1, ...over });
const camped = (boon = null, over = {}) => {
  const r = start(over);
  return chooseCamp(r, { playbook: 'speed', boon: boon ?? r.camp.boons[0], cuts: boon === 'cut_two' ? ['catch_and_shoot', 'first_step'] : [] });
};
/** Win the fight at this stop. */
const win = (run, stopId, margin = 5, endMinutes = {}) => recordResult(chooseStop(run, stopId), { stopId, won: true, margin, endMinutes });
const firstFight = run => openStops(run)[0].id;

describe('the starting five', () => {
  it('fits the starting cap', () => {
    expect(capSal(FIVE)).toBeLessThanOrEqual(CLIMB.startCap);
    expect(CLIMB.startCap).toBe(2200);
  });

  it('is refused short, long, over the cap, doubled or unknown', () => {
    expect(() => start({ rosterKeys: KEYS.slice(0, 4) })).toThrow();
    expect(() => start({ rosterKeys: [...KEYS, cardKey(CARDS[0])] })).toThrow();
    const pricey = [...CARDS].sort((a, b) => b.salary - a.salary).slice(0, 5).map(cardKey);
    expect(() => start({ rosterKeys: pricey })).toThrow(/2,?200/);
    expect(() => start({ rosterKeys: [...KEYS.slice(0, 4), KEYS[0]] })).toThrow();
    expect(() => start({ rosterKeys: [...KEYS.slice(0, 4), 'no:such_card'] })).toThrow();
  });
});

describe('Training Camp', () => {
  it('offers three different boons and marks the playbook that fits the five', () => {
    const r = start();
    expect(r.status).toBe('camp');
    expect(new Set(r.camp.boons).size).toBe(3);
    for (const b of r.camp.boons) expect(BOONS).toContain(b);
    expect(['speed', 'paint', 'defense']).toContain(r.camp.fits);
  });

  it('builds the fifteen and applies each boon', () => {
    const base = chooseCamp(start(), { playbook: 'speed', boon: start().camp.boons[0] });
    expect(base.status).toBe('map');
    expect(total(kitDeck('speed'))).toBe(15);
    const forced = boon => {
      const r = start();
      return chooseCamp({ ...r, camp: { ...r.camp, boons: [boon, 'free_rest', 'cap_400'] } }, { playbook: 'speed', boon, cuts: ['catch_and_shoot', 'first_step'] });
    };
    expect(forced('cap_400').cap).toBe(2600);
    expect(total(forced('cut_two').deck)).toBe(13);
    const rare = forced('rare_strat');
    expect(total(rare.deck)).toBe(16);
    expect(Object.keys(rare.deck).some(id => STRAT_MAP[id].rarity === 'rare')).toBe(true);
    expect(forced('free_rest').freeRest).toBe(1);
    expect(forced('extra_picks').extraPicks).toBe(3);
  });

  it('refuses a boon it did not offer, and a cut of a card the deck lacks', () => {
    const r = start();
    const missing = BOONS.find(b => !r.camp.boons.includes(b));
    expect(() => chooseCamp(r, { playbook: 'speed', boon: missing })).toThrow();
    const withCut = { ...r, camp: { ...r.camp, boons: ['cut_two', 'cap_400', 'free_rest'] } };
    expect(() => chooseCamp(withCut, { playbook: 'speed', boon: 'cut_two', cuts: ['bully_ball', 'first_step'] })).toThrow();
  });
});

describe('the map and the games', () => {
  it('opens on floor 1 and refuses anything else', () => {
    const r = camped();
    expect(openStops(r).map(s => s.floor)).toEqual([1, 1, 1]);
    expect(() => chooseStop(r, '2-0')).toThrow();
  });

  it('sets up a fight once and the same way every time (a resumed game is the same game)', () => {
    const r = chooseStop(camped(), '1-1');
    expect(r.status).toBe('game');
    expect(r.game).toMatchObject({ key: 'climb:r1:1-1', stopId: '1-1', kind: 'game', floor: 1, aiLevel: 'prince' });
    expect(r.game).toEqual(gameSetup(camped(), '1-1'));
    expect(r.game.rosterB).toHaveLength(CLIMB.oppSize[0]);
    expect(capSal(r.game.rosterB.map(getCardByKey))).toBeLessThanOrEqual(CLIMB.floorCap(1));
    expect(total(r.game.deckB)).toBe(CLIMB.coachDeckSize(1));
  });

  it('hands the Play tab a Q4 game with the run\'s fatigue', () => {
    const r = chooseStop({ ...camped(), fatigue: { [FIVE[0].id]: 4 } }, '1-0');
    const p = presetFor(r);
    expect(p.key).toBe('climb:r1:1-0');
    expect(p.rosterA.map(c => c.id)).toEqual(FIVE.map(c => c.id));
    expect(p.rosterB).toHaveLength(5);
    expect(p.gameOpts).toEqual({ startQuarter: 4, fatigue: { A: { [FIVE[0].id]: 4 } } });
    expect(p.returnTab).toBe('climb');
    expect(p.climb).toEqual({ runId: 'r1', stopId: '1-0', kind: 'game', floor: 1, rung: 'prince' });
    expect(p.deckA).toEqual(r.deck);
  });

  it('ignores a result for another stop', () => {
    const r = chooseStop(camped(), '1-0');
    expect(recordResult(r, { stopId: '1-1', won: true, margin: 9, endMinutes: {} })).toBe(r);
  });

  it('ends on a loss, and a tie is a loss', () => {
    const r = chooseStop(camped(), '1-0');
    expect(recordResult(r, { stopId: '1-0', won: false, margin: -3, endMinutes: {} }).status).toBe('lost');
    expect(recordResult(r, { stopId: '1-0', won: false, margin: 0, endMinutes: {} }).status).toBe('lost');
  });

  it('raises the cap and carries fatigue less a recovery that grows with the win', () => {
    expect([recoveryFor(1), recoveryFor(9), recoveryFor(10), recoveryFor(19), recoveryFor(20), recoveryFor(40)]).toEqual([8, 8, 10, 10, 12, 12]);
    const id = FIVE[0].id;
    const close = win(camped(), '1-0', 9, { [id]: 12 });
    expect(close.cap).toBe(2500);
    expect(close.fatigue[id]).toBe(4);
    expect(win(camped(), '1-0', 10, { [id]: 12 }).fatigue[id]).toBe(2);
    expect(win(camped(), '1-0', 20, { [id]: 12 }).fatigue[id] ?? 0).toBe(0);
    expect(close.status).toBe('reward');
    expect(close.cleared).toEqual(['1-0']);
  });
});

describe('rewards', () => {
  it('offer three strats after a win, two leaning to the playbook', () => {
    const r = win(camped(), '1-0');
    expect(r.offers.strats).toHaveLength(3);
    expect(new Set(r.offers.strats).size).toBe(3);
    expect(r.offers.strats.slice(0, 2).every(id => leanOf(id) === 'speed')).toBe(true);
  });

  it('turn rare more often up the climb, and a Rivalry always offers one', () => {
    const r = camped();
    const count = (stop, n) => {
      let rares = 0;
      for (let i = 0; i < n; i += 1) rares += stratOffer(r, stop, climbRng(i, 'share')).filter(id => STRAT_MAP[id].rarity === 'rare').length;
      return rares / (n * 3);
    };
    const f1 = count({ kind: 'game', floor: 1 }, 700);
    expect(f1).toBeGreaterThanOrEqual(0.03);
    expect(f1).toBeLessThanOrEqual(0.07);
    expect(count({ kind: 'game', floor: 6 }, 300)).toBeGreaterThan(f1 * 2);
    for (let i = 0; i < 50; i += 1) {
      expect(stratOffer(r, { kind: 'rivalry', floor: 2 }, climbRng(i, 'riv')).some(id => STRAT_MAP[id].rarity === 'rare')).toBe(true);
    }
  });

  it('never offer a card the deck already holds at its limit, plain and "+" together', () => {
    const r = { ...camped(), deck: { ...kitDeck('speed'), catch_and_shoot: 2, 'catch_and_shoot+': 1 } };
    for (let i = 0; i < 300; i += 1) expect(stratOffer(r, { kind: 'game', floor: 1 }, climbRng(i, 'cap'))).not.toContain('catch_and_shoot');
  });

  it('take a strat into the deck, or skip, then go back to the map', () => {
    const r = win(camped(), '1-0');
    const id = r.offers.strats[0];
    const took = pickStrat(r, id);
    expect(took.deck[id]).toBe((r.deck[id] ?? 0) + 1);
    expect(took.status).toBe('map');
    expect(() => pickStrat(r, 'not_offered')).toThrow();
    const skipped = skipOffers(r);
    expect(skipped.deck).toEqual(r.deck);
    expect(skipped.status).toBe('map');
  });

  it('offer players after a Rivalry and every second Game win, all under the cap, none when nothing fits', () => {
    let r = win(camped(), '1-0');
    expect(r.offers.players).toEqual([]);
    r = skipOffers(r);
    // The second Game win: stand below any Game on floors 2-6.
    const g2 = r.map.floors.slice(1, 6).flat().find(s => s.kind === 'game');
    const below = r.map.floors[g2.floor - 2].find(s => s.next.includes(g2.id));
    {
      const r2 = win({ ...r, at: below.id }, g2.id);
      expect(r2.gameWins).toBe(2);
      expect(r2.offers.players.length).toBe(3);
      const room = r2.cap - capSal(rosterCards(r2).cards);
      for (const k of r2.offers.players) {
        expect(getCardByKey(k).salary).toBeLessThanOrEqual(room);
        expect(rosterCards(r2).cards.some(c => c.id === getCardByKey(k).id)).toBe(false);
      }
      const added = pickPlayer(r2, r2.offers.players[0]);
      expect(added.roster).toHaveLength(6);
    }
    const riv = camped().map.floors.flat().find(s => s.kind === 'rivalry');
    const atRiv = { ...camped(), status: 'map', at: stopById(camped().map, riv.id).floor > 1 ? camped().map.floors[riv.floor - 2].find(s => s.next.includes(riv.id)).id : null };
    expect(win(atRiv, riv.id).offers.players.length).toBeGreaterThan(0);
    const full = { ...atRiv, roster: [...KEYS, ...[...CARDS].sort((a, b) => a.salary - b.salary).slice(0, 5).map(cardKey)] };
    expect(win(full, riv.id).offers.players).toEqual([]);
    const broke = { ...atRiv, cap: capSal(FIVE) - CLIMB.capPerFloor };
    expect(win(broke, riv.id).offers.players).toEqual([]);
  });

  it('give two picks after each of the three games the boon covers', () => {
    const r = chooseCamp({ ...start(), camp: { ...start().camp, boons: ['extra_picks', 'cap_400', 'free_rest'] } }, { playbook: 'speed', boon: 'extra_picks' });
    const w = win(r, '1-0');
    expect(w.offers.picks).toBe(2);
    expect(w.extraPicks).toBe(2);
    const one = pickStrat(w, w.offers.strats[0]);
    expect(one.status).toBe('reward');
    expect(pickStrat(one, one.offers.strats[0]).status).toBe('map');
  });
});

describe('the Rest Day', () => {
  const toRest = () => {
    const r = camped();
    const rest = r.map.floors.flat().find(s => s.kind === 'rest' && s.floor > 1);
    const from = r.map.floors[rest.floor - 2].find(s => s.next.includes(rest.id));
    return chooseStop({ ...r, at: from.id, fatigue: { [FIVE[0].id]: 12 } }, rest.id);
  };

  it('rests everyone, or smiths one copy, then clears the floor', () => {
    const r = toRest();
    expect(r.status).toBe('rest');
    const rested = restDay(r, { choice: 'rest' });
    expect(rested.fatigue).toEqual({});
    expect(rested.cap).toBe(r.cap + 300);
    expect(rested.status).toBe('map');
    const smith = restDay(r, { choice: 'smith', cardId: 'catch_and_shoot' });
    expect(smith.deck.catch_and_shoot).toBe(1);
    expect(smith.deck['catch_and_shoot+']).toBe(1);
    expect(smith.cap).toBe(r.cap + 300);
    expect(smith.fatigue).toEqual(r.fatigue);
  });

  it('smiths each copy once, and only kit cards', () => {
    const r = toRest();
    const twice = { ...restDay(r, { choice: 'smith', cardId: 'catch_and_shoot' }), status: 'rest', restAt: r.restAt };
    const both = restDay(twice, { choice: 'smith', cardId: 'catch_and_shoot' });
    expect(both.deck.catch_and_shoot ?? 0).toBe(0);
    expect(both.deck['catch_and_shoot+']).toBe(2);
    expect(() => restDay({ ...both, status: 'rest', restAt: r.restAt }, { choice: 'smith', cardId: 'catch_and_shoot+' })).toThrow();
    const withRare = { ...r, deck: { ...r.deck, green_light: 1 } };
    expect(KIT_CARD_IDS.has('green_light')).toBe(false);
    expect(() => restDay(withRare, { choice: 'smith', cardId: 'green_light' })).toThrow(/no upgrade yet/);
  });

  it('can be taken from the map with the free Rest Day, once', () => {
    const r = { ...camped(), freeRest: 1, fatigue: { x: 8 } };
    const used = useFreeRest(r, { choice: 'rest' });
    expect(used.fatigue).toEqual({});
    expect(used.freeRest).toBe(0);
    expect(used.cap).toBe(r.cap);
    expect(used.status).toBe('map');
    expect(() => useFreeRest(used, { choice: 'rest' })).toThrow();
  });
});

describe('the end of a run', () => {
  it('retires from the map, never mid-game', () => {
    expect(retire(camped()).status).toBe('retired');
    expect(() => retire(chooseStop(camped(), '1-0'))).toThrow();
  });

  it('is won by beating the boss, and the pot is the cleared stops\'', () => {
    const r = camped();
    const seven = r.map.floors[6][0];
    const atBoss = { ...r, at: seven.id, cleared: ['1-0'] };
    const won = win(atBoss, 'boss');
    expect(won.status).toBe('won');
    expect(potPreview(won)).toEqual(potOf(r.map, ['1-0', 'boss'], 'prince'));
    expect(potPreview(won).booster).toBe(true);
    const boss = gameSetup(atBoss, 'boss');
    expect(boss.rosterB).toHaveLength(CLIMB.bossSize);
    expect(boss.opponent.classic).toBe(true);
  });
});

describe('a saved run', () => {
  it('follows an alias, drops what no longer exists, and blocks under five', () => {
    const r = { ...camped(), roster: [...KEYS.slice(0, 3), 'team-rewards:Anthony_Parker', 'gone:Nobody'] };
    const { cards, dropped, blocked } = rosterCards(r);
    expect(cards).toHaveLength(4);
    expect(cards.some(c => c.id === 'Anthony_Parker')).toBe(true);
    expect(dropped).toEqual(['gone:Nobody']);
    expect(blocked).toBe('roster');
    expect(rosterCards(camped()).blocked).toBe(null);
  });

  it('shows the deck\'s size and lean', () => {
    const line = deckLine(camped());
    expect(line).toMatchObject({ size: 15, playbook: 'speed' });
    expect(line.leaning).toBe(Object.entries(kitDeck('speed')).filter(([id]) => leanOf(id) === 'speed').reduce((t, [, n]) => t + n, 0));
    expect(typeof line.fits).toBe('boolean');
  });

  it('replays exactly from the same seed and choices', () => {
    const play = () => {
      let r = camped();
      r = win(r, '1-2', 7, { [FIVE[1].id]: 12 });
      r = pickStrat(r, r.offers.strats[1]);
      return r;
    };
    expect(play()).toEqual(play());
  });
});
