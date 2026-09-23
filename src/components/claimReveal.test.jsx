// THE CLAIM REVEAL (2026-09-23): a claimed collection's reward on its own
// stage, with the fanfare a pull of its band gets. Static markup.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import ClaimReveal, { goalTitle, fanfareTierFor } from './ClaimReveal.jsx';
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
