// A PLAYER'S MARKERS PRINT THEIR COUNT (2026-09-24). The user, on a lineup
// card reading a bare HOT: "it should say hot/cold x2+ or however many hot
// markers they have". The net is what the engine applies, 2 per marker.
import { describe, it, expect } from 'vitest';
import { markerCount, markerWord, markerEmoji } from './CourtBoard.jsx';

describe('the marker label', () => {
  it('is blank with no net marker', () => {
    expect(markerWord({})).toBe('');
    expect(markerWord({ hot: 1, cold: 1 })).toBe('');
    expect(markerEmoji({ hot: 2, cold: 2 })).toBe('');
  });

  it('says HOT or COLD alone for one, and the count from two up', () => {
    expect(markerWord({ hot: 1 })).toBe('HOT');
    expect(markerWord({ hot: 3 })).toBe('HOT ×3');
    expect(markerWord({ cold: 2 })).toBe('COLD ×2');
    expect(markerWord({ hot: 4, cold: 1 })).toBe('HOT ×3');
    expect(markerEmoji({ hot: 2 })).toBe('🔥×2');
    expect(markerEmoji({ cold: 1 })).toBe('❄️');
  });

  it('counts the net, as the engine applies it', () => {
    expect(markerCount({ hot: 3, cold: 1 })).toBe(2);
    expect(markerCount({ cold: 2 })).toBe(-2);
  });
});
