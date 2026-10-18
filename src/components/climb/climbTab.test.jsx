// ONE STEP AT A TIME (final review, 2026-10-18). The busy flag lived in React
// state, so two taps in one tick both read "not busy": two different stops
// opened, and the server ends a run whose second game opens over the first.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

describe('the Climb tab\'s gate', () => {
  it('runs one step while another is in flight, never two', async () => {
    const { oneAtATime } = await import('./ClimbTab.jsx');
    const gate = { current: false };
    let release;
    const first = vi.fn(() => new Promise(r => { release = r; }));
    const second = vi.fn(async () => {});
    const a = oneAtATime(gate, first);
    const b = oneAtATime(gate, second);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(await b).toBe(false);
    release();
    expect(await a).toBe(true);
    expect(gate.current).toBe(false);
    expect(await oneAtATime(gate, second)).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
  });
});
