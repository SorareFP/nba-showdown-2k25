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
import { TEAMS } from './teams.js';
import { LEAGUE_LOGO } from './CardTemplate.jsx';

const LOGO_DIR = new URL('../../public/logos/', import.meta.url);

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
