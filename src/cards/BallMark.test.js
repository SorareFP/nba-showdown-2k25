// The component is a renderer for ballMark.geom.js and almost nothing else, so
// what is worth testing is exactly the join: that plain {tag, attrs, kids}
// descriptors survive the trip through createElement into real SVG, and that
// the one prop it forwards — the WNBA ball's two-tone panels — reaches it.
//
// Static markup, same as CardTemplate.test.js, and for the same reason: there
// is nothing here that needs a DOM.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import BallMark from './BallMark.jsx';
import { buildFaces, buildEdges, buildSeams, buildPanels } from './ballMark.geom.js';

const render = props => renderToStaticMarkup(React.createElement(BallMark, props));

describe('BallMark', () => {
  it('renders every face and every seam the geometry produced', () => {
    // The failure this catches is a descriptor shape the renderer silently drops
    // — the mark would still look plausible with a face or two missing.
    const svg = render({ size: 300 });
    expect(svg.match(/<polygon/g) ?? []).toHaveLength(buildFaces().length);
    expect(svg.match(/<path/g) ?? []).toHaveLength(buildEdges().length + buildSeams().length);
    expect(svg).toContain('<circle');
  });

  it('carries camelCase SVG props through as real attributes', () => {
    // React maps strokeWidth to stroke-width; a descriptor key it does not know
    // is dropped without a word, which is how a gradient stop quietly loses its
    // colour. Checking the hyphenated form is checking the mapping happened.
    const svg = render({ size: 300 });
    expect(svg).toContain('stroke-width');
    expect(svg).toContain('stroke-linecap');
    expect(svg).toContain('stop-color');
    expect(svg).toContain('stop-opacity');
  });

  it('carries no numerals at all', () => {
    // The mark is the ball. It went through a numbered draft and came back.
    expect(render({ size: 300 })).not.toContain('<text');
  });

  it('paints the alternate panels pale only for the WNBA ball', () => {
    const nba = render({ size: 300 });
    const wnba = render({ size: 300, twoTone: true });
    expect(wnba).toContain('fill-opacity');
    const white = buildPanels().filter(p => p.white).length;
    expect((wnba.match(/<polygon/g) ?? []).length).toBe(
      (nba.match(/<polygon/g) ?? []).length + white
    );
  });

  it('is square, transparent and labelled', () => {
    const svg = render({ size: 64, title: 'Showdown' });
    expect(svg).toContain('width="64" height="64"');
    expect(svg).toContain('viewBox="0 0 100 100"');
    expect(svg).toContain('aria-label="Showdown"');
    expect(svg).not.toContain('<rect');
  });
});
