// The legendary foil: renders one clipped layer pair per region, on the
// caller's own box, only when active — and costs an inactive card nothing.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Holo from './HoloSheen.jsx';

const html = props => renderToStaticMarkup(createElement(Holo, props, createElement('img', { src: 'x.png', alt: '' })));
const count = (s, re) => (s.match(re) || []).length;

describe('HoloSheen', () => {
  it('paints the photo region only, by default', () => {
    const out = html({ active: true, className: 'art' });
    expect(out).toMatch(/^<div class="[^"]*holo[^"]* art" data-holo="">/);
    expect(out).toContain('<img src="x.png" alt=""/>');
    expect(count(out, /data-region="/g)).toBe(1);
    expect(out).toContain('data-region="photo"');
    expect(out).toMatch(/clip-path:polygon\(17\.79% 13\.04%/);
    expect(count(out, /class="[^"]*foil[^"]*"/g)).toBe(1);
    expect(count(out, /class="[^"]*glare[^"]*"/g)).toBe(1);
  });

  it('adds the gold band and frame when asked, one layer pair each', () => {
    const out = html({ active: true, className: 'art', regions: ['photo', 'band', 'frame'] });
    expect(count(out, /data-region="/g)).toBe(3);
    expect(out).toContain('data-region="band"');
    expect(out).toContain('data-region="frame"');
    expect(out).toContain('polygon(evenodd, ');
    expect(count(out, /class="[^"]*foil[^"]*"/g)).toBe(3);
  });

  it('renders the plain element for anything that is not legendary', () => {
    expect(html({ active: false, className: 'art' })).toBe('<div class="art"><img src="x.png" alt=""/></div>');
  });

  it('can be any element, so a full-res image gets an inline box', () => {
    const out = html({ active: true, as: 'span', className: 'wrap' });
    expect(out.startsWith('<span ')).toBe(true);
    expect(out.endsWith('</span>')).toBe(true);
  });

  it('keeps the face container as the one thing the layers are positioned in', () => {
    const out = html({ active: true });
    expect(count(out, /class="[^"]*face[^"]*" aria-hidden="true"/g)).toBe(1);
  });
});
