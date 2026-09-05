// THE BALL, as geometry — a basketball and a d20 that are the same solid.
//
// ── WHY THIS IS NOT THE FIRST ATTEMPT ───────────────────────────────────────
//
// The first one drew a flat icosahedron: the outline was the convex hull of the
// projected vertices, so the silhouette was a lumpy ten-sided blob with heavy
// black lines across it, and the seams were hand-guessed bezier curves laid on
// top. It read as neither object. A basketball's single most recognisable
// property is that it is ROUND, and that draft threw it away to keep a
// polygonal outline that only said "d20" if you already knew to look.
//
// So this one inflates the die onto its own circumscribed sphere. The twenty
// faces become twenty SPHERICAL triangles that tile the ball exactly, edge to
// edge, with no gaps and no overlap: the silhouette is a true circle, and the
// faceting is still a genuine icosahedron. Both readings survive, because the
// shape really is both — a d20 is the sphere's simplest regular tiling.
//
// ── EVERYTHING CURVED IS A GREAT CIRCLE ─────────────────────────────────────
//
// Face edges and basketball seams are the same primitive: a great circle,
// sampled and cut at the horizon. That means the seams are correct at any tilt
// instead of being curves that happen to look right head-on, and it is why the
// ball can be turned without redrawing anything. A basketball's seams really
// ARE three great circles at right angles — that is what cuts a sphere into the
// eight panels a real ball has.
//
// ── AND WHY THE GEOMETRY IS A SEPARATE MODULE ───────────────────────────────
//
// So the same numbers can be rendered by React for the app and serialised to a
// standalone .svg by a script, with no chance of the preview and the shipped
// mark drifting apart. Nodes are plain {tag, attrs, kids} descriptors for that
// reason: two renderers, one source.

const norm = a => {
  const l = Math.hypot(a[0], a[1], a[2]);
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);

/** Golden ratio — the icosahedron's defining proportion. */
export const PHI = (1 + Math.sqrt(5)) / 2;

/** The twelve vertices, from three mutually perpendicular golden rectangles. */
export function icosaVertices() {
  const raw = [];
  for (const s1 of [-1, 1]) {
    for (const s2 of [-1, 1]) {
      raw.push([0, s1, s2 * PHI], [s1, s2 * PHI, 0], [s1 * PHI, 0, s2]);
    }
  }
  return raw.map(norm);
}

/** Every triple of vertices at the shortest mutual distance is a face. */
export function icosaFaces(verts) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const edge = 2 / Math.hypot(1, PHI);
  const near = (a, b) => Math.abs(d(verts[a], verts[b]) - edge) < 1e-9;
  const faces = [];
  for (let i = 0; i < verts.length; i += 1) {
    for (let j = i + 1; j < verts.length; j += 1) {
      if (!near(i, j)) continue;
      for (let k = j + 1; k < verts.length; k += 1) {
        if (near(i, k) && near(j, k)) faces.push([i, j, k]);
      }
    }
  }
  return faces;
}

/**
 * Interpolation ALONG THE SPHERE, not through it.
 *
 * The whole point of the rebuild: a straight line between two vertices cuts a
 * chord inside the ball, which is what made the first draft's silhouette sag
 * away from a circle. Spherical interpolation keeps every point on the surface.
 */
export function slerp(a, b, t) {
  const w = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  if (w < 1e-9) return a;
  const s = Math.sin(w);
  return add(mul(a, Math.sin((1 - t) * w) / s), mul(b, Math.sin(t * w) / s));
}

// ── HOW THE BALL SITS ───────────────────────────────────────────────────────
//
// Turned slightly left, and tipped only just. A photograph of a ball is taken
// with the poles on the silhouette, so the meridians meet AT the top and bottom
// edges; the first draft tipped the ball fifteen degrees and they met at a
// point inside the disc instead, which is the thing that looked wrong. The
// remaining tip is a few degrees, enough to bow the equator and keep the mark
// from reading as a flat disc, not enough to move the poles off the rim.
const TILT_X = 0.08;
const TILT_Y = 0.22;

/** Tilt then turn. Screen space afterwards: +x right, +y up, +z at the viewer. */
function view([x, y, z]) {
  const y1 = y * Math.cos(TILT_X) - z * Math.sin(TILT_X);
  const z1 = y * Math.sin(TILT_X) + z * Math.cos(TILT_X);
  return [
    x * Math.cos(TILT_Y) + z1 * Math.sin(TILT_Y),
    y1,
    -x * Math.sin(TILT_Y) + z1 * Math.cos(TILT_Y),
  ];
}

