// Structural tests, react-dom/server like CardTemplate's — see the rationale
// at the top of CardTemplate.test.js.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import StratTemplate, {
  STRAT_CARD_WIDTH,
  STRAT_CARD_HEIGHT,
  phaseLine,
  faceParagraphs,
  LOCK_LINE,
} from './StratTemplate.jsx';
import { STRATS } from '../game/strats.js';

const render = props => renderToStaticMarkup(React.createElement(StratTemplate, props));

describe('the strategy-card face', () => {
  it('ships at the hand-made faces’ exact size', () => {
    // All 43 existing faces are 825x1238; a different size would render the
    // composed cards as the odd ones out in every spread.
    expect(STRAT_CARD_WIDTH).toBe(825);
    expect(STRAT_CARD_HEIGHT).toBe(1238);
  });

  it('renders every shipped strat without art', () => {
    for (const s of STRATS) {
      const html = render({ strat: s });
      // renderToStaticMarkup HTML-escapes text ("High Screen &amp; Roll").
      expect(html, s.id).toContain(s.name.replace(/&/g, '&amp;').replace(/'/g, '&#x27;'));
      expect(html, s.id).toContain('NO ART');
      expect(html, s.id).toContain(s.side === 'def' ? 'DEFENSE' : 'OFFENSE');
    }
  });

  it('knows a printed line for every phase the deck actually uses', () => {
    // The fallback line exists for safety, but no shipped card should need
    // it — a new phase value should come with its own wording.
    for (const phase of new Set(STRATS.map(s => s.phase))) {
      expect(phaseLine(phase), phase).not.toBe('Play during the game.');
    }
  });

  it('states the lock once, in the standard wording, wherever it comes from', () => {
    // Locked flag without a marker in desc:
    const flagged = faceParagraphs({ desc: 'Do the thing.', locked: true });
    expect(flagged.locked).toBe(true);
    // Marker inside desc without the flag (And One's actual shape):
    const andOne = STRATS.find(s => s.id === 'and_one');
    const inline = faceParagraphs(andOne);
    expect(inline.locked).toBe(true);
    expect(inline.paragraphs.join(' ')).not.toContain('\u{1F512}');
    const html = render({ strat: andOne });
    expect(html.split(LOCK_LINE.slice(-20)).length - 1).toBe(1);
  });

  it('splits rules text into sentences and keeps them all', () => {
    const dt = STRATS.find(s => s.id === 'double_team');
    const { paragraphs } = faceParagraphs(dt);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.join(' ')).toBe(dt.desc);
  });

  it('shows the art and hides the placeholder when art is given', () => {
    const html = render({ strat: STRATS[0], artUrl: '/x.png' });
    expect(html).toContain('/x.png');
    expect(html).not.toContain('NO ART');
  });
});
