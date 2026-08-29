// Team reference data for card theming.
//
// Keyed by NBA.COM abbreviations, not Basketball-Reference's. The two sources
// disagree on exactly three teams — BKN/BRK, CHA/CHO, PHX/PHO — and card data
// flows through nba.com's roster feed, so nba.com spelling is canonical here.
// Lookups canonicalize the three Basketball-Reference spellings on the way in
// (see TEAM_ALIASES), so a record that has not been through team resolution
// still themes correctly.
//
// Logo image files are NOT in this repo — the user drops them into
// public/logos/{ABBR}.png. CardTemplate hides the <img> on a 404, so cards
// render correctly with no logo files present at all.
//
// ── WHERE THESE COLORS COME FROM ─────────────────────────────────────────────
//
// SOURCE: TruColor's NBA franchise color records, the authority the user chose:
//   https://www.trucolor.net/portfolio/national-basketball-association-official-
//   colors-franchise-records-1946-1947-through-present/
// Fetched and parsed 2026-08-29; every hex below was read off that page's
// CURRENT-era block for that franchise ("<season> through present"), never from
// an earlier era and never from memory.
//
// THE RULE: primary is the franchise's FIRST official color, secondary its
// SECOND, in the order the source lists them. Mechanical on purpose — the point
// of having an authority is not to then re-rank it by taste. Each row records
// the two official color names so any value can be checked against the page
// without re-deriving which color was meant.
//
// These are PANTONE-derived values and they are NOT the hexes that circulate on
// fan color sites (which is what this table held before, from memory: every
// team but four was wrong, and six were still on a retired identity). Expect
// them to look slightly deeper and less saturated than the familiar ones.
//
// Where the official second color makes a weak pairing for THIS design — the
// Nuggets' Flatirons Red where the eye expects Sunshine Yellow, the Thunder's
// navy behind Thunder Blue — that is the source's ordering, not an oversight.
// Tune it per team in the studio's team editor; overrides live in the set's
// team-overrides.json and never touch this file.

export const TEAMS = {
  //                                                                                                                        official color names
  ATL: { name: 'Hawks',         city: 'Atlanta',       primary: '#C8102E', secondary: '#FFC72C', logo: '/logos/ATL.png' }, // Torch Red, Legacy Yellow
  BOS: { name: 'Celtics',       city: 'Boston',        primary: '#007A33', secondary: '#FFFFFF', logo: '/logos/BOS.png' }, // Celtic Green, White
  BKN: { name: 'Nets',          city: 'Brooklyn',      primary: '#010101', secondary: '#FFFFFF', logo: '/logos/BKN.png' }, // Black, White
  CHA: { name: 'Hornets',       city: 'Charlotte',     primary: '#00778B', secondary: '#211747', logo: '/logos/CHA.png' }, // Teal, Dark Purple
  CHI: { name: 'Bulls',         city: 'Chicago',       primary: '#BA0C2F', secondary: '#010101', logo: '/logos/CHI.png' }, // Red, Black
  CLE: { name: 'Cavaliers',     city: 'Cleveland',     primary: '#6F263D', secondary: '#B9975B', logo: '/logos/CLE.png' }, // Wine, Gold
  DAL: { name: 'Mavericks',     city: 'Dallas',        primary: '#0050B5', secondary: '#0C2340', logo: '/logos/DAL.png' }, // Royal Blue, Navy
  DEN: { name: 'Nuggets',       city: 'Denver',        primary: '#0C2340', secondary: '#862633', logo: '/logos/DEN.png' }, // Midnight Blue, Flatirons Red
  DET: { name: 'Pistons',       city: 'Detroit',       primary: '#1D4289', secondary: '#C8102E', logo: '/logos/DET.png' }, // Royal Blue, Red
  GSW: { name: 'Warriors',      city: 'Golden State',  primary: '#1D4289', secondary: '#FFC72C', logo: '/logos/GSW.png' }, // Warriors Royal Blue, California Golden Yellow
  HOU: { name: 'Rockets',       city: 'Houston',       primary: '#C8102E', secondary: '#FFCD00', logo: '/logos/HOU.png' }, // Rockets Red, Championship Yellow
  IND: { name: 'Pacers',        city: 'Indiana',       primary: '#0C2340', secondary: '#FFCD00', logo: '/logos/IND.png' }, // Navy, Yellow
  LAC: { name: 'Clippers',      city: 'LA',            primary: '#0C2340', secondary: '#C8102E', logo: '/logos/LAC.png' }, // Naval Blue, Ember Red
  LAL: { name: 'Lakers',        city: 'Los Angeles',   primary: '#330072', secondary: '#FFC72C', logo: '/logos/LAL.png' }, // Royal Purple, Gold
  MEM: { name: 'Grizzlies',     city: 'Memphis',       primary: '#0C2340', secondary: '#7D9CC0', logo: '/logos/MEM.png' }, // Memphis Midnight Blue, Beale Street Blue
  MIA: { name: 'Heat',          city: 'Miami',         primary: '#010101', secondary: '#862633', logo: '/logos/MIA.png' }, // Black, Deep Red
  MIL: { name: 'Bucks',         city: 'Milwaukee',     primary: '#2C5234', secondary: '#DDCBA4', logo: '/logos/MIL.png' }, // Good Land Green, Cream City Cream
  MIN: { name: 'Timberwolves',  city: 'Minnesota',     primary: '#1D4289', secondary: '#009A44', logo: '/logos/MIN.png' }, // Blue, Green
  NOP: { name: 'Pelicans',      city: 'New Orleans',   primary: '#0C2340', secondary: '#B9975B', logo: '/logos/NOP.png' }, // Dark Blue, Gold
  NYK: { name: 'Knicks',        city: 'New York',      primary: '#1D4289', secondary: '#FF8200', logo: '/logos/NYK.png' }, // Royal Blue, Orange
  OKC: { name: 'Thunder',       city: 'Oklahoma City', primary: '#0072CE', secondary: '#041E42', logo: '/logos/OKC.png' }, // Thunder Blue, Navy
  ORL: { name: 'Magic',         city: 'Orlando',       primary: '#0050B5', secondary: '#010101', logo: '/logos/ORL.png' }, // Magic Blue, Black
  PHI: { name: '76ers',         city: 'Philadelphia',  primary: '#1D4289', secondary: '#C8102E', logo: '/logos/PHI.png' }, // Royal Blue, Red
  PHX: { name: 'Suns',          city: 'Phoenix',       primary: '#211747', secondary: '#CB6015', logo: '/logos/PHX.png' }, // Dark Purple, Burnt Orange
  POR: { name: 'Trail Blazers', city: 'Portland',      primary: '#010101', secondary: '#C8102E', logo: '/logos/POR.png' }, // Black, Red
  SAC: { name: 'Kings',         city: 'Sacramento',    primary: '#010101', secondary: '#582C83', logo: '/logos/SAC.png' }, // Black, Royal Purple
  SAS: { name: 'Spurs',         city: 'San Antonio',   primary: '#010101', secondary: '#9EA2A2', logo: '/logos/SAS.png' }, // Black, Silver
  TOR: { name: 'Raptors',       city: 'Toronto',       primary: '#BA0C2F', secondary: '#010101', logo: '/logos/TOR.png' }, // Red, Black
  UTA: { name: 'Jazz',          city: 'Utah',          primary: '#330072', secondary: '#010101', logo: '/logos/UTA.png' }, // Mountain Purple, Midnight Black
  WAS: { name: 'Wizards',       city: 'Washington',    primary: '#C8102E', secondary: '#0C2340', logo: '/logos/WAS.png' }, // Red, Navy
};

