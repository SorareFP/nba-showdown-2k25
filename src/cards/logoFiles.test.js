// Geometry guard for the logo files themselves, not for the code that renders
// them (that lives in CardTemplate.test.js).
//
// ── WHY A TEST ABOUT IMAGE DIMENSIONS ───────────────────────────────────────
//
// The card draws the team logo with `object-fit: contain` into a 115x96 slot
// (.logo in CardTemplate.module.css — it was a 74px square until the sidebar
// was centred on its bar and the marks were grown to fill it). `contain` fits
// the WHOLE canvas, padding included, so what sets the mark's on-card size is
// the file's own proportions — not how much of the file the mark occupies. Two
// ways that goes wrong, both of which shipped at least once:
//
//   padding   MIA.png arrived as 4400x2080 holding a 1624x1704 mark. Correct
//             art, but `contain` scaled the 4400 down to the slot's width, so
//             the mark drew at a third of its size and looked like a smudge.
//             Trimming to the content box made it 2.6x larger with no other
//             change.
//   lockups   SAS.png and POR.png arrived as full wordmark lockups — 2.2:1 and
//             1.2:1 canvases that are mostly LETTERING. In a square slot the
//             type is unreadable at any size, and on those teams' near-black
//             fields the near-black type was invisible outright. Both were cut
//             down to their marks (the spur, the pinwheel).
//
// Aspect ratio catches the first case and the widest of the second. It cannot
// catch a lockup that happens to be squarish (POR's was 1.18:1), so this is a
// floor on quality, not a proof of it — the eye still has to look.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { TEAMS, WNBA_TEAMS, RESERVED_DEVICE_NAMES } from './teams.js';
import { LEAGUE_LOGO, LEAGUE_LOGOS } from './CardTemplate.jsx';

const LOGO_DIR = new URL('../../public/logos/', import.meta.url);
const WNBA_LOGO_DIR = new URL('../../public/logos/WNBA/', import.meta.url);

/**
 * A PNG's pixel dimensions, straight out of the IHDR header.
 *
 * The header is fixed-layout and always the first chunk, so width and height
 * are at byte offsets 16 and 20 — no decoder and no dependency needed, which
 * is the point: this suite runs in plain Node with react-dom as its heaviest
 * import, and reading two big-endian integers does not justify adding one.
 */
