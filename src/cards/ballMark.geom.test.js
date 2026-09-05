// The mark's geometry, which is computed rather than typed.
//
// Hand-written polygon points drift out of true the moment anything is nudged,
// and an icosahedron whose faces are not congruent looks wrong in a way that is
// hard to name. So the construction is tested rather than the drawing.
//
// The tests that matter most are the ones about the CIRCLE. The first version of
// this mark drew a flat icosahedron whose silhouette was the hull of its
// projected vertices — a lumpy ten-sided blob that did not read as a ball. The
// fix was to inflate the die onto its circumscribed sphere, and the whole point
// of that fix is that nothing the mark draws can ever stray outside the circle.
import { describe, it, expect } from 'vitest';
import {
  icosaVertices,
  icosaFaces,
  slerp,
  buildFaces,
  buildEdges,
  buildSeams,
  seamPaths,
  buildPanels,
  BASKETBALL,
  R,
  CX,
  CY,
} from './ballMark.geom.js';

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const fromCentre = ([x, y]) => Math.hypot(x - CX, y - CY);
const pointsOf = str => str.split(' ').map(t => t.split(',').map(Number));
const pathPoints = d => d.slice(2).split(' L ').map(t => t.split(',').map(Number));

describe('the icosahedron', () => {
  const verts = icosaVertices();
  const faces = icosaFaces(verts);

  it('has twelve vertices and twenty faces — which is what makes it a d20', () => {
    expect(verts).toHaveLength(12);
    expect(faces).toHaveLength(20);
  });

  it('puts every vertex on the unit sphere', () => {
    for (const v of verts) expect(Math.hypot(...v)).toBeCloseTo(1, 10);
  });

  it('makes every face an equilateral triangle of the same size', () => {
    // The property a typed-out polygon list always eventually breaks.
    const sides = faces.flatMap(([a, b, c]) => [
      dist(verts[a], verts[b]),
      dist(verts[b], verts[c]),
      dist(verts[c], verts[a]),
    ]);
    for (const s of sides) expect(s).toBeCloseTo(sides[0], 10);
  });

  it('uses every vertex exactly five times, as an icosahedron must', () => {
    const seen = new Array(12).fill(0);
    for (const f of faces) for (const i of f) seen[i] += 1;
    expect(seen).toEqual(new Array(12).fill(5));
  });
});

describe('slerp', () => {
  it('stays on the sphere the whole way — a straight line would cut through it', () => {
    const [a, b] = [icosaVertices()[0], icosaVertices()[1]];
    for (let t = 0; t <= 1; t += 0.05) {
      expect(Math.hypot(...slerp(a, b, t))).toBeCloseTo(1, 10);
    }
  });
});

describe('the ball is round', () => {
  // One rule, three surfaces: faces, facet edges and seams are all on a sphere
  // of radius R, so nothing they generate may land outside it. A failure here
  // means the silhouette has stopped being a circle, which is the exact way the
  // first attempt at this mark went wrong.
  const slack = 0.05;

  it('keeps every face inside the circle', () => {
    for (const f of buildFaces()) {
      for (const p of pointsOf(f.points)) expect(fromCentre(p)).toBeLessThanOrEqual(R + slack);
    }
  });

  it('keeps every facet edge inside the circle', () => {
    for (const d of buildEdges()) {
      for (const p of pathPoints(d)) expect(fromCentre(p)).toBeLessThanOrEqual(R + slack);
    }
  });

  it('keeps every seam inside the circle', () => {
    for (const d of buildSeams()) {
      for (const p of pathPoints(d)) expect(fromCentre(p)).toBeLessThanOrEqual(R + slack);
    }
  });

  it('fills the circle out to the rim, rather than sagging away from it', () => {
    // Chord interpolation would leave the faces short of the edge everywhere.
    const reach = Math.max(...buildFaces().flatMap(f => pointsOf(f.points).map(fromCentre)));
    expect(reach).toBeGreaterThan(R - 0.5);
  });
});

