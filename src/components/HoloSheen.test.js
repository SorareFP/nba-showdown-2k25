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
    expect(out).toMatch(/^<div class="[^"]*holo[^"]* art" data-holo="" data-idle="">/);
    expect(out).toContain('<img src="x.png" alt=""/>');
    // A grid tile asks for no idle drift and gets no attribute to animate on.
    expect(html({ active: true, className: 'art', idle: false })).toMatch(/^<div class="[^"]*holo[^"]* art" data-holo="">/);
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

  it('takes measured regions as objects with their own clip, the shape holoRegionsFor hands over', () => {
    const out = html({ active: true, regions: [
      { key: 'name', clip: 'polygon(1% 2%, 3% 2%, 3% 4%, 1% 4%)' },
      { key: 'badge', clip: 'polygon(5% 6%, 7% 6%, 7% 8%, 5% 8%)' },
    ] });
    expect(count(out, /data-region="/g)).toBe(2);
    expect(out).toContain('data-region="name" style="clip-path:polygon(1% 2%, 3% 2%, 3% 4%, 1% 4%)"');
    expect(out).toContain('data-region="badge"');
  });

  it('marks the reveal sweep only while the caller asks for it', () => {
    // A BEAT, NOT A STATE. The pack turns it on as the card lands and off on
    // the way to the next one, and the attribute genuinely leaving is what
    // restarts the one-shot animation next time. An always-on sweep would be
    // a faster, worse drift.
    expect(html({ active: true })).not.toContain('data-sweep');
    const swept = html({ active: true, sweep: true });
    expect(swept).toContain('data-sweep=""');
    // It rides on top of the ordinary foil rather than replacing it: the
    // regions and their layers are unchanged.
    expect(count(swept, /class="[^"]*foil[^"]*"/g)).toBe(count(html({ active: true }), /class="[^"]*foil[^"]*"/g));
    // And an inactive card is still nothing at all, sweep or no sweep.
    expect(html({ active: false, sweep: true })).not.toContain('data-sweep');
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
