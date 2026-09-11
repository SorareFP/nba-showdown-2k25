// THE THROWBACKS MOTIF — the 1990s cup's teal brush stroke and purple scribble,
// on every Throwbacks card whatever its decade (the user, 2026-09-10: one
// uniform look, "keep the loud colors, it's fine"; the design is
// docs/plans/2026-09-10-throwbacks-design.md). The palette around it is the
// `throwback` treatment's (treatments.js), and CardTemplate draws this for any
// treatment that carries `motif: 'throwback'`.
//
// Three slots, each a place the card already reserves for decoration and where
// no text sits: the TOP-RIGHT and BOTTOM-LEFT corners the dotted chevrons hold
// on every other set, and the TOP BAND's two open patches — left of the league
// mark, and the gap between SPEED and POWER. Nothing is painted under a number
// or a name.
//
// Static SVG drawn from shapes, not images: the batch export screenshots the
// card, so there is nothing to load and nothing to animate.
import { useId } from 'react';
import { THROWBACK_TEAL } from './treatments.js';
import s from './ThrowbackMotif.module.css';

const SIZE = { band: [843, 112], top: [135, 132], bottom: [152, 132] };
// The band's open patches: left of the league mark, and between the stat blocks.
const LEFT = { x: 9, y: 7, w: 66, h: 99 };
const GAP = { x: 380, y: 7, w: 69, h: 99 };
const TEAL_LIGHT = '#39CACA';
const SCRIBBLE = '#5B2A86';

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

const swath = (u, d, w, color = THROWBACK_TEAL) => (
  <path d={d} fill="none" stroke={color} strokeWidth={w} strokeLinecap="round" filter={`url(#brush${u})`} />
);
const scribble = (u, d, w = 6) => (
  <path d={d} fill="none" stroke={SCRIBBLE} strokeWidth={w} strokeLinejoin="round" strokeLinecap="round" filter={`url(#rough${u})`} />
);
const clipTo = (id, z) => (
  <clipPath id={id}>
    <rect x={z.x} y={z.y} width={z.w} height={z.h} />
  </clipPath>
);

const DRAW = {
  band: u => (
    <>
      {brushDefs(u)}
      <defs>{clipTo(`l${u}`, LEFT)}{clipTo(`g${u}`, GAP)}</defs>
      <g clipPath={`url(#l${u})`}>
        {swath(u, 'M 0 96 L 80 20', 34)}
        {scribble(u, zigzag(12, 84, 70, 11, 3, -48))}
      </g>
      <g clipPath={`url(#g${u})`}>
        {swath(u, 'M 372 100 L 456 14', 38)}
        {scribble(u, zigzag(384, 92, 84, 12, 4, -50))}
      </g>
    </>
  ),
  top: u => (
    <>
      {brushDefs(u)}
      {swath(u, 'M -10 70 L 150 18', 40)}
      {swath(u, 'M 10 132 L 150 86', 30, TEAL_LIGHT)}
      {scribble(u, zigzag(4, 98, 140, 16, 5, -22), 7)}
    </>
  ),
  bottom: u => (
    <>
      {brushDefs(u)}
      {swath(u, 'M -10 110 L 165 48', 42)}
      {swath(u, 'M 0 36 L 120 -4', 26, TEAL_LIGHT)}
      {scribble(u, zigzag(6, 104, 150, 16, 5, -20), 7)}
    </>
  ),
};

export default function ThrowbackMotif({ slot }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const draw = DRAW[slot];
  if (!draw) return null;
  const [w, h] = SIZE[slot];
  return (
    <svg className={s[slot]} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-motif="throwback" data-slot={slot}>
      {draw(uid)}
    </svg>
  );
}
