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

export const TEAMS = {
  ATL: { name: 'Hawks',         city: 'Atlanta',       primary: '#E03A3E', secondary: '#C1D32F', logo: '/logos/ATL.png' },
  BOS: { name: 'Celtics',       city: 'Boston',        primary: '#007A33', secondary: '#BA9653', logo: '/logos/BOS.png' },
  BKN: { name: 'Nets',          city: 'Brooklyn',      primary: '#000000', secondary: '#FFFFFF', logo: '/logos/BKN.png' },
  CHA: { name: 'Hornets',       city: 'Charlotte',     primary: '#1D1160', secondary: '#00788C', logo: '/logos/CHA.png' },
  CHI: { name: 'Bulls',         city: 'Chicago',       primary: '#CE1141', secondary: '#000000', logo: '/logos/CHI.png' },
  CLE: { name: 'Cavaliers',     city: 'Cleveland',     primary: '#860038', secondary: '#FDBB30', logo: '/logos/CLE.png' },
  DAL: { name: 'Mavericks',     city: 'Dallas',        primary: '#00538C', secondary: '#B8C4CA', logo: '/logos/DAL.png' },
  DEN: { name: 'Nuggets',       city: 'Denver',        primary: '#0E2240', secondary: '#FEC524', logo: '/logos/DEN.png' },
  DET: { name: 'Pistons',       city: 'Detroit',       primary: '#C8102E', secondary: '#1D42BA', logo: '/logos/DET.png' },
  GSW: { name: 'Warriors',      city: 'Golden State',  primary: '#1D428A', secondary: '#FFC72C', logo: '/logos/GSW.png' },
  HOU: { name: 'Rockets',       city: 'Houston',       primary: '#CE1141', secondary: '#000000', logo: '/logos/HOU.png' },
  IND: { name: 'Pacers',        city: 'Indiana',       primary: '#002D62', secondary: '#FDBB30', logo: '/logos/IND.png' },
  LAC: { name: 'Clippers',      city: 'LA',            primary: '#C8102E', secondary: '#1D428A', logo: '/logos/LAC.png' },
  LAL: { name: 'Lakers',        city: 'Los Angeles',   primary: '#552583', secondary: '#FDB927', logo: '/logos/LAL.png' },
  MEM: { name: 'Grizzlies',     city: 'Memphis',       primary: '#5D76A9', secondary: '#12173F', logo: '/logos/MEM.png' },
  MIA: { name: 'Heat',          city: 'Miami',         primary: '#98002E', secondary: '#F9A01B', logo: '/logos/MIA.png' },
  MIL: { name: 'Bucks',         city: 'Milwaukee',     primary: '#00471B', secondary: '#EEE1C6', logo: '/logos/MIL.png' },
  MIN: { name: 'Timberwolves',  city: 'Minnesota',     primary: '#0C2340', secondary: '#236192', logo: '/logos/MIN.png' },
  NOP: { name: 'Pelicans',      city: 'New Orleans',   primary: '#0C2340', secondary: '#C8102E', logo: '/logos/NOP.png' },
  NYK: { name: 'Knicks',        city: 'New York',      primary: '#006BB6', secondary: '#F58426', logo: '/logos/NYK.png' },
  OKC: { name: 'Thunder',       city: 'Oklahoma City', primary: '#007AC1', secondary: '#EF3B24', logo: '/logos/OKC.png' },
  ORL: { name: 'Magic',         city: 'Orlando',       primary: '#0077C0', secondary: '#C4CED4', logo: '/logos/ORL.png' },
  PHI: { name: '76ers',         city: 'Philadelphia',  primary: '#006BB6', secondary: '#ED174C', logo: '/logos/PHI.png' },
  PHX: { name: 'Suns',          city: 'Phoenix',       primary: '#1D1160', secondary: '#E56020', logo: '/logos/PHX.png' },
  POR: { name: 'Trail Blazers', city: 'Portland',      primary: '#E03A3E', secondary: '#000000', logo: '/logos/POR.png' },
  SAC: { name: 'Kings',         city: 'Sacramento',    primary: '#5A2D81', secondary: '#63727A', logo: '/logos/SAC.png' },
  SAS: { name: 'Spurs',         city: 'San Antonio',   primary: '#C4CED4', secondary: '#000000', logo: '/logos/SAS.png' },
  TOR: { name: 'Raptors',       city: 'Toronto',       primary: '#CE1141', secondary: '#000000', logo: '/logos/TOR.png' },
  UTA: { name: 'Jazz',          city: 'Utah',          primary: '#002B5C', secondary: '#F9A01B', logo: '/logos/UTA.png' },
  WAS: { name: 'Wizards',       city: 'Washington',    primary: '#002B5C', secondary: '#E31837', logo: '/logos/WAS.png' },
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
