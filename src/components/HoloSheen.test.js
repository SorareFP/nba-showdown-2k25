// The legendary foil: renders its two layers only when active, keeps the
// caller's element type and class, and costs an inactive card nothing.
import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Holo from './HoloSheen.jsx';

const html = props => renderToStaticMarkup(createElement(Holo, props, createElement('img', { src: 'x.png', alt: '' })));

describe('HoloSheen', () => {
  it('paints a foil and a glare over an active card, on the caller\'s own box', () => {
    const out = html({ active: true, className: 'art' });
    expect(out).toMatch(/^<div class="[^"]*holo[^"]* art" data-holo="">/);
    expect(out).toContain('<img src="x.png" alt=""/>');
    expect((out.match(/aria-hidden="true"/g) || []).length).toBe(2);
    expect(out).toMatch(/class="[^"]*foil[^"]*"/);
    expect(out).toMatch(/class="[^"]*glare[^"]*"/);
  });

  it('renders the plain element for anything that is not legendary', () => {
    const out = html({ active: false, className: 'art' });
    expect(out).toBe('<div class="art"><img src="x.png" alt=""/></div>');
  });

  it('can be any element, so a full-res image gets an inline box', () => {
    const out = html({ active: true, as: 'span', className: 'wrap' });
    expect(out.startsWith('<span ')).toBe(true);
    expect(out.endsWith('</span>')).toBe(true);
  });

  it('is active by default, the way a call site that already checked rarity expects', () => {
    expect(html({ className: 'a' })).toContain('data-holo');
  });
});
