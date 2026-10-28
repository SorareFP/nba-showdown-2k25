// THE WAYS IN to the Live Series view (2026-10-28): its own Collection view,
// the Live collection's row, and Home's news.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { HOME_SECTIONS, NEWS } from '../game/home.js';

vi.mock('../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

const { default: CollectionGoals } = await import('./CollectionGoals.jsx');

describe('the Live Series view', () => {
  it('is a Collection section Home can open', () => {
    expect(HOME_SECTIONS.live).toBe('live');
  });

  it('has a news item that opens it', () => {
    expect(NEWS.some(n => n.to === 'live')).toBe(true);
  });

  it('is a link on the Live collection\'s row, and on no other', () => {
    const html = renderToStaticMarkup(
      <CollectionGoals collection={{}} claims={{}} coins={0} onClaim={() => {}} onCollect={() => {}} onOpenLive={() => {}} />,
    );
    expect(html.match(/data-open-live/g)?.length).toBe(1);
  });

  it('is no link where nothing opens it', () => {
    const html = renderToStaticMarkup(<CollectionGoals collection={{}} claims={{}} coins={0} onClaim={() => {}} onCollect={() => {}} />);
    expect(html).not.toContain('data-open-live');
  });
});