export const R = 46;
export const CX = 50;
export const CY = 50;

const project = ([x, y]) => [CX + x * R, CY - y * R];
const fmt = p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

/**
 * Push a point that has gone round the back out to the rim.
 *
 * A face straddling the horizon is half in front and half behind. Dropping it
 * leaves a bite out of the ball; drawing it whole folds the hidden half back
 * over the visible one. Flattening the hidden part onto the limb is what the
 * eye expects, because that is where the surface actually disappears.
 */
function toFront(p) {
  if (p[2] >= 0) return p;
  const l = Math.hypot(p[0], p[1]);
  return [p[0] / l, p[1] / l, 0];
}

/**
 * The die's own frame: one face turned to look straight out of the mark.
 *
 * Built from a face centroid rather than typed as Euler angles, so it stays
 * true if the tilt changes. ROLL then spins the die about the view axis to set
 * how that front triangle sits — pure taste, no geometry depends on it.
 */
const ROLL = 0.3;
function dieFrame() {
  const verts = icosaVertices();
  const c = norm(icosaFaces(verts)[0].reduce((acc, i) => add(acc, verts[i]), [0, 0, 0]));
  const u = norm(cross([0, 1, 0], c));
  const v = cross(c, u);
  const cos = Math.cos(ROLL);
  const sin = Math.sin(ROLL);
  return p => {
    const x = dot(p, u);
    const y = dot(p, v);
    return view([x * cos - y * sin, x * sin + y * cos, dot(p, c)]);
  };
}

// ── LIGHT ───────────────────────────────────────────────────────────────────
//
// One key light from the upper left, in view space, so the faceting reads as
// form instead of as a flat pattern of triangles. The die's shading and the
// sphere's shading are then the same shading, which is the trick that stops it
// looking like a decal.
const LIGHT = norm([-0.42, 0.52, 0.74]);

// THE PALETTE IS NARROW ON PURPOSE. The first pass ran the lit end up to a pale
// peach, and a sphere shaded from dark brown to cream is a wooden globe, not a
// basketball — the giveaway is that the bright faces lose their hue. Both ends
// are held at basketball orange and only the value moves, so every face is
// recognisably the same ball however it is lit.
const DEEP = [122, 42, 5];
const BRIGHT = [255, 150, 54];