function pngSize(path) {
  const buf = readFileSync(path);
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/**
 * The widest a TEAM logo's canvas may be before the mark stops reading.
 *
 * The 115x96 slot bounds the two orientations on different axes — a wide canvas
 * is held by the width, a tall one by the height — but 2:1 is about the same
 * loss either way, which is why one constant still covers both: a 2:1 canvas
 * draws 115x58, three-fifths of the slot's height, and a 1:2 one draws 48x96,
 * two-fifths of its width. Past that the file is a lockup wearing a logo's
 * filename, whichever way round it is.
 */
const MAX_TEAM_ASPECT = 2;

/**
 * Team logos that are still wordmark lockups, with no mark-only file sourced
 * yet. Each one renders small and is a KNOWN outstanding item, not an accepted
 * design: delete the entry when a mark-only file replaces the lockup, and do
 * not add to it to make a newly-dropped file pass.
 *
 *   UTA  'UTAH JAZZ' set beside a basketball, 750x327 (2.29:1). The wider slot
 *        helped it more than any other file — it draws 115x50 now rather than
 *        74x32, so the wordmark is legible where it was a smear — but it is
 *        still lettering, still half the slot's height, and still mid purple on
 *        a field the set's team-overrides.json has pinned to pure black.
 */
const KNOWN_WIDE_LOCKUPS = ['UTA'];

/** Files actually present, since the user drops these in by hand. */
const present = existsSync(LOGO_DIR)
  ? new Set(readdirSync(LOGO_DIR).filter(f => f.endsWith('.png')))
  : new Set();

describe('logo files', () => {
  it('reads as PNGs with real dimensions', () => {
    expect(present.size).toBeGreaterThan(0);
    for (const file of present) {
      const size = pngSize(new URL(file, LOGO_DIR));
      expect(size, file).not.toBeNull();
      expect(size.width, file).toBeGreaterThan(0);
      expect(size.height, file).toBeGreaterThan(0);
    }
  });

  it('gives every team logo a canvas the 115x96 slot can use', () => {
    const offenders = [];
    for (const [abbr, team] of Object.entries(TEAMS)) {
      const file = team.logo?.split('/').pop();
      if (!file || !present.has(file) || KNOWN_WIDE_LOCKUPS.includes(abbr)) continue;
      const { width, height } = pngSize(new URL(file, LOGO_DIR));
      const aspect = Math.max(width / height, height / width);
      if (aspect > MAX_TEAM_ASPECT) {
        offenders.push(`${abbr} ${width}x${height} (${aspect.toFixed(2)}:1)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the exemption list from quietly growing', () => {
    // A bound, not a snapshot: the list is allowed to shrink as mark-only files
    // arrive, and adding to it has to be a deliberate edit to this assertion.
    expect(KNOWN_WIDE_LOCKUPS).toEqual(['UTA']);
  });

  it('exempts the league mark, which is drawn in a tall box of its own', () => {
    // .leagueMark is 28x63 — the shape MEASURED off the printed reference art
    // — so the NBA file is supposed to be ~0.44:1 and MAX_TEAM_ASPECT must
    // never be applied to it.
    const file = LEAGUE_LOGO.split('/').pop();
    if (!present.has(file)) return;
    const { width, height } = pngSize(new URL(file, LOGO_DIR));
    expect(width / height).toBeLessThan(0.6);
  });
});

/**
 * The WNBA's marks live in a SUBDIRECTORY, public/logos/WNBA/, and the flat
 * suite above cannot see them: it lists `*.png` at the top level, where a
 * directory named WNBA is not a match.
 *
 * Their own describe block rather than extra loops in that one, because the
 * question they answer is different. For the NBA the files are long settled and
 * what is at risk is their SHAPE; here the risk is a path in WNBA_TEAMS with no
 * file behind it, which prints a lettered circle on a card that was supposed to
 * have a mark and looks like a design decision rather than a missing asset.
 */
const wnbaPresent = existsSync(WNBA_LOGO_DIR) ? new Set(readdirSync(WNBA_LOGO_DIR)) : new Set();

/**
 * Files in that directory that no WNBA_TEAMS row points at, and why each is
 * allowed to sit there unreferenced.
 *
 *   CLE.png      Cleveland Rockers, folded 2003.
 *   HOU.gif      Houston Comets, folded 2008 — and the ONE non-PNG in the
 *                directory. It needs neither converting nor an
 *                extension-tolerant resolver, because no franchise row points
 *                at it: the WNBA has not had a Houston team since 2008. If one
 *                is ever added, this list is where the omission surfaces.
 *   TOR.png      Toronto's PRIMARY mark, and the one file here that is unused
 *                for a reason of DESIGN rather than history: it is drawn in the
 *                Tempo's own bordeaux, so on a bordeaux field it vanishes. The
 *                row points at TOR_ALT.png, the same mark in Hydrogen Blue.
 *                Kept because it is the primary and a future light-ground
 *                surface would want it.
 *   WNBA.png     The LEAGUE mark, not a team's. Checked below.
 *   CON.png      A LOCAL LEFTOVER, and the reason this list is a permitted set
 *                rather than an exact one. `CON` is a reserved Windows device
 *                name, so git cannot index that file and it is not in the
 *                repository — CONN.png is. It is harmless where it exists and
 *                absent on a fresh clone, so the assertion has to tolerate
 *                both. Safe to delete.
 */
const UNREFERENCED = new Set(['CLE.png', 'HOU.gif', 'TOR.png', 'WNBA.png', 'CON.png']);

describe('WNBA logo files', () => {
  it('has a real PNG behind every franchise in the table', () => {
    const missing = [];
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      const file = team.logo?.split('/').pop();
      if (!file || !wnbaPresent.has(file)) {
        missing.push(`${abbr} -> ${team.logo}`);
        continue;
      }
      const size = pngSize(new URL(encodeURIComponent(file), WNBA_LOGO_DIR));
      expect(size, abbr).not.toBeNull();
      expect(size.width, abbr).toBeGreaterThan(0);
    }
    expect(missing).toEqual([]);
  });

  it('gives every one of them a canvas the 115x96 slot can use', () => {
    // Same bound as the NBA marks, and no exemption list: none of these is a
    // wordmark lockup. The widest is Portland at 1.65:1.
    const offenders = [];
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      const file = team.logo.split('/').pop();
      if (!wnbaPresent.has(file)) continue;
      const { width, height } = pngSize(new URL(encodeURIComponent(file), WNBA_LOGO_DIR));
      const aspect = Math.max(width / height, height / width);
      if (aspect > MAX_TEAM_ASPECT) offenders.push(`${abbr} ${width}x${height}`);
    }
    expect(offenders).toEqual([]);
  });

  it('accounts for every file in the directory, referenced or not', () => {
    // A file nobody points at is fine and a path with no file is not, so the
    // two sets are checked against each other rather than the directory being
    // trusted. This is also where HOU.gif is on the record as deliberate.
    const referenced = new Set(Object.values(WNBA_TEAMS).map(t => t.logo.split('/').pop()));
    const unexplained = [...wnbaPresent]
      .filter(f => !referenced.has(f) && !UNREFERENCED.has(f))
      .sort();
    expect(unexplained).toEqual([]);
  });

  it('never names a logo file after a reserved Windows device', () => {
    // THE FAILURE THIS PREVENTS, which cost an afternoon once: `CON.png` is the
    // console, not a file. Windows resolves the reserved stem before the
    // extension, so Node reads the file happily (libuv skips the DOS device
    // table) and the dev server renders it, while `git add` reports "No such
    // file or directory" for a file plainly sitting in the directory — and a
    // checkout on Windows could not write it back either. Connecticut's mark is
    // CONN.png for this reason and no other.
    const offenders = [];
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      const stem = team.logo.split('/').pop().replace(/\.[^.]+$/, '').toUpperCase();
      if (RESERVED_DEVICE_NAMES.has(stem)) offenders.push(`${abbr} -> ${team.logo}`);
    }
    expect(offenders).toEqual([]);
    // And the abbreviation that forced the exception is still reserved, so
    // nobody "tidies" the filename back to matching the code.
    expect(RESERVED_DEVICE_NAMES.has('CON')).toBe(true);
    expect(WNBA_TEAMS.CON.logo).toBe('/logos/WNBA/CONN.png');
  });

  it('keeps every logo path URL-safe, so no filename needs escaping', () => {
    // The second Windows-shaped landmine in this directory, after CON.png. The
    // Tempo's alt mark was delivered as `TOR Alt.png`, and a SPACE in a path
    // has to survive the shell, git, Vite's static server and finally an <img
    // src> that is written into the DOM UN-ENCODED — four hands, any one of
    // which turns "TOR Alt.png" into a 404 or a half-quoted argument. The file
    // is TOR_ALT.png instead, and this is the rule that keeps the next drop
    // from reintroducing the class.
    //
    // Scoped to the PATHS THE APP RESOLVES rather than to the directory: a file
    // sitting there unreferenced can be named anything, because nothing ever
    // builds a URL out of it.
    const offenders = [];
    for (const [abbr, team] of Object.entries({ ...TEAMS, ...WNBA_TEAMS })) {
      if (!team.logo) continue;
      const file = team.logo.split('/').pop();
      if (file !== encodeURIComponent(file)) offenders.push(`${abbr} -> ${team.logo}`);
    }
    expect(offenders).toEqual([]);
    // And Toronto is on the alt on purpose — the primary is bordeaux on a
    // bordeaux field. Pinned so a "fix" back to {abbr}.png has to be deliberate.
    expect(WNBA_TEAMS.TOR.logo).toBe('/logos/WNBA/TOR_ALT.png');
  });

  it('gives the WNBA league mark the same tall shape as the NBA one', () => {
    // .leagueMark is one 28x63 box for both leagues, so both files have to be
    // that shape or the mark draws small in the corner of half the set.
    const file = LEAGUE_LOGOS.WNBA.split('/').pop();
    expect(wnbaPresent.has(file)).toBe(true);
    const { width, height } = pngSize(new URL(file, WNBA_LOGO_DIR));
    expect(width / height).toBeLessThan(0.6);
  });
});
