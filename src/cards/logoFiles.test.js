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
import { TEAMS, WNBA_TEAMS, WNBA_HISTORICAL_TEAMS, RESERVED_DEVICE_NAMES } from './teams.js';
import { LEAGUE_LOGO, LEAGUE_LOGOS } from './CardTemplate.jsx';
import { IMAGE_EXTENSIONS } from './sets.js';

const LOGO_DIR = new URL('../../public/logos/', import.meta.url);
const WNBA_LOGO_DIR = new URL('../../public/logos/WNBA/', import.meta.url);

/**
 * An image's pixel dimensions, straight out of its header. Null if the bytes
 * are not a format this knows.
 *
 * ── WHY THIS GREW PAST PNG ──────────────────────────────────────────────────
 *
 * It was `pngSize`, and that was honest while `.png` was the only extension a
 * logo path could carry. It is not any more: `assetCandidates` resolves a mark
 * under any of IMAGE_EXTENSIONS, so the user can drop `MIA.webp` and the card
 * will draw it. A guard that could only measure PNGs would then SILENTLY STOP
 * GUARDING — the aspect-ratio checks below skip what they cannot measure, so
 * the first .webp lockup would sail through the very test written to catch
 * lockups. Accepting a format and checking it have to arrive together.
 *
 * Still no dependency, for the reason the PNG version gave: every one of these
 * is a fixed-layout header a few bytes in, this suite runs in plain Node, and
 * decoding pixels is not what is being asked. Each parser is exercised against
 * a hand-built header below, so "we accept it" and "we can read it" cannot
 * drift apart either.
 */
function imageSize(buf) {
  for (const read of [pngSize, gifSize, jpegSize, webpSize, isobmffSize]) {
    const size = read(buf);
    if (size) return size;
  }
  return null;
}

/** The same, for a file on disk — which is how every guard below asks. */
const sizeOf = path => imageSize(readFileSync(path));

/** PNG: IHDR is always the first chunk, so width and height are at 16 and 20. */
function pngSize(buf) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length < 24) return null;
  if (!buf.subarray(0, 8).equals(signature)) return null;
  if (buf.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

/** GIF: the logical screen descriptor follows the six-byte signature, LITTLE-endian. */
function gifSize(buf) {
  if (buf.length < 10) return null;
  const sig = buf.subarray(0, 6).toString('latin1');
  if (sig !== 'GIF87a' && sig !== 'GIF89a') return null;
  return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
}

/**
 * JPEG: walk the marker segments to the frame header, which is the only place
 * the dimensions live.
 *
 * There is no fixed offset — an EXIF or ICC block of arbitrary length usually
 * sits in front — so the segments are stepped through by their own lengths.
 * SOF0/1/2/3, SOF5/6/7, SOF9/10/11 and SOF13/14/15 are all frame headers laid
 * out the same way; C4 (Huffman tables), C8 (reserved) and CC (arithmetic
 * coding conditioning) share the range and are NOT frames, which is the one
 * trap in this format's marker numbering.
 */
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    // Standalone markers: padding, RSTn, SOI/EOI. No length word follows.
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      i += 2;
      continue;
    }
    const length = buf.readUInt16BE(i + 2);
    const isFrame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 > buf.length) return null;
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + length;
  }
  return null;
}

/**
 * WebP: three sub-formats in one RIFF container, and they store the size
 * differently enough that each needs its own read.
 *
 *   VP8   lossy. 14-bit width and height after the 3-byte frame tag and the
 *         0x9D 0x01 0x2A start code.
 *   VP8L  lossless. One 32-bit little-endian word packing width-1 and height-1
 *         into 14 bits each.
 *   VP8X  extended (animation, alpha, ICC). 24-bit canvas width-1/height-1.
 */
function webpSize(buf) {
  if (buf.length < 30) return null;
  if (buf.subarray(0, 4).toString('latin1') !== 'RIFF') return null;
  if (buf.subarray(8, 12).toString('latin1') !== 'WEBP') return null;
  const chunk = buf.subarray(12, 16).toString('latin1');
  if (chunk === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) return null;
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (buf[20] !== 0x2f) return null;
    const bits = buf.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    return {
      width: buf.readUIntLE(24, 3) + 1,
      height: buf.readUIntLE(27, 3) + 1,
    };
  }
  return null;
}