describe('what actually gets drawn', () => {
  it('shows the front hemisphere, which is MORE than half the faces', () => {
    // Not ten. A spherical triangle straddling the horizon is partly visible, so
    // it has to be drawn — clipped to the rim — or the ball shows a bite out of
    // its edge. How many straddle depends on the tilt (fifteen at one tilt,
    // sixteen at another), so the bounds are what is tested: ten or fewer would
    // mean the horizon cut has started dropping faces it should be clipping;
    // twenty would mean the back of the die is being painted too.
    const drawn = buildFaces();
    expect(drawn.length).toBeGreaterThan(10);
    expect(drawn.length).toBeLessThan(20);
  });

  it('has four meridians at forty-five degrees and no equator', () => {
    // Four, not three. Three at sixty degrees passes the head-on test and fails
    // the two a real ball passes without trying: turned half a revolution its
    // two-tone colouring inverts (six lunes, moved three along), and it shows
    // two panels across the front where a real ball shows four. Four meridians
    // is eight lunes, which is the real ball's count.
    //
    // And no seam round the waist. One was drawn for a while because a head-on
    // photograph shows a horizontal line, and it cut every lune in half — a
    // seam that bounds no panel, which is how the user spotted it.
    const { equator, meridians } = BASKETBALL;
    expect(equator).toBe(false);
    expect(meridians).toHaveLength(4);
    const gaps = meridians.slice(1).map((m, i) => m - meridians[i]);
    for (const g of gaps) expect(g).toBeCloseTo(45, 6);
  });

  it('shows three seams and hides the fourth under the rim', () => {
    // A meridian at longitude phi bulges R*|cos phi| from the centre line, phi
    // measured from the view axis. At 0 it lies in the screen plane, so it
    // projects onto the silhouette and the outline swallows it. The other three
    // — the line down the middle and the oval's two sides — bow well inside.
    const bows = buildSeams()
      .map(d => Math.max(...pathPoints(d).map(p => R - fromCentre(p))))
      .sort((a, b) => a - b);
    expect(bows).toHaveLength(4);
    expect(bows[0]).toBeLessThan(1); // under the rim stroke
    for (const b of bows.slice(1)) expect(b).toBeGreaterThan(10);
  });

  it('puts the two bulges at cos 45 degrees of the radius', () => {
    const turn = (0.22 * 180) / Math.PI;
    const bulges = BASKETBALL.meridians
      .map(m => Math.abs(Math.cos(((m - turn) * Math.PI) / 180)))
      .sort((a, b) => a - b);
    expect(bulges[0]).toBeCloseTo(0, 2);
    expect(bulges[1]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(bulges[2]).toBeCloseTo(Math.SQRT1_2, 2);
    expect(bulges[3]).toBeCloseTo(1, 2);
  });

  it('draws each icosahedron edge once, not once per adjoining face', () => {
    // Thirty edges, of which the visible ones are drawn; doubling them up would
    // darken every shared edge and show as an inconsistent line weight.
    expect(buildEdges().length).toBeLessThanOrEqual(30);
  });
});

describe('the two-tone panels', () => {
  const panels = buildPanels();
  const colourOf = sector => panels.find(p => p.sector === sector)?.white;

  it('alternates around the ball', () => {
    for (let i = 0; i < 8; i += 1) {
      const a = colourOf(i);
      const b = colourOf((i + 1) % 8);
      if (a === undefined || b === undefined) continue; // round the back
      expect(a).not.toBe(b);
    }
  });

  it('runs each lune pole to pole as one piece', () => {
    // The first draft split every lune at an equator and checkerboarded the
    // halves. There is no equator now, so a sector is one panel, not two.
    const sectors = panels.map(p => p.sector);
    expect(new Set(sectors).size).toBe(sectors.length);
  });

  it('looks the same turned half a revolution', () => {
    // Sector i and sector i+4 are the same lune seen from the other side, so
    // they must match. With six lunes they would be i and i+3 and would not.
    for (let i = 0; i < 8; i += 1) {
      const a = colourOf(i);
      const b = colourOf((i + 4) % 8);
      if (a !== undefined && b !== undefined) expect(a).toBe(b);
    }
  });

  it('keeps every panel inside the circle, like everything else on the ball', () => {
    for (const p of panels) {
      for (const q of pointsOf(p.points)) expect(fromCentre(q)).toBeLessThanOrEqual(R + 0.05);
    }
  });

  it('shows only the four lunes facing the viewer', () => {
    // Eight in all. The hidden fourth meridian IS the rim from this angle, so
    // it is also a lune boundary: four lunes are cleanly in front and four
    // cleanly behind, with nothing straddling. Eight here would mean the back
    // ones are being painted as slivers at the poles.
    expect(panels).toHaveLength(4);
  });
});
