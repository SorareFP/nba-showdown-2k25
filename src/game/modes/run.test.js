// THE RUN (The Climb, docs/plans/2026-10-18-the-climb.md, Task 5): from five
// owned players and Training Camp to the boss, as pure seeded steps.
import { describe, it, expect } from 'vitest';
import {
  CLIMB, BOONS, recoveryFor, newRun, chooseCamp, openStops, chooseStop, gameSetup, presetFor,
  recordResult, stratOffer, pickStrat, pickPlayer, skipOffers, restDay, takeFreeRest, retire,
  rosterCards, deckLine, potPreview, bossTeam, needsRelease, releaseOptions, owedPlayer, openOwedSign, OFFER_RULES,
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
// Drops off (dropOdds -1: no player offer, no perk) unless a test is about them;
// the drops are chances since 2026-10-19 (rollDrops).
const QUIET = { player: -1, perk: -1 };
const camped = (boon = null, over = {}) => {
  const r = start(over);
  return { ...chooseCamp(r, { playbook: 'speed', boon: boon ?? r.camp.boons[0], cuts: boon === 'cut_two' ? ['catch_and_shoot', 'first_step'] : [] }), dropOdds: QUIET };
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

  it('builds the sixteen and applies each boon', () => {
    const base = chooseCamp(start(), { playbook: 'speed', boon: start().camp.boons[0] });
    expect(base.status).toBe('map');
    expect(total(kitDeck('speed'))).toBe(16);
    const forced = boon => {
      const r = start();
      return chooseCamp({ ...r, camp: { ...r.camp, boons: [boon, 'free_rest', 'cap_400'] } }, { playbook: 'speed', boon, cuts: ['catch_and_shoot', 'first_step'] });
    };
    expect(forced('cap_400').cap).toBe(2600);
    expect(total(forced('cut_two').deck)).toBe(14);
    const rare = forced('rare_strat');
    expect(total(rare.deck)).toBe(17);
    // A rare beyond the kit's own crunch card (Second Closer, since 2026-10-19).
    expect(Object.keys(rare.deck).some(id => STRAT_MAP[id].rarity === 'rare' && !(id in kitDeck('speed')))).toBe(true);
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
    // Act I's coach plays its own kit only (2026-10-19), ONE COPY of each card
    // (2026-10-20: "they shouldn't just be dropping two instances of bully ball").
    expect(CLIMB.coachDeckExtra(1)).toBe(0);
    expect(CLIMB.coachDeckExtra(3)).toBe(0);
    expect([4, 5, 6].map(CLIMB.coachDeckExtra)).toEqual([3, 5, 6]);
    expect(Object.keys(r.game.deckB).every(id => KIT_CARD_IDS.has(id))).toBe(true);
    expect(Object.values(r.game.deckB).every(n => n === 1)).toBe(true);
    // A Game is at home; a Rivalry is on the road (CLIMB.homeKinds).
    expect(r.game.home).toBe(true);
  });

  it('hands the Play tab a Q4 game with the run\'s fatigue', () => {
    const r = chooseStop({ ...camped(), fatigue: { [FIVE[0].id]: 4 } }, '1-0');
    const p = presetFor(r);
    expect(p.key).toBe('climb:r1:1-0');
    expect(p.rosterA.map(c => c.id)).toEqual(FIVE.map(c => c.id));
    expect(p.rosterB).toHaveLength(5);
    expect(p.gameOpts).toMatchObject({ startQuarter: 4, fatigue: { A: { [FIVE[0].id]: 4 } }, placementFirst: 'B', system: { A: 'speed' } });
    // The coach's style (2026-10-25): its engine effects ride in gameOpts, its stat moves on the coach's cards.
    expect(Object.keys(p.gameOpts).filter(k => !['startQuarter', 'fatigue', 'placementFirst', 'system', 'style'].includes(k))).toEqual([]);
    // At home: the coach places first and you answer.
    expect(p.humanIsHome).toBe(true);
    expect(p.returnTab).toBe('climb');
    // potAdd: what the win adds to the pot (floor 1's Game, 30 at Prince); secondChance: no perk, no replay.
    expect(p.climb).toEqual({ runId: 'r1', stopId: '1-0', kind: 'game', floor: 1, rung: 'prince', act: 1, potAdd: 30, secondChance: false });
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
    expect([recoveryFor(1), recoveryFor(9), recoveryFor(10), recoveryFor(19), recoveryFor(20), recoveryFor(40)]).toEqual([10, 10, 12, 12, 14, 14]);
    const id = FIVE[0].id;
    const close = win(camped(), '1-0', 9, { [id]: 16 });
    expect(close.cap).toBe(CLIMB.startCap + CLIMB.capPerFloor);
    expect(close.fatigue[id]).toBe(6);
    expect(win(camped(), '1-0', 10, { [id]: 16 }).fatigue[id]).toBe(4);
    expect(win(camped(), '1-0', 20, { [id]: 16 }).fatigue[id]).toBe(2);
    expect(win(camped(), '1-0', 9, { [id]: 10 }).fatigue[id] ?? 0).toBe(0);
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
    expect(f1).toBeGreaterThanOrEqual(0.06);   // 10% a slot at floor 1 (2026-10-19)
    expect(f1).toBeLessThanOrEqual(0.14);
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

  it('offer players when the drop comes (a chance, CLIMB.drops), all under the cap', () => {
    let r = win(camped(), '1-0');
    expect(r.offers.players).toEqual([]);   // drops off
    r = { ...skipOffers(r), dropOdds: { player: 1, perk: -1 } };
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
    const atRiv = { ...camped(), dropOdds: { player: 1, perk: -1 }, status: 'map', at: stopById(camped().map, riv.id).floor > 1 ? camped().map.floors[riv.floor - 2].find(s => s.next.includes(riv.id)).id : null };
    expect(win(atRiv, riv.id).offers.players.length).toBeGreaterThan(0);
  });

  // SIGN AND RELEASE (2026-10-21; the user: "Rivalry games should always give
  // card rewards"). A full roster — 23 of 28 Act II Rivalry wins in the sim —
  // or a cap with no room used to empty the offer. Now it comes priced against
  // the room a release makes, and signing names the player who goes.
  it('still offer a player at a full roster or a short cap, signed by releasing one of yours', () => {
    const riv = camped().map.floors.flat().find(s => s.kind === 'rivalry');
    const atRiv = { ...camped(), dropOdds: { player: -1, perk: -1 }, status: 'map', at: riv.floor > 1 ? camped().map.floors[riv.floor - 2].find(s => s.next.includes(riv.id)).id : null };
    const bench = [...CARDS].sort((a, b) => a.salary - b.salary).slice(0, 5).map(cardKey);
    const full = { ...atRiv, roster: [...KEYS, ...bench], perks: [{ id: 'gym_rat', target: getCardByKey(bench[0]).id }], fatigue: { [getCardByKey(bench[0]).id]: 8 } };
    const won = win(full, riv.id);
    expect(won.offers.players.length).toBe(3);
    const k = won.offers.players[0];
    expect(needsRelease(won, k)).toBe(true);
    expect(() => pickPlayer(won, k)).toThrow(/Release a player/);
    const options = releaseOptions(won, k);
    expect(options.length).toBeGreaterThan(0);
    expect(options.every(o => won.roster.includes(o))).toBe(true);
    const go = options.includes(bench[0]) ? bench[0] : options[0];
    const signed = pickPlayer(won, k, go);
    expect(signed.roster).toHaveLength(CLIMB.maxRoster);
    expect(signed.roster).toContain(k);
    expect(signed.roster).not.toContain(go);
    expect(capSal(rosterCards(signed).cards)).toBeLessThanOrEqual(signed.cap);
    if (go === bench[0]) {
      expect(signed.perks).toEqual([]);
      expect(signed.fatigue[getCardByKey(bench[0]).id]).toBeUndefined();
    }
    // A release that does not make room is refused.
    const notEnough = won.roster.find(x => !options.includes(x));
    if (notEnough) expect(() => pickPlayer(won, k, notEnough)).toThrow(/does not make room/);
    // No room under the cap: the same.
    const broke = { ...atRiv, cap: capSal(FIVE) - CLIMB.capPerFloor };
    const bw = win(broke, riv.id);
    expect(bw.offers.players.length).toBeGreaterThan(0);
    expect(bw.offers.players.every(x => needsRelease(bw, x))).toBe(true);
  });

  it('give two picks after each of the three games the boon covers', () => {
    const r = { ...chooseCamp({ ...start(), camp: { ...start().camp, boons: ['extra_picks', 'cap_400', 'free_rest'] } }, { playbook: 'speed', boon: 'extra_picks' }), dropOdds: QUIET };
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

  it('rests everyone, or practises one copy, then clears the floor', () => {
    const r = toRest();
    expect(r.status).toBe('rest');
    const rested = restDay(r, { choice: 'rest' });
    expect(rested.fatigue).toEqual({});
    expect(rested.cap).toBe(r.cap + CLIMB.capPerFloor);
    expect(rested.status).toBe('map');
    const smith = restDay(r, { choice: 'practice', cardId: 'catch_and_shoot' });
    expect(smith.deck.catch_and_shoot).toBe(1);
    expect(smith.deck['catch_and_shoot+']).toBe(1);
    expect(smith.cap).toBe(r.cap + CLIMB.capPerFloor);
    expect(smith.fatigue).toEqual(r.fatigue);
  });

  it('practises each copy once, and only kit cards', () => {
    const r = toRest();
    const twice = { ...restDay(r, { choice: 'practice', cardId: 'catch_and_shoot' }), status: 'rest', restAt: r.restAt };
    const both = restDay(twice, { choice: 'practice', cardId: 'catch_and_shoot' });
    expect(both.deck.catch_and_shoot ?? 0).toBe(0);
    expect(both.deck['catch_and_shoot+']).toBe(2);
    expect(() => restDay({ ...both, status: 'rest', restAt: r.restAt }, { choice: 'practice', cardId: 'catch_and_shoot+' })).toThrow();
    // Every card a run can offer has a "+" since 2026-10-20; a legendary has none.
    const withLegend = { ...r, deck: { ...r.deck, twin_towers: 1 } };
    expect(KIT_CARD_IDS.has('twin_towers')).toBe(false);
    expect(() => restDay(withLegend, { choice: 'practice', cardId: 'twin_towers' })).toThrow(/no upgrade yet/);
    expect(restDay({ ...r, deck: { ...r.deck, green_light: 1 } }, { choice: 'practice', cardId: 'green_light' }).deck['green_light+']).toBe(1);
  });

  it('can be taken from the map with the free Rest Day, once', () => {
    const r = { ...camped(), freeRest: 1, fatigue: { x: 8 } };
    const used = takeFreeRest(r, { choice: 'rest' });
    expect(used.fatigue).toEqual({});
    expect(used.freeRest).toBe(0);
    expect(used.cap).toBe(r.cap);
    expect(used.status).toBe('map');
    expect(() => takeFreeRest(used, { choice: 'rest' })).toThrow();
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
    // Act I's pot reads as it always did, and names the boss's pack (2026-10-20).
    expect(potPreview(won)).toEqual({ ...potOf(r.map, ['1-0', 'boss'], 'prince'), packs: ['booster'] });
    expect(potPreview(won).booster).toBe(true);
    const boss = gameSetup(atBoss, 'boss');
    expect(boss.rosterB).toHaveLength(CLIMB.bossSize);
    // The boss's deck (2026-10-20): its kit, one of each, and three more, none rare.
    const bossKit = Object.keys(kitDeck(bossScout(atBoss).playbook));
    const added = Object.keys(boss.deckB).filter(id => !bossKit.includes(id));
    expect(Object.values(boss.deckB).every(n => n === 1)).toBe(true);
    expect(total(boss.deckB)).toBe(bossKit.length + CLIMB.bossDeckExtra);
    expect(added).toHaveLength(CLIMB.bossDeckExtra);
    expect(added.every(id => !['rare', 'legendary'].includes(STRAT_MAP[id].rarity))).toBe(true);
    expect(boss.home).toBe(false);
    expect(boss.opponent.classic).toBe(true);
    expect(bossTeam(r).abbr).toBe(boss.opponent.abbr); // the map's boss is the one you meet
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
    expect(line).toMatchObject({ size: 16, playbook: 'speed' });
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

describe('a finished game, as the run reads it', () => {
  it('is won by the home side\'s lead, by its margin, with each player\'s minutes', async () => {
    const { resultFromGame } = await import('./run.js');
    const game = { done: true, teamA: { score: 31, stats: [{ id: 'a', minutes: 12 }, { id: 'b', minutes: 4 }] }, teamB: { score: 27, stats: [] } };
    expect(resultFromGame(game, '2-1')).toEqual({ stopId: '2-1', won: true, margin: 4, endMinutes: { a: 12, b: 4 } });
    expect(resultFromGame({ ...game, teamB: { score: 31, stats: [] } }, '2-1')).toMatchObject({ won: false, margin: 0 });
  });
});

// RECONCILING WITH THE LEDGER (final review, 2026-10-18).
describe('a run that disagrees with its ledger', () => {
  it('stamps the map version it was drawn at', () => {
    const r = start({ mapVersion: 1 });
    expect(r.mapVersion).toBe(1);
  });

  it('records a win the server already holds, assuming every player played the quarter', async () => {
    const { recordServerWin } = await import('./run.js');
    const r = chooseStop({ ...camped(), fatigue: { [FIVE[0].id]: 4 } }, '1-0');
    const w = recordServerWin(r, '1-0');
    expect(w.status).toBe('reward');
    expect(w.cleared).toEqual(['1-0']);
    expect(w.fatigue[FIVE[0].id]).toBe(4 + 12 - 10);
    expect(w.fatigue[FIVE[1].id]).toBe(2);
    expect(recordServerWin(r, '1-1')).toBe(r);
  });

  it('can be given up from any step short of its end, and not after', async () => {
    const { abandon } = await import('./run.js');
    for (const r of [camped(), chooseStop(camped(), '1-0'), win(camped(), '1-0')]) {
      expect(abandon(r)).toMatchObject({ status: 'lost', abandoned: true, game: null });
    }
    expect(abandon({ ...camped(), status: 'retired' })).toMatchObject({ status: 'lost', abandoned: true });
    expect(() => abandon({ ...camped(), status: 'lost' })).toThrow();
    expect(() => abandon({ ...camped(), status: 'won', banked: { coins: 1, booster: true } })).toThrow();
  });
});

// CLIMB FIVES, MADE AHEAD (the user, 2026-10-19: "we definitely need to be
// able to pre-make eligible lineups"). One rule says what a five may be, for
// the editor in My Teams, the start screen and newRun alike.
describe('a Climb five', () => {
  it('is five or six players you own, one card a player, at most the starting cap — or says why not', async () => {
    const { fiveProblem, CLIMB_FIVE } = await import('./run.js');
    // A sixth since 2026-10-25 (the user: "the ability to start with a sixth player"), under the same cap.
    expect(CLIMB_FIVE).toEqual({ cap: 2200, size: 5, max: 6 });
    const owned = new Set(KEYS);
    expect(fiveProblem(KEYS, owned)).toBe(null);
    expect(fiveProblem(KEYS)).toBe(null);
    expect(fiveProblem(KEYS.slice(0, 4), owned)).toMatch(/five or six/);
    // A sixth fits when the six fit the cap; a seventh never does.
    const cheap = [...CARDS].sort((a, b) => a.salary - b.salary);
    const six = cheap.filter((c, i, all) => all.findIndex(d => d.id === c.id) === i).slice(0, 6).map(cardKey);
    expect(fiveProblem(six)).toBe(null);
    const seven = cheap.filter((c, i, all) => all.findIndex(d => d.id === c.id) === i).slice(0, 7).map(cardKey);
    expect(fiveProblem(seven)).toMatch(/five or six/);
    expect(fiveProblem([...KEYS.slice(0, 4), 'gone:Nobody'], owned)).toMatch(/no longer exists/);
    const sold = new Set(KEYS.slice(1));
    expect(fiveProblem(KEYS, sold)).toMatch(new RegExp(`no longer own ${FIVE[0].name}`));
    expect(fiveProblem([...KEYS.slice(0, 4), KEYS[0]], owned)).toMatch(/one card a player/i);
    const pricey = [...CARDS].sort((a, b) => b.salary - a.salary).slice(0, 5).map(cardKey);
    expect(fiveProblem(pricey, new Set(pricey))).toMatch(/over the \$2,200 cap/);
  });
});

// THREE PRICES (the user, 2026-10-19: "different ranges of player offers so
// that you're not immediately up against the cap every time you take a player").
import { rollDrops } from './run.js';
describe('a player offer', () => {
  it('comes at three prices: under 35% of the room, 35-70%, and 70-100%', () => {
    const base = camped();
    const run = { ...base, cap: capSal(FIVE) + 1500, dropOdds: { player: 1, perk: -1 } };
    const g = openStops(run).find(s => s.kind === 'game');
    const r = recordResult(chooseStop(run, g.id), { stopId: g.id, won: true, margin: 6 });
    const room = r.cap - capSal(rosterCards(r).cards);
    const shares = r.offers.players.map(k => getCardByKey(k).salary / room);
    expect(shares).toHaveLength(3);
    expect(shares[0]).toBeLessThanOrEqual(0.35);
    expect(shares[1]).toBeGreaterThan(0.35);
    expect(shares[1]).toBeLessThanOrEqual(0.7);
    expect(shares[2]).toBeGreaterThan(0.7);
    expect(shares[2]).toBeLessThanOrEqual(1);
    expect(new Set(r.offers.players.map(k => getCardByKey(k).id)).size).toBe(3);
    expect(typeof rollDrops).toBe('function');
  });
});

// CUTTING (the user, 2026-10-19: "Go for both"): a Rest Day's third choice.
import { MIN_DECK } from './run.js';
describe('cutting a card at a Rest Day', () => {
  const toRest = () => {
    const r = camped();
    const rest = r.map.floors.flat().find(s => s.kind === 'rest' && s.floor > 1);
    const from = r.map.floors[rest.floor - 2].find(s => s.next.includes(rest.id));
    return chooseStop({ ...r, at: from.id }, rest.id);
  };
  it('takes one copy out for good and clears the floor; a "+" copy can go too', () => {
    const r = toRest();
    const cut = restDay(r, { choice: 'cut', cardId: 'catch_and_shoot' });
    expect(cut.deck.catch_and_shoot).toBe(r.deck.catch_and_shoot - 1);
    expect(total(cut.deck)).toBe(total(r.deck) - 1);
    expect(cut.status).toBe('map');
    expect(cut.cap).toBe(r.cap + CLIMB.capPerFloor);
    const plusRun = { ...r, deck: { ...r.deck, 'close_out+': 1 } };
    expect(restDay(plusRun, { choice: 'cut', cardId: 'close_out+' }).deck['close_out+'] ?? 0).toBe(0);
    expect(() => restDay(r, { choice: 'cut', cardId: 'green_light' })).toThrow();
  });
  it('never cuts a deck below a full hand', () => {
    const r = toRest();
    const thin = { ...r, deck: { high_screen_roll: 2, switch_the_screen: 1, veer_switch: 1, go_under: 1, overhelp: 1, burned_switch: 1 } };
    expect(total(thin.deck)).toBe(MIN_DECK);
    expect(() => restDay(thin, { choice: 'cut', cardId: 'overhelp' })).toThrow(/at least/);
  });
});

// SCOUTING THE BOSS (2026-10-19): the boss game's own roster and deck, from floor 1.
import { bossScout } from './run.js';
describe('the scouting report', () => {
  it('is the boss game\'s own team: its players by salary, its playbook, its rares', () => {
    const r = camped();
    const s = bossScout(r);
    const setup = gameSetup(r, 'boss');
    expect(s.players.map(cardKey).sort()).toEqual([...setup.rosterB].sort());
    expect(s.players).toHaveLength(CLIMB.bossSize);
    for (let i = 1; i < s.players.length; i += 1) expect(s.players[i - 1].salary).toBeGreaterThanOrEqual(s.players[i].salary);
    expect(['speed', 'paint', 'defense']).toContain(s.playbook);
    expect(s.opponent).toEqual(setup.opponent);
    for (const id of s.rares) expect(['rare', 'legendary']).toContain(STRAT_MAP[id.replace(/\+$/, '')].rarity);
  });
});

// THE PLAYER A FULL ROSTER WAS OWED (2026-10-22). The user: "if I reload my
// current climb, I'll get the opportunity to add a player". A reward is dealt
// once and saved; one dealt by the old code at ten players kept its empty row
// through every reload. A run without offerRules is made good once.
describe('the player a full roster was owed', () => {
  const bench = () => [...CARDS].sort((a, b) => a.salary - b.salary).slice(0, 5).map(cardKey);
  const oldRun = over => {
    const { offerRules, ...r } = { ...camped(), roster: [...KEYS, ...bench()], cleared: ['1-0'], at: '1-0', ...over };
    return r;
  };

  it('marks a new run as dealt under the current rule, and leaves it alone', () => {
    expect(camped().offerRules).toBe(OFFER_RULES);
    const r = camped();
    expect(owedPlayer(r)).toBe(r);
  });

  it('deals the missed offer to a reward screen with no players, once', () => {
    const r = oldRun({ status: 'reward', offers: { stopId: '1-0', strats: ['catch_and_shoot'], picks: 1, players: [], perks: [] } });
    const fixed = owedPlayer(r);
    expect(fixed.offerRules).toBe(OFFER_RULES);
    expect(fixed.offers.players).toHaveLength(3);
    expect(fixed.offers.players.every(k => needsRelease(fixed, k))).toBe(true);
    expect(owedPlayer(fixed)).toBe(fixed);
    const signed = pickPlayer(fixed, fixed.offers.players[0], releaseOptions(fixed, fixed.offers.players[0])[0]);
    expect(signed.roster).toHaveLength(CLIMB.maxRoster);
  });

  it('puts a player to sign on the map for a run past its reward', () => {
    const fixed = owedPlayer(oldRun({ status: 'map', offers: null }));
    expect(fixed.freeSign).toBe(1);
    const open = openOwedSign(fixed);
    expect(open.status).toBe('reward');
    expect(open.freeSign).toBe(0);
    expect(open.offers.players).toHaveLength(3);
    expect(open.offers.stopId).toBe('owed');
    // Skipping returns to the map; nothing is owed after.
    const back = skipOffers(open, 'players');
    expect(back.status).toBe('map');
    expect(() => openOwedSign(back)).toThrow(/No player is owed/);
  });

  it('owes nothing to a roster with room, a run not yet started, or a reward that has its players', () => {
    const { offerRules, ...roomy } = { ...camped(), status: 'map', cleared: ['1-0'], at: '1-0' };
    expect(owedPlayer(roomy).freeSign).toBeUndefined();
    expect(owedPlayer(oldRun({ status: 'camp', cleared: [] })).freeSign).toBeUndefined();
    const offered = oldRun({ status: 'reward', offers: { stopId: '1-0', strats: [], picks: 0, players: ['x'], perks: [] } });
    expect(owedPlayer(offered).offers.players).toEqual(['x']);
  });
});