/**
 * AVIF (and its HEIF relatives): the size is in an `ispe` box, nested four
 * levels down inside `meta`.
 *
 * SCANNED FOR RATHER THAN WALKED TO, deliberately. Walking meta -> iprp -> ipco
 * -> ispe properly means implementing enough of ISOBMFF to handle full boxes,
 * extended sizes and item property association — a real parser, for a test that
 * wants two integers. `ispe` is a four-byte type code in a container whose
 * brand has already been checked, so finding the first one and reading the two
 * words after its version/flags is reliable in practice. A file with several
 * images stores the primary item's box first, which is the one wanted here.
 */
function isobmffSize(buf) {
  if (buf.length < 16) return null;
  if (buf.subarray(4, 8).toString('latin1') !== 'ftyp') return null;
  const at = buf.indexOf('ispe', 0, 'latin1');
  if (at < 0 || at + 16 > buf.length) return null;
  return { width: buf.readUInt32BE(at + 8), height: buf.readUInt32BE(at + 12) };
}

/**
 * Every extension a logo file may be saved under, as a filename filter.
 *
 * IMAGE_EXTENSIONS is the list `assetCandidates` will actually ask for, plus
 * `.gif` — which is not on it and does not need to be, because the Comets' row
 * names HOU.gif outright and a declared spelling is always tried first. It has
 * to be listed HERE, though: this is the set of files the guards below are
 * responsible for, and leaving the one non-PNG in the directory out of it would
 * be the exact silence this widening exists to remove.
 */
const LOGO_EXTENSIONS = [...IMAGE_EXTENSIONS, '.gif'];
const isLogoFile = f => LOGO_EXTENSIONS.some(ext => f.toLowerCase().endsWith(ext));

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
  ? new Set(readdirSync(LOGO_DIR).filter(isLogoFile))
  : new Set();

