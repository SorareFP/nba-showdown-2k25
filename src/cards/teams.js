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
 * ── FRANCHISES THAT NO LONGER EXIST ─────────────────────────────────────────
 *
 * Kevin Durant's rookie season was played for the SEATTLE SUPERSONICS, and the
 * Rookie and Super Season sets are made of seasons exactly like it. Those cards
 * have to say SEA.
 *
 * TWO OPTIONS WERE AVAILABLE and this is the one taken: extend the table, do
 * not map to the successor franchise. Mapping Durant's 2008 card to OKC would
 * be a factual error printed on the card, and design philosophy point 9 is
 * explicit that the historical layer exists so peak seasons can be asked about
 * as themselves. The cost of extending is only the logo, and a missing logo
 * already degrades to the lettered circle (see TeamLogo) — which reads "SEA"
 * and is exactly right.
 *
 * SEPARATE FROM `TEAMS`, NOT MERGED INTO IT, for two reasons. `TEAMS` is
 * "the thirty franchises playing today" — the team editor enumerates it, the
 * logo test requires a file for every row, and the studio's colour work is
 * against live teams. And CHARLOTTE COLLIDES: Basketball-Reference spells the
 * 2005-2014 Bobcats "CHA" and the 2015-present Hornets "CHO", while nba.com
 * spells today's Hornets "CHA". One abbreviation, two franchises, so the
 * Bobcats get a synthetic key and `franchiseForSeason` is what tells them
 * apart — by SEASON, the only thing that actually distinguishes them.
 *
 * ⚠ THE COLOURS HERE ARE NOT FROM TruColor. Every hex in `TEAMS` was read off
 * the franchise-records page the user chose as the authority; these were
 * written from general knowledge, because the point of the exercise was to stop
 * historical cards falling back to neutral grey today rather than to get the
 * 1997 Nets' Pantone right. They are marked so they can be corrected against
 * the same source when the set is finalised.
 */
export const HISTORICAL_TEAMS = {
  SEA: { name: 'SuperSonics', city: 'Seattle',     primary: '#00653A', secondary: '#FFC72C', logo: null, era: '1967-2008', unverifiedColors: true },
  NJN: { name: 'Nets',        city: 'New Jersey',  primary: '#002A60', secondary: '#CE1141', logo: null, era: '1977-2012', unverifiedColors: true },
  NOH: { name: 'Hornets',     city: 'New Orleans', primary: '#002B5C', secondary: '#B4975A', logo: null, era: '2002-2013', unverifiedColors: true },
  NOK: { name: 'Hornets',     city: 'New Orleans/Oklahoma City', primary: '#002B5C', secondary: '#B4975A', logo: null, era: '2005-2007', unverifiedColors: true },
  CHH: { name: 'Hornets',     city: 'Charlotte',   primary: '#00778B', secondary: '#280071', logo: null, era: '1988-2002', unverifiedColors: true },
  CHB: { name: 'Bobcats',     city: 'Charlotte',   primary: '#F9423A', secondary: '#004071', logo: null, era: '2004-2014', unverifiedColors: true },
  VAN: { name: 'Grizzlies',   city: 'Vancouver',   primary: '#00B2A9', secondary: '#BC7844', logo: null, era: '1995-2001', unverifiedColors: true },
};

/**
 * The last season (as an END year) Basketball-Reference's "CHA" meant the
 * Bobcats. From 2015 it means nothing — that franchise is "CHO" there — and
 * nba.com's "CHA" is today's Hornets.
 */
const LAST_BOBCATS_SEASON = 2014;

/**
 * The franchise key for an abbreviation AS OF a season.
 *
 * Only one abbreviation is genuinely ambiguous, and this exists for it: see
 * HISTORICAL_TEAMS. Everything else is the ordinary canonicalization, so a
 * caller with a season in hand can always route through here.
 *
 * A missing or non-numeric season means "today", which keeps every existing
 * caller's behaviour if one ever passes through this by mistake.
 */
export function franchiseForSeason(abbr, season) {
  const raw = String(abbr ?? '').toUpperCase();
  if (raw === 'CHA' && Number.isFinite(season) && season <= LAST_BOBCATS_SEASON) return 'CHB';
  return canonicalTeam(raw);
}

/**
 * Basketball-Reference abbreviation -> nba.com abbreviation.
 *
 * The player pool is derived from Basketball-Reference, which spells exactly
 * three teams differently. 33 of the 350 pool players carry these codes (BRK
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

/**
 * Team record for an abbreviation, or a neutral fallback so cards still render.
 *
 * Current franchises first, then the defunct ones. The order is not arbitrary:
 * every key in HISTORICAL_TEAMS is one that TEAMS does not have (Charlotte's
 * collision is resolved by franchiseForSeason before it ever reaches here), so
 * the fallthrough can only ever add teams, never shadow a live one.
 */
