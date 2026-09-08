// The tutorial's shaped hands: a switch for the player every early section,
// no canceller for the coach in section 1, Go Under and only Go Under in
// section 2 — and never a card created or lost.
import { describe, it, expect } from 'vitest';
import { newGame } from './engine.js';
import { CARDS } from './cards.js';
import { teachingHands, TEACHING_CARD, CANCELLERS, LESSON_CANCELLER } from './tutorialHands.js';

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

  it('touches nothing after section 2', () => {
    const g = fresh(3);
    expect(teachingHands(g)).toBe(g);
    const q2 = fresh(1); q2.quarter = 2;
    expect(teachingHands(q2)).toBe(q2);
  });
});
