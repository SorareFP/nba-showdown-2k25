// A win is a win for the HUMAN, not for whoever scored more.
import { describe, it, expect } from 'vitest';
import { humanWon, humanTeamKey } from './outcome.js';

const game = (a, b) => ({ teamA: { score: a }, teamB: { score: b } });

describe('humanWon', () => {
  it('against the coach: A is you, and only an A win pays', () => {
    expect(humanWon(game(90, 80), { mode: 'ai' })).toBe(true);
    expect(humanWon(game(80, 90), { mode: 'ai' })).toBe(false);   // the game the user lost
    expect(humanWon(game(85, 85), { mode: 'ai' })).toBe(false);   // a tie is no win
    expect(humanWon(game(90, 80))).toBe(true);                    // 'ai' is the default
  });

  it('hotseat: nobody is you, nobody wins the bonus', () => {
    expect(humanWon(game(90, 80), { mode: 'hotseat' })).toBe(false);
    expect(humanWon(game(80, 90), { mode: 'hotseat' })).toBe(false);
  });

  it('PvP: your side decides', () => {
    expect(humanWon(game(90, 80), { mode: 'pvp', myTeamKey: 'A' })).toBe(true);
    expect(humanWon(game(90, 80), { mode: 'pvp', myTeamKey: 'B' })).toBe(false);
    expect(humanWon(game(80, 90), { mode: 'pvp', myTeamKey: 'B' })).toBe(true);
    expect(humanWon(game(80, 90), { mode: 'pvp', myTeamKey: null })).toBe(false);
  });

  it('names the human\'s team for the box score', () => {
    expect(humanTeamKey({ mode: 'ai' })).toBe('A');
    expect(humanTeamKey({ mode: 'pvp', myTeamKey: 'B' })).toBe('B');
    expect(humanTeamKey({ mode: 'hotseat' })).toBeNull();
  });
});
