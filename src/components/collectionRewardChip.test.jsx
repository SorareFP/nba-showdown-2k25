// THE REWARD CHIP OPENS THE CARD ONCE CLAIMED (the user, 2026-09-23: "making
// the collection reward viewable through this button once a collection is
// claimed"). Static markup: claimed, it is a button wearing the card's face;
// unclaimed, or outside a lightbox, a label.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import { LightboxProvider } from './CardLightbox.jsx';
import { RewardChip } from './CollectionGoals.jsx';
import { allGoalProgress } from '../game/collections.js';
import { getCardByKey } from '../game/cardSets.js';

const html = el => renderToStaticMarkup(el);
const goal = allGoalProgress(new Set(), { league: 'NBA' }).find(g => g.reward);
const reward = getCardByKey(goal.reward);

describe('RewardChip', () => {
  it('is a button wearing the card\'s face once the collection is claimed', () => {
    const out = html(<LightboxProvider><RewardChip reward={reward} claimed /></LightboxProvider>);
    expect(out).toContain('<button');
    expect(out).toContain('see your reward card');
    expect(out).toContain('<img');
    expect(out).toContain(reward.name);
  });

  it('stays a label before the claim, and says why', () => {
    const out = html(<LightboxProvider><RewardChip reward={reward} claimed={false} /></LightboxProvider>);
    expect(out).not.toContain('<button');
    expect(out).toContain('claim the collection to see the card');
    expect(out).toContain(reward.name);
  });

  it('is a label outside a lightbox, whatever the claim', () => {
    expect(html(<RewardChip reward={reward} claimed />)).not.toContain('<button');
  });
});