// ── THE HEADER READERS THEMSELVES ───────────────────────────────────────────
//
// The guards below are only as honest as these are. A parser that quietly
// returned null for .webp would turn every .webp logo into a file the aspect
// checks skip, which is the failure this whole widening exists to prevent — and
// it would look exactly like a directory that happens to contain no .webp.
//
// Exercised against HAND-BUILT HEADERS rather than fixture files, for two
// reasons: nothing in the repo is a .webp or an .avif today (the user's are
// untracked and he swaps them as he works), and a fixture would only prove one
// encoder's output anyway. These are the byte layouts the specifications
// define, written out, so a wrong offset fails here and not silently.
describe('reading dimensions out of a header', () => {
  const size = bytes => imageSize(Buffer.from(bytes));

  it('reads a PNG', () => {
    const buf = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf);
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(4400, 16);
    buf.writeUInt32BE(2080, 20);
    expect(size(buf)).toEqual({ width: 4400, height: 2080 });
  });

  it('reads a GIF, which is little-endian where PNG is big', () => {
    // HOU.gif is the real one of these — 545x251, the Comets' wordmark. Getting
    // the endianness wrong reads it as 8706x60416 and passes the aspect check
    // by accident, which is worse than failing.
    const buf = Buffer.alloc(10);
    buf.write('GIF89a', 0, 'latin1');
    buf.writeUInt16LE(545, 6);
    buf.writeUInt16LE(251, 8);
    expect(size(buf)).toEqual({ width: 545, height: 251 });
  });

  it('reads a JPEG past a leading EXIF block, and HEIGHT comes first', () => {
    // The two traps in one test: the frame header is not at a fixed offset, and
    // the SOF stores height before width — the reverse of every other format
    // here, so a copy-paste from the PNG reader transposes every JPEG.
    const exif = Buffer.alloc(20);
    exif.writeUInt16BE(0xffe1, 0);
    exif.writeUInt16BE(18, 2); // segment length, covering the rest of `exif`
    const sof = Buffer.alloc(11);
    sof.writeUInt16BE(0xffc0, 0);
    sof.writeUInt16BE(8, 2);
    sof.writeUInt8(8, 4); // sample precision
    sof.writeUInt16BE(251, 5); // height
    sof.writeUInt16BE(545, 7); // width
    const buf = Buffer.concat([Buffer.from([0xff, 0xd8]), exif, sof]);
    expect(size(buf)).toEqual({ width: 545, height: 251 });
  });

  it('reads a JPEG whose frame marker is one of the progressive ones', () => {
    // SOF2 is what "Save for web" writes as often as SOF0, and C4/C8/CC sit in
    // the same numeric range without being frames at all.
    const buf = Buffer.alloc(13);
    buf.writeUInt16BE(0xffd8, 0);
    buf.writeUInt16BE(0xffc2, 2);
    buf.writeUInt16BE(8, 4);
    buf.writeUInt8(8, 6);
    buf.writeUInt16BE(96, 7);
    buf.writeUInt16BE(115, 9);
    expect(size(buf)).toEqual({ width: 115, height: 96 });
  });

  it('reads all three kinds of WebP, which store the size three ways', () => {
    const riff = chunk => {
      const buf = Buffer.alloc(40);
      buf.write('RIFF', 0, 'latin1');
      buf.write('WEBP', 8, 'latin1');
      buf.write(chunk, 12, 'latin1');
      return buf;
    };
    // Lossy: 14-bit fields after the start code.
    const lossy = riff('VP8 ');
    lossy[23] = 0x9d;
    lossy[24] = 0x01;
    lossy[25] = 0x2a;
    lossy.writeUInt16LE(545, 26);
    lossy.writeUInt16LE(251, 28);
    expect(size(lossy)).toEqual({ width: 545, height: 251 });

    // Lossless: one packed word, and the stored values are one LESS than the
    // real dimensions — an off-by-one that would pass every plausible aspect
    // check while being wrong on every file.
    const lossless = riff('VP8L');
    lossless[20] = 0x2f;
    lossless.writeUInt32LE((544 & 0x3fff) | ((250 & 0x3fff) << 14), 21);
    expect(size(lossless)).toEqual({ width: 545, height: 251 });

    // Extended: 24-bit canvas fields, also stored minus one.
    const extended = riff('VP8X');
    extended.writeUIntLE(544, 24, 3);
    extended.writeUIntLE(250, 27, 3);
    expect(size(extended)).toEqual({ width: 545, height: 251 });
  });

  it('reads an AVIF out of its ispe box', () => {
    const buf = Buffer.alloc(64);
    buf.writeUInt32BE(32, 0);
    buf.write('ftyp', 4, 'latin1');
    buf.write('avif', 8, 'latin1');
    buf.write('ispe', 32, 'latin1');
    buf.writeUInt32BE(0, 36); // version and flags
    buf.writeUInt32BE(545, 40);
    buf.writeUInt32BE(251, 44);
    expect(size(buf)).toEqual({ width: 545, height: 251 });
  });

  it('returns null rather than a number for bytes it cannot read', () => {
    // The contract the guards depend on: an unreadable file is REPORTED, and
    // the first test in the next block is what reports it.
    expect(size(Buffer.from('this is not an image at all'))).toBeNull();
    expect(size(Buffer.alloc(0))).toBeNull();
    // A PDF, which the user does have lying around in art folders.
    expect(size(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n'))).toBeNull();
  });
});

describe('logo files', () => {
  it('reads every file in the directory, in whatever format it was saved', () => {
    // NOT "reads as PNGs" any more, and the difference is the point: a logo may
    // now be any of the formats a card can draw, so a file this cannot measure
    // is a hole in the aspect guard below rather than a file to skip.
    expect(present.size).toBeGreaterThan(0);
    for (const file of present) {
      const size = sizeOf(new URL(file, LOGO_DIR));
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
      const { width, height } = sizeOf(new URL(file, LOGO_DIR));
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
    const { width, height } = sizeOf(new URL(file, LOGO_DIR));
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
const wnbaPresent = existsSync(WNBA_LOGO_DIR)
  ? new Set(readdirSync(WNBA_LOGO_DIR).filter(isLogoFile))
  : new Set();

/**
 * Files in that directory that no WNBA_TEAMS row points at, and why each is
 * allowed to sit there unreferenced.
 *
 *   CLE.png      ⚠ NOT the Cleveland Rockers, whatever its filename suggests.
 *                The user has stated it is the 2028 CLEVELAND SIRENS — the
 *                incoming expansion team — so nothing may point at it, and the
 *                Rockers row in WNBA_HISTORICAL_TEAMS deliberately carries
 *                `logo: null` and asks for a real mark instead. Pinned below.
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
// Files that exist on purpose and that nothing points at.
//
// The first four are league and franchise marks kept for the lettered-circle
// fallback and for CON's Windows-device-name problem. The rest are RETRO AND
// ALTERNATE marks — throwback jerseys and secondary logos, not eras. They
// arrived with the era logos and were installed alongside them; assigning one
// to an era key would be a guess (NYLRetro1 is the Liberty torch shield, which
// could be the 1997 mark or the 2003 one, and both keys are empty), and a
// wrong mark on a card is worse than a lettered circle.
const UNREFERENCED = new Set([
  'CLE.png', 'TOR.png', 'WNBA.png', 'CON.png',
  'ConnRetro1.png', 'MINRetro1.png', 'MinRetro2.png', 'NYLRetro1.png',
  'PHORetro1.png', 'PHORetro2.png', 'SEARetro1.png', 'TOR_ALT.png',
]);

/**
 * Every logo path the app can build, live and historical.
 *
 * WNBA_HISTORICAL_TEAMS is checked ALONGSIDE the live table rather than
 * separately, because the failure is the same one: a path with no file behind
 * it draws a lettered circle on a card that was supposed to have a mark. What
 * differs is that a historical row is ALLOWED to have no path at all — most of
 * these franchises have no mark yet and the lettered circle is the correct
 * placeholder — so the null case is a pass here and a failure there.
 */
const HISTORICAL_WITH_LOGOS = Object.entries(WNBA_HISTORICAL_TEAMS).filter(
  ([, team]) => team.logo
);

describe('WNBA logo files', () => {
  it('has a real image file behind every franchise in the table', () => {
    const missing = [];
    for (const [abbr, team] of Object.entries(WNBA_TEAMS)) {
      const file = team.logo?.split('/').pop();
      if (!file || !wnbaPresent.has(file)) {
        missing.push(`${abbr} -> ${team.logo}`);
        continue;
      }
      const size = sizeOf(new URL(encodeURIComponent(file), WNBA_LOGO_DIR));
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
      const { width, height } = sizeOf(new URL(encodeURIComponent(file), WNBA_LOGO_DIR));
      const aspect = Math.max(width / height, height / width);
      if (aspect > MAX_TEAM_ASPECT) offenders.push(`${abbr} ${width}x${height}`);
    }
    expect(offenders).toEqual([]);
  });

  it('accounts for every file in the directory, referenced or not', () => {
    // A file nobody points at is fine and a path with no file is not, so the
    // two sets are checked against each other rather than the directory being
    // trusted. HOU.gif left this list when the Comets got a historical row.
    const referenced = new Set(
      [...Object.values(WNBA_TEAMS), ...Object.values(WNBA_HISTORICAL_TEAMS)]
        .filter(t => t.logo)
        .map(t => t.logo.split('/').pop())
    );
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
    const { width, height } = sizeOf(new URL(file, WNBA_LOGO_DIR));
    expect(width / height).toBeLessThan(0.6);
  });
});

/**
 * The historical WNBA rows, whose logo situation is deliberately different.
 *
 * Most of them have NO mark and must not pretend to: `logo: null` draws
 * CardTemplate's lettered circle, which reads "SAS" on a Becky Hammon card and
 * is exactly the right placeholder until a real Silver Stars mark arrives. What
 * IS checked is that every path which does exist resolves to a real file, and
 * that a prior era of a live franchise says so.
 */
describe('WNBA historical logo files', () => {
  it('has a real file behind every historical path that exists', () => {
    const missing = [];
    for (const [key, team] of HISTORICAL_WITH_LOGOS) {
      const file = team.logo.split('/').pop();
      if (!wnbaPresent.has(file)) missing.push(`${key} -> ${team.logo}`);
    }
    expect(missing).toEqual([]);
  });

  it('lets a defunct franchise have no mark at all, and draws a circle instead', () => {
    // A FEATURE, not a gap: a row with `logo: null` degrades to three letters
    // rather than borrowing the wrong mark, and the generator reports the
    // shopping list on every run. As of 2026-09-06 the list is EMPTY — the
    // user supplied every historical mark (Sol was the last) — so the check is
    // that any row without a file says so honestly, not that one exists.
    const withoutLogos = Object.entries(WNBA_HISTORICAL_TEAMS).filter(([, t]) => !t.logo);
    for (const [key, team] of withoutLogos) {
      expect(team.logo, key).toBeNull();
    }
    expect(withoutLogos.map(([k]) => k)).toEqual([]);
  });

  it('carries logoEra exactly when the mark is borrowed from the live team', () => {
    // `logoEra` is not decoration: it is the flag that tells the shopping list
    // a mark is legible and correct as to franchise but WRONG AS TO YEAR. A
    // row earns it precisely when it has no file of its own and points at the
    // living franchise's current mark, so the two facts must never drift
    // apart -- a row with its own era mark that still claimed a logoEra would
    // keep asking to be replaced forever, and a row still borrowing that
    // dropped the flag would silently pass as era-correct.
    const liveFiles = new Set(
      Object.values(WNBA_TEAMS)
        .map(t => t.logo)
        .filter(Boolean)
    );
    for (const [key, team] of HISTORICAL_WITH_LOGOS) {
      expect(Boolean(team.logoEra), `${key} -> ${team.logo}`).toBe(liveFiles.has(team.logo));
    }
    // The eight rows the finished Super Season cards actually reach for now
    // have era-correct marks of their own, named for the row so the decade is
    // legible from the filename.
    for (const key of ['SAS', 'SEA00', 'MIN99', 'MIN11', 'PHO97', 'PHO11', 'NYL12', 'CON03']) {
      expect(WNBA_HISTORICAL_TEAMS[key].logo, key).toBe(`/logos/WNBA/${key}.png`);
      expect(WNBA_HISTORICAL_TEAMS[key].logoEra, key).toBeUndefined();
    }
    // Minnesota's two are a real pair, not one file wired twice: 2011 added a
    // silver outline the 1999 mark does not have.
    expect(WNBA_HISTORICAL_TEAMS.MIN99.logo).not.toBe(WNBA_HISTORICAL_TEAMS.MIN11.logo);
  });

  it('never points the Rockers at the file that is actually the Sirens', () => {
    // ⚠ public/logos/WNBA/CLE.png is the 2028 Cleveland Sirens, per the user.
    // The Rockers folded in 2003 and share nothing with that franchise but a
    // city, so wiring the row to it would print the wrong team's mark on a
    // twenty-five-year-old card and look entirely plausible.
    expect(WNBA_HISTORICAL_TEAMS.CLE.name).toBe('Rockers');
    // Since 2026-09-06 the row carries the 1997 Rockers mark the user dropped in
    // (logo-originals/WNBA/CLE97.gif → CLE97.png); the Sirens file stays unreferenced.
    expect(WNBA_HISTORICAL_TEAMS.CLE.logo).toBe('/logos/WNBA/CLE97.png');
    expect(UNREFERENCED.has('CLE.png')).toBe(true);
  });

  it('keeps every historical path URL-safe too', () => {
    for (const [key, team] of HISTORICAL_WITH_LOGOS) {
      const file = team.logo.split('/').pop();
      expect(file, key).toBe(encodeURIComponent(file));
      const stem = file.replace(/\.[^.]+$/, '').toUpperCase();
      expect(RESERVED_DEVICE_NAMES.has(stem), key).toBe(false);
    }
  });
});
