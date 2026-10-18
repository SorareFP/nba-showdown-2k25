// THE CLIMB'S STARTER KITS (docs/plans/2026-10-18-the-climb.md, Task 1): a
// shared core of switching cards and three playbooks of eight, drafted by hand
// because the three fitted fifties (archetypeDecks.js) differ by at most one
// copy of any card, so "the cards each uses more than the others" picks
// almost nothing.
import { describe, it, expect } from 'vitest';
import { CORE, KITS, PLAYBOOKS, PLAYBOOK_OF_ARCHETYPE, kitDeck, leanOf, KIT_CARD_IDS } from './climbKits.js';
import { STRAT_MAP, CRUNCH_CARDS } from '../strats.js';
import { ARCHETYPE_DECKS } from '../archetypeDecks.js';

const total = deck => Object.values(deck).reduce((t, n) => t + n, 0);

describe('the starter kits', () => {
  it('are a fifteen-card deck for every playbook: the core plus the kit', () => {
    expect(PLAYBOOKS).toEqual(['speed', 'paint', 'defense']);
    expect(total(CORE)).toBe(7);
    for (const pb of PLAYBOOKS) {
      expect(total(KITS[pb]), pb).toBe(8);
      const deck = kitDeck(pb);
      expect(total(deck), pb).toBe(15);
      const want = { ...CORE };
      for (const [id, n] of Object.entries(KITS[pb])) want[id] = (want[id] ?? 0) + n;
      expect(deck).toEqual(want);
    }
  });

  it('use only real commons and uncommons, no crunch cards, within each card\'s copy limit', () => {
    for (const pb of PLAYBOOKS) {
      for (const [id, n] of Object.entries(kitDeck(pb))) {
        const s = STRAT_MAP[id];
        expect(s, id).toBeTruthy();
        expect(['common', 'uncommon'], id).toContain(s.rarity);
        expect(CRUNCH_CARDS, id).not.toContain(id);
        expect(n, id).toBeLessThanOrEqual(s.copies);
      }
    }
  });

  it('maps each fitted archetype to its playbook', () => {
    expect(PLAYBOOK_OF_ARCHETYPE).toEqual({ fast: 'speed', big: 'paint', stoppy: 'defense' });
    for (const a of ARCHETYPE_DECKS) expect(PLAYBOOKS).toContain(PLAYBOOK_OF_ARCHETYPE[a.id]);
  });

  it('lean every signature card to its own kit; Close Out, in two kits, leans defense', () => {
    for (const pb of PLAYBOOKS) {
      for (const id of Object.keys(KITS[pb])) {
        if (id === 'close_out') continue;
        expect(leanOf(id), id).toBe(pb);
      }
    }
    expect(leanOf('close_out')).toBe('defense');
    expect(leanOf('no_such_card')).toBe(null);
  });

  it('name the twenty-six cards that get a "+" in piece 1', () => {
    expect(KIT_CARD_IDS.size).toBe(26);
    for (const pb of PLAYBOOKS) for (const id of Object.keys(kitDeck(pb))) expect(KIT_CARD_IDS.has(id), id).toBe(true);
  });
});

describe('the coach\'s deck', () => {
  it('is the nearest playbook\'s fifteen, grown from its archetype\'s fifty', async () => {
    const { coachDeck } = await import('./climbKits.js');
    const { nearestArchetype } = await import('../deckFit.js');
    const { CARDS } = await import('../cards.js');
    const { climbRng } = await import('./climbMap.js');
    const roster = CARDS.slice(0, 8);
    const pb = PLAYBOOK_OF_ARCHETYPE[nearestArchetype(roster).id];
    expect(coachDeck(roster, 15, climbRng(1, 'deck'))).toEqual(kitDeck(pb));
    const big = coachDeck(roster, 25, climbRng(1, 'deck'));
    expect(total(big)).toBe(25);
    for (const [id, n] of Object.entries(kitDeck(pb))) expect(big[id], id).toBeGreaterThanOrEqual(n);
    for (const [id, n] of Object.entries(big)) expect(n, id).toBeLessThanOrEqual(STRAT_MAP[id].copies);
    expect(coachDeck(roster, 25, climbRng(1, 'deck'))).toEqual(big);
  });
});
