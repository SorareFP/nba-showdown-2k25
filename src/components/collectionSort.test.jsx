// SORTING THE COLLECTIONS BY HOW COMPLETE THEY ARE (Ryan, through the
// suggestion box, 2026-10-07: "Sorting collections by percentage like on Home
// Screen"). A-Z stays the default; "Most complete" is the option.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

const { default: CollectionGoals, sortGoalRows, GOAL_SORTS } = await import('./CollectionGoals.jsx');

const row = (id, owned, total, complete = owned >= total) => ({ id, label: id, owned, total, complete });

describe('sortGoalRows', () => {
  const rows = [row('Bulls', 3, 12), row('Celtics', 12, 12), row('Hawks', 9, 12), row('Jazz', 12, 12), row('Kings', 9, 10)];

  it('leaves the rows as they come for A-Z, the order they have always had', () => {
    expect(sortGoalRows(rows, 'az')).toBe(rows);
  });

  it('most complete first: a finished one to claim on top, a claimed one last', () => {
    const out = sortGoalRows(rows, 'progress', { Jazz: { claimedAt: 1 } }).map(r => r.id);
    // Celtics finished and unclaimed; then 90% (Kings), 75% (Hawks), 25% (Bulls); Jazz already claimed.
    expect(out).toEqual(['Celtics', 'Kings', 'Hawks', 'Bulls', 'Jazz']);
  });

  it('breaks a tie in share by the fewest missing, then the name', () => {
    const tied = [row('Zed', 6, 12), row('Abe', 3, 6), row('Mid', 5, 10)];
    expect(sortGoalRows(tied, 'progress').map(r => r.id)).toEqual(['Abe', 'Mid', 'Zed']);
  });
});

describe('the Collections page', () => {
  it('offers the sort beside Hide claimed, A-Z first', () => {
    const out = renderToStaticMarkup(
      <CollectionGoals collection={{}} claims={{}} coins={0} onClaim={() => {}} onCollect={() => {}} busyGoal={null} busyCard={null} />
    );
    expect(out).toContain('aria-label="Sort collections"');
    expect(out).toMatch(/<option value="az"[^>]*>A–Z<\/option><option value="progress">Most complete<\/option>/);
    expect(Object.keys(GOAL_SORTS)).toEqual(['az', 'progress']);
  });
});