const hex = c =>
  `#${c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;

function shadeOf(n) {
  const lambert = clamp01(dot(n, LIGHT));
  const t = clamp01(0.16 + 0.88 * lambert ** 0.8);
  return hex([0, 1, 2].map(i => DEEP[i] + (BRIGHT[i] - DEEP[i]) * t));
}

const EDGE_STEPS = 16;

/** The visible faces, each a spherical triangle flattened to a polygon. */
export function buildFaces() {
  const toView = dieFrame();
  const verts = icosaVertices().map(toView);
  return icosaFaces(icosaVertices())
    .map((idx, i) => {
      const p = idx.map(v => verts[v]);
      const outline = [];
      for (const [a, b] of [[p[0], p[1]], [p[1], p[2]], [p[2], p[0]]]) {
        for (let i = 0; i < EDGE_STEPS; i += 1) outline.push(slerp(a, b, i / EDGE_STEPS));
      }
      const centre = norm(add(add(p[0], p[1]), p[2]));
      return {
        i,
        idx,
        z: centre[2],
        front: Math.max(p[0][2], p[1][2], p[2][2]) > 1e-6,
        fill: shadeOf(centre),
        points: outline.map(q => fmt(project(toFront(q)))).join(' '),
        at: project(centre),
      };
    })
    .filter(f => f.front);
}

/**
 * Cut a sampled curve at the horizon and keep the near side.
 *
 * `closed` stitches the last run onto the first, because a great circle that is
 * visible where the sample list happens to start and end is one arc, not two —
 * left unstitched it shows as a hairline break at three o'clock.
 */
function frontRuns(pts, closed) {
  const runs = [];
  let run = [];
  for (const p of pts) {
    if (p[2] > 0) run.push(p);
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);
  if (closed && runs.length > 1 && pts[0][2] > 0 && pts[pts.length - 1][2] > 0) {
    const first = runs.shift();
    runs[runs.length - 1] = [...runs[runs.length - 1], ...first];
  }
  return runs.filter(r => r.length > 1).map(r => `M ${r.map(p => fmt(project(p))).join(' L ')}`);
}

/** Every icosahedron edge, once, as its front-facing run or runs. */
export function buildEdges() {
  const toView = dieFrame();
  const verts = icosaVertices().map(toView);
  const seen = new Set();
  const out = [];
  for (const f of icosaFaces(icosaVertices())) {
    for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const pts = [];
      for (let i = 0; i <= EDGE_STEPS * 2; i += 1) {
        pts.push(slerp(verts[a], verts[b], i / (EDGE_STEPS * 2)));
      }
      out.push(...frontRuns(pts, false));
    }
  }
  return out;
}

/** A whole great circle, given the normal of its plane. */
function greatCircle(n0) {
  const n = norm(n0);
  const a = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const b = cross(n, a);
  const pts = [];
  for (let i = 0; i <= 360; i += 1) {
    const t = (i * Math.PI) / 180;
    pts.push(view(add(mul(a, Math.cos(t)), mul(b, Math.sin(t)))));
  }
  return pts;
}

/**
 * THE SEAMS: four meridians through one pair of poles. No equator.
 *
 * ── WHAT THE USER SEES TURNING A REAL BALL ──────────────────────────────────
 *
 * Every seam runs pole to pole. Held with the poles at the top and bottom edge
 * you see a line straight down the middle and an oval either side of it closing
 * at those edges; turn it half round and it looks the same; look down at a pole
 * and the middle seam runs through it with the ovals coming in to meet it.
 * Nothing runs round the middle. A head-on photograph shows a horizontal line,
 * and drawing it as a great circle round the waist was wrong in a way the
 * two-tone ball made obvious: it cut every lune in half, a seam bounding no
 * panel.
 *
 * Four at 45° rather than three at 60°, because four is eight lunes, which is
 * the panel count a real ball has, and because four looks the same turned a
 * quarter as well as a half. The one lying in the screen plane projects onto
 * the silhouette and the rim swallows it, so three are seen.
 *
 * ── WHERE THE ARCS SIT ──────────────────────────────────────────────────────
 *
 * A meridian at longitude φ projects to an ellipse R tall and R·|cos φ| wide, so
 * its arc bulges exactly R·|cos φ| from the centre line. φ is measured from the
 * view axis, which the ball's own turn (TILT_Y) shifts — hence TURN added below.
 */
export function seamPaths({ equator = false, meridians = [] } = {}) {
  const out = [];
  if (equator) out.push(...frontRuns(greatCircle([0, 1, 0]), true));
  for (const deg of meridians) {
    const t = (deg * Math.PI) / 180;
    out.push(...frontRuns(greatCircle([Math.sin(t), 0, -Math.cos(t)]), true));
  }
  return out;
}

/** The ball's own turn, in degrees, so the longitudes below can be read as φ. */
const TURN = (TILT_Y * 180) / Math.PI;

/**
 * FOUR MERIDIANS AT 45°, which is the arrangement everything else falls out of.
 *
 * Three at 60° was the previous answer and it passes the head-on test — a line
 * down the middle, a bulge either side — while failing the two tests a real ball
 * passes without trying. Turn a ball with three meridians half a revolution and
 * the seams line up again but a two-tone colouring does not: six lunes, turned
 * three along, is every panel the opposite colour. And on a real ball the panel
 * left of the centre seam and the panel right of it are one white and one
 * orange, with the bulge seams marking the NEXT change — four panels showing,
 * not two.
 *
 * Four meridians fix both at once. Eight lunes alternate cleanly and come back
 * to themselves after a half turn, because four is even. And from the front the
 * fourth meridian lies in the screen plane — its plane is perpendicular to the
 * view axis — so it projects onto the rim and vanishes under the outline. The
 * picture is still the four curves a photograph shows; the ball behind the
 * picture is now the right one.
 *
 * The bulges land at R·|cos 45°| = 0.71R.
 */
export const BASKETBALL = {
  equator: false,
  meridians: [0, 45, 90, 135].map(phi => phi + TURN),
};

export function buildSeams(spec = BASKETBALL) {
  return seamPaths(spec);
}

/**
 * THE PANELS — the eight lunes the four meridians cut the ball into.
 *
 * Each runs pole to pole in one colour, and colour alternates AROUND the ball,
 * so no two lunes sharing a seam match and the ball looks the same turned half
 * or a quarter of a revolution. The first draft split every lune at an equator
 * and checkerboarded the halves; on a real two-tone ball the panel is one piece
 * from top to bottom.
 */
export function buildPanels() {
  const lons = [];
  for (const m of BASKETBALL.meridians) {
    lons.push(((m % 360) + 360) % 360, ((m + 180) % 360 + 360) % 360);
  }
  lons.sort((a, b) => a - b);

  const rad = d => (d * Math.PI) / 180;
  const onEquator = a => [Math.cos(rad(a)), 0, Math.sin(rad(a))];
  const arc = (a, b, n) => {
    const pts = [];
    for (let k = 0; k < n; k += 1) pts.push(slerp(a, b, k / n));
    return pts;
  };

  // A lune has two corners, the poles, and two edges, the meridians — but slerp
  // between antipodes is undefined, so each edge is routed via its own point on
  // the equator. Nothing is drawn there; it is only a waypoint.
  const out = [];
  lons.forEach((a1, i) => {
    const a2 = i === lons.length - 1 ? lons[0] + 360 : lons[i + 1];
    const N = [0, 1, 0];
    const S = [0, -1, 0];
    const q1 = onEquator(a1);
    const q2 = onEquator(a2);
    const edge = [
      ...arc(N, q1, 12), ...arc(q1, S, 12),
      ...arc(S, q2, 12), ...arc(q2, N, 12),
    ].map(view);
    // Judged by the lune's middle, not its outline: every lune touches both
    // poles, and the poles sit a hair in front of the rim, so "any point in
    // front" is true of all eight and paints four slivers under the rim stroke.
    if (view(onEquator((a1 + a2) / 2))[2] <= 0) return;
    out.push({
      sector: i,
      white: i % 2 === 0,
      points: edge.map(q => fmt(project(toFront(q)))).join(' '),
    });
  });
  return out;
}

// ── THE MARK ITSELF ─────────────────────────────────────────────────────────

const SEAM = '#20120A';
const node = (tag, attrs, kids) => ({ tag, attrs, kids });

/**
 * The drawing, as descriptors, back to front.
 *
 * Order matters and is the whole composition: a solid disc first so no seam
 * between spherical triangles can show the background through it, then the
 * faceting, then the seams over the top because on a real ball they are ON the
 * surface, then two unlit passes — a rim darkening and a highlight — that turn
 * twenty flat triangles into one round object.
 */
export function ballMarkNodes({ seams: spec = BASKETBALL, twoTone = false } = {}) {
  const faces = buildFaces();
  const edges = buildEdges();
  const seams = buildSeams(spec);
  // White over the lit orange rather than instead of it, so a pale panel still
  // carries the same light the rest of the ball does — a flat white fill would
  // punch a hole in the sphere.
  const panels = twoTone ? buildPanels().filter(p => p.white) : [];

  return [
    node('defs', {}, [
      node('radialGradient', { id: 'ballRim', cx: '0.36', cy: '0.30', r: '0.80' }, [
        node('stop', { offset: '58%', stopColor: '#000000', stopOpacity: '0' }),
        node('stop', { offset: '100%', stopColor: '#3A1401', stopOpacity: '0.30' }),
      ]),
      node('radialGradient', { id: 'ballGloss', cx: '0.34', cy: '0.26', r: '0.42' }, [
        node('stop', { offset: '0%', stopColor: '#FFF3E0', stopOpacity: '0.20' }),
        node('stop', { offset: '100%', stopColor: '#FFF3E0', stopOpacity: '0' }),
      ]),
    ]),

    node('circle', { cx: CX, cy: CY, r: R, fill: hex(DEEP) }),

    node(
      'g',
      { stroke: 'none' },
      faces.map((f, i) => node('polygon', { key: `f${i}`, points: f.points, fill: f.fill }))
    ),

    node(
      'g',
      { fill: '#FFF6EA', fillOpacity: '0.80' },
      panels.map((p, i) => node('polygon', { key: `p${i}`, points: p.points }))
    ),

    // The facet lines. Deliberately faint: they say "faceted" without competing
    // with the seams, and at favicon size they blur into shading rather than
    // into noise.
    node(
      'g',
      {
        fill: 'none',
        stroke: '#3B1301',
        strokeWidth: '0.7',
        strokeOpacity: '0.75',
        strokeLinecap: 'round',
      },
      edges.map((d, i) => node('path', { key: `e${i}`, d }))
    ),

    node(
      'g',
      { fill: 'none', stroke: SEAM, strokeWidth: '2.6', strokeLinecap: 'round' },
      seams.map((d, i) => node('path', { key: `s${i}`, d }))
    ),

    node('circle', { cx: CX, cy: CY, r: R, fill: 'url(#ballRim)' }),
    node('circle', { cx: CX, cy: CY, r: R, fill: 'url(#ballGloss)' }),
    node('circle', { cx: CX, cy: CY, r: R, fill: 'none', stroke: SEAM, strokeWidth: '2.2' }),
  ];
}