export function getTeam(abbr) {
  const key = canonicalTeam(abbr);
  if (Object.hasOwn(TEAMS, key)) return TEAMS[key];
  if (Object.hasOwn(HISTORICAL_TEAMS, key)) return HISTORICAL_TEAMS[key];
  return FALLBACK;
}

/**
 * Team record with any studio overrides applied.
 *
 * Overrides live in the set's team-overrides.json (src/cards/sets.js) and let
 * colors be tuned per team without editing this file. `overrides` is the whole
 * map keyed by abbreviation; only the fields it names are replaced.
 *
 * The override key is canonicalized too, so a tuned "BKN" reaches the pool's
 * "BRK" players — otherwise they would get the Nets' stock colors while every
 * other Net got the tuned ones.
 *
 * BLANK VALUES ARE IGNORED rather than applied. The editor writes this file
 * live, character by character, out of text fields: an in-progress `""` in the
 * hex box must not blank a team's primary color on every card at once. A field
 * the user has actually cleared is removed from the override, not emptied.
 *
 * `accent` may appear here even though no TEAMS row carries one — see
 * resolveAccent. That is the point of the field: it is normally computed, and
 * an override is how a team stops computing it.
 */
export function getThemedTeam(abbr, overrides = {}) {
  const canonical = canonicalTeam(abbr);
  const base = getTeam(canonical);
  const override = overrides?.[canonical];
  if (!override || typeof override !== 'object') return { ...base };

  const applied = {};
  for (const [field, value] of Object.entries(override)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (value == null) continue;
    applied[field] = value;
  }
  return { ...base, ...applied };
}

// ── The third color ─────────────────────────────────────────────────────────
//
// A card is themed from THREE values, but a team only has two official ones.
// The third — the accent, used for team-tinted text and hairlines — is derived
// from the pair by pickAccent below, and derivation is exactly why an override
// for it has to exist.
//
// The problem in one team: Denver's official second color is Flatirons Red,
// not the gold everyone pictures. Faithful to the source, and pickAccent then
// finds neither Midnight Blue nor Flatirons Red bright enough to read on the
// card's navy field, so the Nuggets' accent falls back to cream and the card
// has no gold anywhere. Fifteen of the thirty teams reach that same fallback,
// because so many official second colors are black or navy. Fixing that by
// editing TEAMS would mean writing an unofficial color into a file whose whole
// job is to record the official ones — hence: override the accent directly.

/** Perceptual luminance of a #rrggbb color, 0 (black) to 1 (white). */
function luminance(hex) {
  if (typeof hex !== 'string' || !/^#[0-9A-Fa-f]{6}$/.test(hex)) return 0;
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(c => c / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The threshold is set where it is because it is the lowest value that clears
 * the two teams whose brighter color is still a mid-tone blue on a navy field
 * (Timberwolves #236192, Hornets #00788C) while keeping the ones that read
 * fine (Thunder #007AC1, Grizzlies #5D76A9). The printed Timberwolves card
 * uses cream for exactly this reason.
 */
const MIN_ACCENT_LUMINANCE = 0.38;

/** The neutral off-white a team falls back to when both its colors are dark. */
export const ACCENT_FALLBACK = '#E6ECF8';

/**
 * Picks the color used for team-tinted TEXT on the card's navy field.
 *
 * Neither brand color is safe to use blind: nine teams (Bulls, Rockets,
 * Spurs, Raptors, Trail Blazers, Nets...) carry #010101 as one of their two
 * colors, and black text on a navy card is invisible. So take the brighter of
 * the pair, and if even that is too dark to read, fall back to a neutral
 * off-white. Decorative fills still use the raw brand colors — only text and
 * hairlines route through here.
 */
export function pickAccent(primary, secondary) {
  const brighter = luminance(secondary) > luminance(primary) ? secondary : primary;
  return luminance(brighter) < MIN_ACCENT_LUMINANCE ? ACCENT_FALLBACK : brighter;
}

/**
 * The accent a themed team actually renders with: the explicit override when
 * there is one, the computed pick when there is not.
 *
 * Deliberately NOT folded into getThemedTeam's return value. An absent accent
 * has to stay absent in the merged record, because that is what distinguishes
 * "this team is following the computation" from "this team's accent was
 * chosen" — and only the second should survive into team-overrides.json. Bake
 * the computed value into the record and every team the editor touches would
 * silently freeze its accent at whatever pickAccent happened to return.
 */
export function resolveAccent(team) {
  const explicit = team?.accent;
  if (typeof explicit === 'string' && explicit.trim()) return explicit.trim();
  return pickAccent(team?.primary, team?.secondary);
}
