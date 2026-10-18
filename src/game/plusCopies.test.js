// A "+" COPY IS ITS CARD (The Climb, docs/plans/2026-10-18-the-climb.md,
// Task 3b). The user, 2026-10-18: Smith upgrades "each card, not all of one",
// so an upgraded copy rides in the deck as `id+` beside its plain twins. The
// engine compares ids as strings in ~40 places; the `+` is read at the doors
// (execCard, canPlay, the AI, the board) and nowhere inside, so a "+" copy is
// played, judged, answered and drawn exactly as its card is — and, until
// Task 6 writes its effect, does exactly what its card does.
import { describe, it, expect } from 'vitest';
import { STRATS, getStrat, baseId, isPlus, plusId, PLUS } from './strats.js';
import { newGame, drawCards } from './engine.js';
import { execCard } from './execCard.js';
import { canPlayCard, canAnswerCheck, answerWindow } from './canPlay.js';
import { aiReactionDecision } from './ai.js';
import { getStratImagePath, getStratThumbPath } from './cardImages.js';
import { simulateGame } from './modes/simulate.js';
import { climbRng } from './modes/climbMap.js';
import { kitDeck, KIT_CARD_IDS } from './modes/climbKits.js';
import { ARCHETYPE_DECKS } from './archetypeDecks.js';
import { CARDS } from './cards.js';

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'PG', speed: 12, power: 12,
  shotLine: 14, paintBoost: 1, threePtBoost: 1, defBoost: 1, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }],
  ...over,
});
const roster = prefix => Array.from({ length: 5 }, (_, i) => mk(`${prefix}${i}`));
function board(phase) {
  const g = newGame(roster('a'), roster('b'));
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = phase;
  g.matchupTurn = 'A';
  g.scoringTurn = 'A';
  g.teamA.assists = 6; g.teamA.rebounds = 6;
  g.teamB.assists = 6; g.teamB.rebounds = 6;
  return g;
}
const plusDeck = deck => Object.fromEntries(Object.entries(deck).map(([id, n]) => [plusId(id), n]));

describe('the "+" helpers', () => {
  it('read and write the mark', () => {
    expect(baseId('close_out+')).toBe('close_out');
    expect(baseId('close_out')).toBe('close_out');
    expect(isPlus('close_out+')).toBe(true);
    expect(isPlus('close_out')).toBe(false);
    expect(plusId('close_out')).toBe('close_out+');
    expect(plusId('close_out+')).toBe('close_out+');
  });

  it('name the card with a "+", and keep what it is', () => {
    const plain = getStrat('close_out');
    const up = getStrat('close_out+');
    expect(up).toMatchObject({ id: 'close_out+', base: 'close_out', upgraded: true, name: `${plain.name}+`, phase: plain.phase, side: plain.side, rarity: plain.rarity });
    expect(getStrat('close_out')).toBe(plain);
    expect(getStrat('no_such_card+')).toBeFalsy();
  });

  it('draws the plain face for a "+" copy', () => {
    expect(getStratImagePath('close_out+')).toBe(getStratImagePath('close_out'));
    expect(getStratThumbPath('close_out+')).toBe(getStratThumbPath('close_out'));
  });
});

describe('playing a "+" copy', () => {
  it('spends that copy and keeps its plain twin, and the other way round', () => {
    for (const [play, keep] of [['high_screen_roll+', 'high_screen_roll'], ['high_screen_roll', 'high_screen_roll+']]) {
      const g = board('matchup_strats');
      g.teamA.hand = ['high_screen_roll', 'high_screen_roll+', 'close_out'];
      const res = execCard(g, 'A', play, { swapSlot1: 0, swapSlot2: 1 });
      expect(res.ok, res.msg).toBe(true);
      expect(res.game.teamA.hand).toContain(keep);
      expect(res.game.teamA.hand).not.toContain(play);
      expect(res.game.teamA.hand).toHaveLength(2);
    }
  });

  it('is legal exactly when its card is, for every card, in every phase', () => {
    for (const phase of ['matchup_strats', 'scoring']) {
      const g = board(phase);
      for (const s of STRATS) {
        g.teamA.hand = [s.id, plusId(s.id), 'close_out'];
        expect(canPlayCard(g, 'A', plusId(s.id)).canPlay, `${phase} ${s.id}`).toBe(canPlayCard(g, 'A', s.id).canPlay);
      }
    }
  });

  it('answers a check: the window opens and the coach answers with the "+" copy', () => {
    const g = board('scoring');
    const check = { teamKey: 'A', playerIdx: 0, type: '3pt', bonus: 0 };
    g.teamB.hand = ['close_out'];
    expect(canAnswerCheck(g, check)).toBe(true);
    g.teamB.hand = ['close_out+'];
    expect(canAnswerCheck(g, check)).toBe(true);
    const probe = { ...g, pendingShotCheck: check };
    expect(aiReactionDecision(probe, 'B', 'shot_check')).toMatchObject({ type: 'play_card', cardId: 'close_out+' });
  });

  it('holds the answer window open for a "+" answer card', () => {
    const g = board('scoring');
    g.lastCheckMiss = { teamKey: 'A', playerIdx: 0, type: 'paint' };
    g.teamB.hand = ['glass_cleaner'];
    expect(answerWindow(g, 'B')).toEqual(['glass_cleaner']);
    g.teamB.hand = ['glass_cleaner+'];
    expect(answerWindow(g, 'B')).toEqual(['glass_cleaner+']);
  });

  it('goes under the deck outside Crunch Time when its card is a crunch card', () => {
    const r = drawCards([], ['reset+', 'close_out'], 2, { crunchActive: false });
    expect(r.hand).toEqual(['close_out']);
    expect(r.bottomed).toEqual(['reset+']);
  });
});

describe('the guard: a deck of "+" copies plays exactly like its plain twin', () => {
  // EXACT, not "about as often": with no "+" text a copy must play as its
  // card, so the same seeds must give the same game, roll for roll. A loose
  // band missed an AI that valued every "+" copy at the default (it still got
  // played, just at other moments): 7 of 40 games came out the same, and the
  // band passed. The deck is the fitted fifties' cards OUTSIDE the kits,
  // which have no "+" text in piece 1, so this stays true once Task 6 writes
  // the kit cards' effects (piece 2 will need cards without one, or none).
  it('over seeded quarter games, every game comes out the same', () => {
    const a = CARDS.slice(0, 8);
    const b = CARDS.slice(8, 16);
    const deck = {};
    for (const arch of ARCHETYPE_DECKS) {
      for (const [id, n] of Object.entries(arch.deck)) {
        if (!KIT_CARD_IDS.has(id) && !PLUS[id]) deck[id] = Math.max(deck[id] ?? 0, n);
      }
    }
    expect(Object.keys(deck).length).toBeGreaterThan(20);
    for (let seed = 1; seed <= 30; seed += 1) {
      const play = deckA => simulateGame(a, b, { deckA, deckB: kitDeck('paint'), rng: climbRng(seed, 'guard'), keepGame: true, gameOpts: { startQuarter: 4 } });
      const plain = play(deck);
      const plus = play(plusDeck(deck));
      expect([plus.scoreA, plus.scoreB], `seed ${seed}`).toEqual([plain.scoreA, plain.scoreB]);
      expect(plus.game.log.map(l => l.msg.replace(/\+/g, '')), `seed ${seed}`).toEqual(plain.game.log.map(l => l.msg.replace(/\+/g, '')));
      expect([...plus.game.teamA.hand, ...plus.game.teamA.deck].every(isPlus), `seed ${seed}`).toBe(true);
    }
  });
});
