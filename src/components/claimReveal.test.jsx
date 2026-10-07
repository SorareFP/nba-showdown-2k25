// THE CLAIM REVEAL (2026-09-23): a claimed collection's reward on its own
// stage, with the fanfare a pull of its band gets. Static markup.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import ClaimReveal, { goalTitle, fanfareTierFor, claimRevealFrom } from './ClaimReveal.jsx';
import { allGoalProgress } from '../game/collections.js';

const html = el => renderToStaticMarkup(el);
const goals = allGoalProgress(new Set(), { league: 'NBA' });
const withReward = goals.find(g => g.reward);
const coinsOnly = goals.find(g => !g.reward && g.rewardCoins > 0) ?? goals[0];

describe('ClaimReveal', () => {
  it('names the collection and holds the reward face down until it is tapped', () => {
    const out = html(<ClaimReveal goalId={withReward.id} cardKey={withReward.reward} coins={490} onClose={() => {}} />);
    expect(out).toContain('Collection complete');
    expect(out).toContain(goalTitle(withReward.id));
    expect(out).toContain('Reveal your reward');
    expect(out).toContain('Tap to reveal your reward');
    expect(out).toContain('Reveal first');
    expect(out).toContain('disabled');
    // Nothing of the card is named before the turn.
    expect(out).not.toContain('LEGENDARY');
  });

  it('shows the coins as the reveal when a collection pays coins only', () => {
    const out = html(<ClaimReveal goalId={coinsOnly.id} cardKey={null} coins={1250} onClose={() => {}} />);
    expect(out).toContain('1,250');
    expect(out).toContain('This collection pays coins');
    expect(out).not.toContain('Reveal your reward');
  });

  it('gives a franchise its full name and a set its label', () => {
    const team = goals.find(g => g.kind === 'team');
    expect(goalTitle(team.id)).not.toBe(team.label);
    expect(goalTitle(team.id).length).toBeGreaterThan(team.label.length);
    expect(goalTitle('no-such-goal')).toBe('Collection');
  });

  it('never celebrates below a super-rare, and a legendary as a legendary', () => {
    expect(fanfareTierFor('common')).toBe('super-rare');
    expect(fanfareTierFor('rare')).toBe('super-rare');
    expect(fanfareTierFor('super-rare')).toBe('super-rare');
    expect(fanfareTierFor('legendary')).toBe('legendary');
    expect(fanfareTierFor(null)).toBe('super-rare');
  });
});

// THE CARD REACHES THE REVEAL FROM EITHER ROUTE (2026-10-07). The server's
// claimGoal answered `{ reward, coins }` and the screen read `res.card`, so
// every live claim played the coins-only reveal and never turned its card.
describe('what a claim hands the reveal', () => {
  it("reads the server's `reward`, the direct route's `card`, and both at once", () => {
    expect(claimRevealFrom('g', { goalId: 'g', reward: 'super-season:Larry_Bird', coins: 490 }))
      .toEqual({ goalId: 'g', cardKey: 'super-season:Larry_Bird', coins: 490 });
    expect(claimRevealFrom('g', { goalId: 'g', coins: 490, card: 'Jayson_Tatum' }))
      .toEqual({ goalId: 'g', cardKey: 'Jayson_Tatum', coins: 490 });
    expect(claimRevealFrom('g', { reward: 'a', card: 'a', coins: 1 }).cardKey).toBe('a');
  });

  it('is a coins-only reveal only when there really is no card', () => {
    expect(claimRevealFrom('g', { reward: null, coins: 300 })).toEqual({ goalId: 'g', cardKey: null, coins: 300 });
    expect(claimRevealFrom('g', undefined)).toEqual({ goalId: 'g', cardKey: null, coins: 0 });
  });

  it('is what the Collection tab and the server both use', async () => {
    const { readFileSync } = await import('node:fs');
    const tab = readFileSync(new URL('./CollectionTab.jsx', import.meta.url), 'utf8');
    const server = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
    expect(tab).toContain('setClaimReveal(claimRevealFrom(goalId, res))');
    expect(server).toMatch(/return \{ goalId, reward: rewardKey, card: rewardKey, coins \}/);
  });
});
