// SORTING THE COLLECTIONS BY HOW COMPLETE THEY ARE (Ryan, through the
// suggestion box, 2026-10-07: "Sorting collections by percentage like on Home
// Screen"). A-Z stays the default; "Most complete" is the option.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

const { default: CollectionGoals, sortGoalRows, GOAL_SORTS, divisionHeads } = await import('./CollectionGoals.jsx');

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
    expect(out).toMatch(/<option value="az"[^>]*>A–Z<\/option><option value="progress">Most complete<\/option><option value="division">By division<\/option>/);
    expect(Object.keys(GOAL_SORTS)).toEqual(['az', 'progress', 'division']);
  });
});

// BY DIVISION (Ryan, through the suggestion box, 2026-10-10: "sorting teams by
// division / conference to help w pack selection decisions"). The NBA's
// franchises in conference and division order, the way the Division and
// Conference packs are cut; the WNBA has no divisions and keeps A-Z.
describe('the division sort', () => {
  const team = (id, league = 'NBA') => ({ id: `${league}-${id}`, label: id, kind: 'team', league, owned: 1, total: 10, complete: false });

  it('orders NBA franchises East then West, division by division, A-Z within', () => {
    const rows = [team('LAL'), team('BOS'), team('DAL'), team('ATL'), team('CHI'), team('PHI'), team('DEN')];
    expect(sortGoalRows(rows, 'division').map(r => r.label)).toEqual(['BOS', 'PHI', 'CHI', 'ATL', 'DEN', 'LAL', 'DAL']);
  });

  it('heads each division once, at its first row', () => {
    const sorted = sortGoalRows([team('PHI'), team('BOS'), team('CHI'), team('LAL')], 'division');
    expect(divisionHeads(sorted)).toEqual({ 'NBA-BOS': 'East · Atlantic', 'NBA-CHI': 'East · Central', 'NBA-LAL': 'West · Pacific' });
  });

  it('leaves the WNBA and every other tier A-Z, with no heads', () => {
    const wnba = [team('SEA', 'WNBA'), team('ATL', 'WNBA'), team('MIN', 'WNBA')];
    expect(sortGoalRows(wnba, 'division')).toBe(wnba);
    expect(divisionHeads(wnba)).toEqual({});
  });
});
