// The tutorial's shaped hands: a switch for the player every early section,
// no canceller for the coach in section 1, Go Under and only Go Under in
// section 2, a forfeit-family card for the player in section 3 — and never a
// card created or lost.
import { describe, it, expect } from 'vitest';
import { newGame } from './engine.js';
import { CARDS } from './cards.js';
import { teachingHands, TEACHING_CARD, CANCELLERS, LESSON_CANCELLER, FORFEIT_LESSON_CARDS } from './tutorialHands.js';

const multiset = t => [...t.hand, ...t.deck].sort().join(',');

function fresh(section = 1) {
  const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
  g.quarter = 1; g.section = section;
  return g;
}

describe('teachingHands', () => {
  it('section 1: the player holds the switch, the coach holds no canceller, seven each', () => {
    for (let n = 0; n < 8; n += 1) {
      const g = fresh(1);
      const before = { A: multiset(g.teamA), B: multiset(g.teamB) };
      const s = teachingHands(g);
      expect(s.teamA.hand).toContain(TEACHING_CARD);
      expect(s.teamB.hand.some(id => CANCELLERS.includes(id))).toBe(false);
      expect(s.teamA.hand).toHaveLength(7);
      expect(s.teamB.hand).toHaveLength(7);
      expect(multiset(s.teamA)).toBe(before.A);
      expect(multiset(s.teamB)).toBe(before.B);
    }
  });

  it('section 2: the player holds the switch, the coach holds Go Under and no other canceller', () => {
    for (let n = 0; n < 8; n += 1) {
      const g = fresh(2);
      const before = multiset(g.teamB);
      const s = teachingHands(g);
      expect(s.teamA.hand).toContain(TEACHING_CARD);
      expect(s.teamB.hand).toContain(LESSON_CANCELLER);
      expect(s.teamB.hand.some(id => CANCELLERS.includes(id) && id !== LESSON_CANCELLER)).toBe(false);
      expect(s.teamB.hand.length).toBeLessThanOrEqual(7);
      expect(multiset(s.teamB)).toBe(before);
    }
  });

  // 2026-09-18: section 3 deals a forfeit-family card for the coach-tip
  // lesson — from the deck only, never created.
  it('section 3: the player holds a forfeit-family card when the deck has one, and nothing is created', () => {
    for (let n = 0; n < 8; n += 1) {
      const g = fresh(3);
      g.teamA.hand = g.teamA.hand.filter(id => !FORFEIT_LESSON_CARDS.includes(id));
      while (g.teamA.hand.length < 7) g.teamA.hand.push('high_screen_roll');
      const before = multiset(g.teamA);
      const inDeck = g.teamA.deck.some(id => FORFEIT_LESSON_CARDS.includes(id));
      const s = teachingHands(g);
      expect(s.teamA.hand.some(id => FORFEIT_LESSON_CARDS.includes(id))).toBe(inDeck);
      expect(s.teamA.hand).toHaveLength(7);
      expect(multiset(s.teamA)).toBe(before);
      expect(s.teamB).toBe(g.teamB);
    }
    // None left anywhere: the hand is left alone.
    const bare = fresh(3);
    bare.teamA.hand = bare.teamA.hand.filter(id => !FORFEIT_LESSON_CARDS.includes(id));
    bare.teamA.deck = bare.teamA.deck.filter(id => !FORFEIT_LESSON_CARDS.includes(id));
    expect(teachingHands(bare)).toBe(bare);
  });

  it('touches nothing after Q1', () => {
    const q2 = fresh(1); q2.quarter = 2;
    expect(teachingHands(q2)).toBe(q2);
    const q4 = fresh(3); q4.quarter = 4;
    expect(teachingHands(q4)).toBe(q4);
  });
});