/**
 * Basketball-Reference abbreviation -> nba.com abbreviation.
 *
 * The player pool is derived from Basketball-Reference, which spells exactly
 * three teams differently. 32 of the 331 pool players carry these codes (BRK
 * 12, CHO 9, PHO 11); without this map every one of them rendered on the grey
 * fallback despite being on a perfectly ordinary team.
 *
 * Exported so scripts/cardgen/resolveTeams.js can canonicalize against the same
 * table rather than declaring its own copy — two lists of the same three pairs
 * drifting apart is a bug waiting to happen.
 */
export const TEAM_ALIASES = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' };

/**
 * The nba.com spelling of a team abbreviation.
 *
 * Own-property lookup, not `TEAM_ALIASES[abbr] ?? abbr`: the latter answers
 * `canonicalTeam('toString')` with a function off Object.prototype.
 */
export function canonicalTeam(abbr) {
  return Object.hasOwn(TEAM_ALIASES, abbr) ? TEAM_ALIASES[abbr] : abbr;
}

/**
 * Neutral theme for anything this table can't identify.
 *
 * This is load-bearing, not defensive padding: 45 players in the 2025-26 pool
 * still carry Basketball-Reference's "2TM"/"3TM" mid-season-trade aggregate
 * codes, which are not teams and have no colors or logo. A card for one of
 * those players must still render, so they get the neutral navy/silver theme
 * and no logo until a real team is resolved for them — and looking unstyled is
 * the correct signal for data that is genuinely wrong, which is why the aliases
 * above deliberately do not try to rescue "2TM"/"3TM" as well.
 */
const FALLBACK = { name: 'Unknown', city: '', primary: '#1B2A4A', secondary: '#C0C0C0', logo: null };

/** Team record for an abbreviation, or a neutral fallback so cards still render. */
export function getTeam(abbr) {
  return TEAMS[canonicalTeam(abbr)] ?? FALLBACK;
}

/**
 * Team record with any studio overrides applied.
 *
 * Overrides live in card-art/team-overrides.json and let colors be tuned per
 * team without editing this file. `overrides` is the whole map keyed by
 * abbreviation; only the fields it names are replaced.
 *
 * The override key is canonicalized too, so a tuned "BKN" reaches the pool's
 * "BRK" players — otherwise they would get the Nets' stock colors while every
 * other Net got the tuned ones.
 */
export function getThemedTeam(abbr, overrides = {}) {
  const canonical = canonicalTeam(abbr);
  return { ...getTeam(canonical), ...(overrides?.[canonical] ?? {}) };
}
