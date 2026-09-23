// THE LOG DOCKED IN THE WIDE-MONITOR RAIL (2026-09-23). On a big screen the
// log sits open beside the court; folded, it is the one-line strip above it.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import GameLog from './GameLog.jsx';
import { isWideNow, WIDE_QUERY } from '../../ui/useIsWide.js';

const log = [
  { team: null, msg: 'Lineups locked — begin placement.' },
  { team: 'A', msg: 'Rebound Track lead → Team A +1 AST' },
];

describe('GameLog docked', () => {
  it('shows every entry open, with no fold toggle', () => {
    const html = renderToStaticMarkup(<GameLog log={log} docked />);
    expect(html).toContain('Lineups locked');
    expect(html).toContain('Rebound Track lead');
    expect(html).not.toContain('▼');
    expect(html).toContain('2 entries');
  });

  it('folds to the one-line strip when not docked', () => {
    const html = renderToStaticMarkup(<GameLog log={log} />);
    expect(html).toContain('▼');
    // Only the latest line, in the strip; the list is not rendered.
    expect(html).not.toContain('Lineups locked');
  });
});

describe('the wide breakpoint', () => {
  it('is the app column’s wide step, and false with no matchMedia (tests, server)', () => {
    expect(WIDE_QUERY).toBe('(min-width: 2200px)');
    expect(isWideNow()).toBe(false);
  });
});
