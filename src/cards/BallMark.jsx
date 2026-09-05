// THE BALL — a basketball and a d20 that are the same object.
//
// All the thinking is in ballMark.geom.js, which computes the mark as plain
// {tag, attrs, kids} descriptors. This file only turns those into elements, so
// that the app and the standalone .svg the studio can emit are the same drawing
// rather than two drawings that have to be kept in step by hand.
//
// `twoTone` is the WNBA ball: the same geometry with alternate panels painted
// pale, which is the one thing that tells the two leagues' balls apart at a
// glance.
import { createElement } from 'react';
import { ballMarkNodes } from './ballMark.geom.js';

function render(node, key) {
  if (node.text !== undefined) return node.text;
  const kids = (node.kids ?? []).map((k, i) => render(k, i));
  return createElement(node.tag, { key, ...node.attrs }, kids.length ? kids : undefined);
}

export default function BallMark({ size = 300, title = 'NBA Showdown', twoTone = false }) {
  const nodes = ballMarkNodes({ twoTone });
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
    >
      {nodes.map((n, i) => render(n, i))}
    </svg>
  );
}
