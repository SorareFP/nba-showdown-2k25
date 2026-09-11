// THE THROWBACKS MOTIF — the 1990s cup's brush stroke and scribble, on every
// Throwbacks card whatever its decade (the user, 2026-09-10: one uniform look;
// the design is docs/plans/2026-09-10-throwbacks-design.md). CardTemplate draws
// this for any treatment that carries `motif: 'throwback'`.
//
// IN THE TEAM'S COLOURS (2026-09-11): the brush is the team's secondary and the
// scribble its accent, each already nudged to read where it lands — the
// `throwback` treatment (treatments.js) works them out and hands them in as
// `colors: { field, band }`. The cup's own teal and purple are the fallback.
//
// Three slots, each a place the card already reserves for decoration and where
// no text sits: the TOP-RIGHT corner the chevron holds on every other set, the
// BOTTOM-LEFT corner — flush, so the strokes come off the card's edge — and the
// TOP BAND's two open patches — left of the league mark, flush with the edge,
// and the gap between SPEED and POWER. Nothing is painted under a number or a
// name.
//
// Static SVG drawn from shapes, not images: the batch export screenshots the
// card, so there is nothing to load and nothing to animate.
import { useId } from 'react';
import { THROWBACK_TEAL, THROWBACK_PURPLE } from './treatments.js';
import s from './ThrowbackMotif.module.css';

// The bottom-left slot sits FLUSH in the card's corner (the user, 2026-09-10:
// "push this design into the bottom left corner, looking like it comes off the
// corner"), 210x160: clear of the name above it and the chart to its right.
//
// EVERY STROKE RUNS TO A LINE THE CARD ALREADY HAS, never to a box edge (the
// user, 2026-09-11: "make sure the design connects to where it's headed"). The
// top-left stroke comes off the corner and runs down to the band's bottom line,
// passing BEHIND the league mark, which paints over it. The middle stroke runs
// top line to bottom line inside the gap between SPEED and POWER, so neither
// side cuts it. The top-right strokes come off the corner and leave through
// the translucent bar's left edge (the slot's own left edge), in a slot tall
// enough that none leaves through its bottom.
const SIZE = { band: [843, 112], top: [135, 168], bottom: [210, 160] };
// The band's patches: the top-left one runs under the league mark and stops
// short of SPEED's letters (x ~186); the middle one is the gap between the two
// stat blocks. The frame paints over the outer 7px.
const LEFT = { x: 0, y: 0, w: 150, h: 112 };
const GAP = { x: 376, y: 0, w: 77, h: 112 };

/** The cup's own colours: what the mockups wore, and the fallback. */
const CUP = { brush: THROWBACK_TEAL, light: '#39CACA', scribble: THROWBACK_PURPLE };

const f1 = n => n.toFixed(1);

/** A zigzag scribble, `peaks` teeth over `len` at `angle` degrees. */
function zigzag(x0, y0, len, amp, peaks, angle = 0) {
  const a = (angle * Math.PI) / 180;
  const pts = [];
  for (let i = 0; i <= peaks * 2; i += 1) {
    const u = (i / (peaks * 2)) * len;
    const v = (i % 2 ? amp : -amp) * (0.75 + 0.25 * Math.sin(i * 1.7));
    pts.push(`${f1(x0 + u * Math.cos(a) - v * Math.sin(a))},${f1(y0 + u * Math.sin(a) + v * Math.cos(a))}`);
  }
  return `M ${pts.join(' L ')}`;
}

/**
 * The brush: a displacement for the ragged edge and a speckle mask for the
 * dry-brush holes. Ids carry the card's own suffix — a page of cards (the
 * studio's list, a pack reveal) would otherwise share the first card's defs.
 */
function brushDefs(u) {
  return (
    <defs>
      <filter id={`brush${u}`} x="-20%" y="-40%" width="140%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="2" seed="4" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="9" xChannelSelector="R" yChannelSelector="G" result="d" />
        <feTurbulence type="fractalNoise" baseFrequency="0.18 0.9" numOctaves="3" seed="9" result="s" />
        <feColorMatrix in="s" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.9 1.85" result="holes" />
        <feComposite in="d" in2="holes" operator="in" />
      </filter>
      <filter id={`rough${u}`} x="-20%" y="-40%" width="140%" height="180%">
        <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="1" seed="2" result="n" />
        <feDisplacementMap in="SourceGraphic" in2="n" scale="4" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </defs>
  );
}

const swath = (u, d, w, color) => (
  <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" filter={`url(#brush${u})`} />
);
const scribble = (u, d, color, w = 6) => (
  <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" filter={`url(#rough${u})`} />
);
const clipTo = (id, z) => (
  <clipPath id={id}>
    <rect x={z.x} y={z.y} width={z.w} height={z.h} />
  </clipPath>
);

const DRAW = {
  band: (u, c) => (
    <>
      {brushDefs(u)}
      <defs>{clipTo(`l${u}`, LEFT)}{clipTo(`g${u}`, GAP)}</defs>
      {/* Off the top-left corner, down to the band's bottom line, behind the league mark. */}
      <g clipPath={`url(#l${u})`}>
        {swath(u, 'M -18 -16 L 118 126', 40, c.brush)}
        {scribble(u, zigzag(-2, 10, 142, 11, 5, 46), c.scribble)}
      </g>
      {/* Top line to bottom line, inside the gap: nothing cuts its sides. */}
      <g clipPath={`url(#g${u})`}>
        {swath(u, 'M 432 -12 L 398 124', 34, c.brush)}
        {scribble(u, zigzag(430, -2, 118, 9, 5, 104), c.scribble)}
      </g>
    </>
  ),
  // Off the top-right corner, down and left, out through the bar's left edge.
  top: (u, c) => (
    <>
      {brushDefs(u)}
      {swath(u, 'M 150 -24 L -12 104', 40, c.brush)}
      {swath(u, 'M 150 44 L -12 150', 28, c.light)}
      {scribble(u, zigzag(140, -8, 176, 14, 6, 142), c.scribble, 7)}
    </>
  ),
  // Off the bottom-left corner, sweeping up and right: the strokes start past
  // the corner, so they read as coming off the card's edge.
  bottom: (u, c) => (
    <>
      {brushDefs(u)}
      {swath(u, 'M -24 188 L 196 16', 46, c.brush)}
      {swath(u, 'M -20 116 L 104 20', 24, c.light)}
      {scribble(u, zigzag(-6, 158, 214, 15, 6, -38), c.scribble, 7)}
    </>
  ),
};

export default function ThrowbackMotif({ slot, colors = null }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const draw = DRAW[slot];
  if (!draw) return null;
  const [w, h] = SIZE[slot];
  const palette = { ...CUP, ...(slot === 'band' ? colors?.band : colors?.field) };
  return (
    <svg className={s[slot]} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-motif="throwback" data-slot={slot}>
      {draw(uid, palette)}
    </svg>
  );
}
