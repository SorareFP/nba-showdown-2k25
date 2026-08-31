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
// public/logos/{ABBR}.png. CardTemplate swaps in a lettered circle when there
// is no file, so cards render correctly with no logo files present at all.
//
// THE `.png` IN EACH ROW BELOW IS THE SPELLING TRIED FIRST, not a requirement:
// `assetCandidates` in CardTemplate.jsx retries the same stem under every
// format in IMAGE_EXTENSIONS, so a mark saved as .webp resolves without this
// table being edited. A row is still free to name a different extension
// outright, and one does — the Houston Comets' HOU.gif.
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
 * ── THE WNBA ────────────────────────────────────────────────────────────────
 *
 * A THIRD TABLE, not rows added to `TEAMS`, and the reason is the same one that
 * kept HISTORICAL_TEAMS separate: `TEAMS` means "the thirty NBA franchises
 * playing today". The team-colour editor enumerates it, and logoFiles.test.js
 * RESOLVES EVERY ROW IN IT AGAINST public/logos/ — a flat directory of NBA
 * marks — so a WNBA row merged in there would be looked for in the wrong
 * place, and on the nine colliding abbreviations below it would silently find
 * the NBA team's file and pass.
 *
 * FIFTEEN TEAMS, NOT THIRTEEN. Golden State joined in 2025 and Portland and
 * Toronto in 2026, so a table written from a 2024 memory is two franchises
 * short — which would have put every Fire and Tempo player on the neutral grey
 * fallback. The list below is derived from the teams actually appearing in
 * Basketball-Reference's 2026 WNBA table, not from recall.
 *
 * Keyed by Basketball-Reference's own WNBA abbreviations, which is what the
 * generated cards carry. Note LVA (not LV), NYL (not NY), GSV, PHO — spelled as
 * the source spells them, so there is nothing to canonicalize.
 *
 * ── THE COLOURS ARE VERIFIED ────────────────────────────────────────────────
 *
 * Read off TruColor's WNBA franchise-records page, the counterpart of the NBA
 * page every hex in `TEAMS` was corrected against:
 *
 *   https://www.trucolor.net/portfolio/womens-national-basketball-association-official-colors-1997-through-present/
 *
 * SAME MECHANICAL RULE AS THE NBA TABLE: take the franchise's CURRENT era —
 * the "through present" block, which is the first one the page lists — and use
 * its official colours #1 and #2 as primary and secondary. No judgement is
 * applied on top of that ordering, which is the point of having a rule; where
 * it lands somewhere surprising the row says so rather than being quietly
 * "fixed". So `unverifiedColors` is absent here, unlike HISTORICAL_TEAMS.
 *
 * Three franchises are on a current era that did not exist a season ago and
 * that recall would get wrong, which is most of the argument for the rule:
 * PHOENIX REBRANDED FOR 2026 (purple/orange, replacing the 2015-2025
 * dark-purple and burnt-orange), and Portland and Toronto are 2026 expansion
 * franchises with no prior identity at all — Portland's is PINK, not the red a
 * guess would reach for.
 *
 * ⚠ PORTLAND FIRE APPEARS TWICE ON THAT PAGE — "(2026 through present)" and a
 * dead "(2000 through 2002)" franchise of the same name in the same city. Only
 * the current one is a WNBA team today, and it is the one taken here. Anyone
 * re-scraping the page must filter on "through present" or they will card the
 * 2026 Fire in a defunct team's red-and-black.
 *
 * ── LOGOS ───────────────────────────────────────────────────────────────────
 *
 * Supplied by the user, under public/logos/WNBA/ — their OWN directory, so a
 * WNBA "PHO" can never collide with the NBA's Phoenix file. A missing file
 * still degrades to CardTemplate's lettered circle rather than a broken image.
 *
 * That directory holds files no row BELOW points at, and they are not
 * oversights. `TOR.png` is Toronto's PRIMARY mark, superseded here by the alt
 * (see the row). The other two are defunct franchises with no 2026 row to
 * attach to, and BOTH have since been settled by WNBA_HISTORICAL_TEAMS further
 * down rather than by this table:
 *
 *   HOU.gif   THE HOUSTON COMETS, and now referenced — by the historical
 *             table, which is the only place a franchise that folded in 2008
 *             can live. It is the one non-PNG in the directory, which is why
 *             logoFiles.test.js measures the historical rows with a
 *             format-aware reader rather than its PNG-only one.
 *   CLE.png   NOT the Cleveland Rockers. ⚠ The user has stated this file is the
 *             2028 CLEVELAND SIRENS — the incoming expansion team — so it is
 *             wrong for any historical use, and the Rockers row deliberately
 *             carries `logo: null` and asks for a real mark. This note replaces
 *             an earlier one here that called it the Rockers.
 *
 * logoFiles.test.js pins every one of these so a future Houston row cannot
 * quietly 404 and the Sirens file cannot quietly become the Rockers.
 *
 * ⚠ TORONTO IS THE ONE ROW NOT ON ITS `{abbr}.png`, and the reason is contrast,
 * not Windows. The Tempo's primary mark is drawn in the team's OWN bordeaux, so
 * on a bordeaux field it disappears — the mark and the ground are the same
 * colour. The alt is the same mark in Hydrogen Blue on a bordeaux plaque, which
 * separates. The file was delivered as `TOR Alt.png`; it is `TOR_ALT.png` here
 * because a SPACE in a filename has to survive the shell, git, Vite's static
 * server and a URL that reaches the browser un-encoded, and one of those four
 * eventually gets it wrong. Renaming costs nothing and removes the class.
 *
 * ⚠ CONNECTICUT'S FILE IS `CONN.png`, BREAKING THE {abbr}.png RULE, because
 * Windows will not let it be anything else. `CON` is a RESERVED DOS DEVICE
 * NAME — the console — and Windows resolves it before the extension, so
 * `CON.png` names the console rather than a file. Node happens to read it
 * (libuv opens paths through a route that skips the DOS device table), which is
 * why it renders perfectly in the dev server, but git cannot: `git add` reports
 * "No such file or directory" for a file that is plainly sitting there, and a
 * `git checkout` on Windows could not write it back even if it were committed.
 * So the file is CONN.png and this row says so. See RESERVED_DEVICE_NAMES.
 */

/**
 * Names Windows reserves for devices, which therefore cannot be filenames —
 * with or without an extension, since the reservation is on the stem.
 *
 * Here so logoFiles.test.js can refuse a NEW one rather than leaving the next
 * person to rediscover it through a `git add` that fails with a message about
 * a file that is visibly present. AUX and PRN are the ones to watch: neither is
 * a team code today, and both are three letters.
 */
export const RESERVED_DEVICE_NAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);
export const WNBA_TEAMS = {
  ATL: { name: 'Dream',     city: 'Atlanta',      primary: '#C8102E', secondary: '#373A36', logo: '/logos/WNBA/ATL.png', league: 'WNBA' }, // Red, Dark Gray
  CHI: { name: 'Sky',       city: 'Chicago',      primary: '#418FDE', secondary: '#FFCD00', logo: '/logos/WNBA/CHI.png', league: 'WNBA' }, // Sky Blue, Radiant Yellow
  // CONN, not CON — see RESERVED_DEVICE_NAMES below. The one row where the
  // file's name is not simply the abbreviation, and it is not a style choice.
  CON: { name: 'Sun',       city: 'Connecticut',  primary: '#FC4C02', secondary: '#0C2340', logo: '/logos/WNBA/CONN.png', league: 'WNBA' }, // Orange, Navy
  DAL: { name: 'Wings',     city: 'Dallas',       primary: '#C4D600', secondary: '#0C2340', logo: '/logos/WNBA/DAL.png', league: 'WNBA' }, // Lime Green, Navy
  GSV: { name: 'Valkyries', city: 'Golden State', primary: '#010101', secondary: '#AD96DC', logo: '/logos/WNBA/GSV.png', league: 'WNBA' }, // Black, Valkyrie Violet
  IND: { name: 'Fever',     city: 'Indiana',      primary: '#041E42', secondary: '#C8102E', logo: '/logos/WNBA/IND.png', league: 'WNBA' }, // Navy, Red
  LAS: { name: 'Sparks',    city: 'Los Angeles',  primary: '#702F8A', secondary: '#FFC72C', logo: '/logos/WNBA/LAS.png', league: 'WNBA' }, // Purple, Gold
  LVA: { name: 'Aces',      city: 'Las Vegas',    primary: '#010101', secondary: '#A7A8A9', logo: '/logos/WNBA/LVA.png', league: 'WNBA' }, // Black, Silver
  MIN: { name: 'Lynx',      city: 'Minnesota',    primary: '#236192', secondary: '#0C2340', logo: '/logos/WNBA/MIN.png', league: 'WNBA' }, // Lake Blue, Midnight Blue
  NYL: { name: 'Liberty',   city: 'New York',     primary: '#010101', secondary: '#6ECEB2', logo: '/logos/WNBA/NYL.png', league: 'WNBA' }, // Black, Seafoam Green
  PHO: { name: 'Mercury',   city: 'Phoenix',      primary: '#582C83', secondary: '#FC4C02', logo: '/logos/WNBA/PHO.png', league: 'WNBA' }, // Purple, Orange (2026 rebrand)
  POR: { name: 'Fire',      city: 'Portland',     primary: '#E93CAC', secondary: '#C8102E', logo: '/logos/WNBA/POR.png', league: 'WNBA' }, // Pink, Red
  SEA: { name: 'Storm',     city: 'Seattle',      primary: '#2C5234', secondary: '#FBE122', logo: '/logos/WNBA/SEA.png', league: 'WNBA' }, // Storm Green, Lightning Yellow
  TOR: { name: 'Tempo',     city: 'Toronto',      primary: '#612C51', secondary: '#B8CCEA', logo: '/logos/WNBA/TOR_ALT.png', league: 'WNBA' }, // Bordeaux, Hydrogen Blue — ALT mark: the primary is bordeaux-on-bordeaux
  WAS: { name: 'Mystics',   city: 'Washington',   primary: '#C8102E', secondary: '#0C2340', logo: '/logos/WNBA/WAS.png', league: 'WNBA' }, // Red, Navy
};

/**
 * ── THE WNBA BEFORE NOW ─────────────────────────────────────────────────────
 *
 * WNBA_TEAMS is "the fifteen franchises playing in 2026", exactly as `TEAMS` is
 * "the thirty NBA franchises playing today". The legends set
 * (WNBA_SUPER_SEASON_SET) reaches back to 1997, and almost nothing about the
 * league it reaches into is in that table:
 *
 *   ELEVEN FRANCHISES NO LONGER EXIST or no longer exist THERE. The Houston
 *   Comets won the league's first four titles and folded in 2008; the Detroit
 *   Shock won three and are now the Dallas Wings by way of Tulsa; the Utah
 *   Starzz are the Aces by way of San Antonio. None of them has a 2026 row to
 *   attach to.
 *
 *   AND THE SURVIVORS DID NOT LOOK LIKE THIS. This is the half that would have
 *   been missed by anyone checking only for missing teams: the SEATTLE STORM
 *   played 2000-2015 in HUNTER GREEN AND MAROON, not the Storm Green and
 *   Lightning Yellow of the current row — so Lauren Jackson's and Sue Bird's
 *   peak seasons are in colours the live table does not contain. The Mercury
 *   have had four identities, the Liberty four, the Lynx three, the Sun three,
 *   the Mystics two, the Dream three, the Aces two.
 *
 * So a card that names a season has to resolve its franchise BY SEASON, and
 * `wnbaFranchiseForSeason` is what does it — the exact counterpart of the NBA's
 * `franchiseForSeason`, which exists because "CHA" meant two different teams.
 *
 * ── THE COLOURS ARE VERIFIED, TO THE SAME PAGE AND BY THE SAME RULE ─────────
 *
 * Read off TruColor's WNBA franchise-records page, which covers 1997-present
 * era by era — the same source and the same mechanical rule as WNBA_TEAMS:
 * take the era's official colours #1 and #2 as primary and secondary, apply no
 * judgement on top. So `unverifiedColors` is absent here, unlike the NBA's
 * HISTORICAL_TEAMS, whose hexes really were written from memory.
 *
 *   https://www.trucolor.net/portfolio/womens-national-basketball-association-official-colors-1997-through-present/
 *
 * ⚠ ONE CAVEAT ON HOW THEY WERE READ: the page was fetched and its text
 * extracted, not eyeballed swatch by swatch the way the fifteen live rows were.
 * The era BOUNDARIES below are therefore the more likely place for an error
 * than the hexes, and a card landing one season either side of a boundary is
 * the case to spot-check.
 *
 * ── LOGOS: ALMOST ALL OF THESE ARE MISSING, AND THAT IS EXPECTED ────────────
 *
 * `logo: null` renders CardTemplate's lettered circle, which reads "HOU" or
 * "SAS" and is exactly right for a mark nobody has supplied yet. The generator
 * reports the shopping list on every run — see generateWnbaLegends.js's
 * `logoShoppingList`, which names only the franchises the finished cards
 * ACTUALLY land on rather than all twenty-odd rows below.
 *
 * A PRIOR ERA OF A LIVE FRANCHISE KEEPS THE MODERN MARK rather than dropping
 * to a circle, because a Storm logo from the wrong decade is still a Storm
 * logo and still better than three letters. Those rows carry `logoEra` saying
 * which era the file is really from, so the shopping list can tell a MISSING
 * mark (must supply) from an ANACHRONISTIC one (nice to have).
 */
export const WNBA_HISTORICAL_TEAMS = {
  // ── Folded, in the order they arrived ───────────────────────────────────────
  // HOU.gif is the one non-PNG in the directory and it is a 545x251 WORDMARK
  // LOCKUP — 2.17:1, past what logoFiles.test.js allows a live team — so it
  // draws small in the 115x96 slot. Wired anyway: a small mark beats three
  // letters, and the shopping list asks for a mark-only file.
  HOU:  { name: 'Comets',       city: 'Houston',      primary: '#BA0C2F', secondary: '#041E42', logo: '/logos/WNBA/HOU.gif', logoNote: 'a 545x251 wordmark lockup (2.17:1) — era-correct, but past what logoFiles.test.js allows a live team, so it draws about half the slot. A mark-only file would draw twice the size.', league: 'WNBA', era: '1997-2008', folded: true }, // Fireball Red, Galaxy Blue
  // ⚠ NOT public/logos/WNBA/CLE.png. The user has stated that file is the 2028
  // CLEVELAND SIRENS — the incoming expansion team — and not the Rockers, who
  // folded in 2003. Pointing this row at it would print the wrong franchise's
  // mark on a card from twenty-five years earlier.
  CLE:  { name: 'Rockers',      city: 'Cleveland',    primary: '#010101', secondary: '#009FDF', logo: null, league: 'WNBA', era: '1997-2003', folded: true }, // Black, Blue
  CHA:  { name: 'Sting',        city: 'Charlotte',    primary: '#00778B', secondary: '#280071', logo: null, league: 'WNBA', era: '1997-2003', folded: true }, // Teal, Purple
  CHA2: { name: 'Sting',        city: 'Charlotte',    primary: '#F9423A', secondary: '#1B365D', logo: null, league: 'WNBA', era: '2004-2006', folded: true }, // Orange, Blue
  SAC:  { name: 'Monarchs',     city: 'Sacramento',   primary: '#753BBD', secondary: '#010101', logo: null, league: 'WNBA', era: '1997-2009', folded: true }, // Purple, Black
  UTA:  { name: 'Starzz',       city: 'Utah',         primary: '#006271', secondary: '#753BBD', logo: null, league: 'WNBA', era: '1997-2002', folded: false }, // Green, Purple — became San Antonio
  DET:  { name: 'Shock',        city: 'Detroit',      primary: '#010101', secondary: '#FFA400', logo: null, league: 'WNBA', era: '1998-2001', folded: false }, // Black, Yellow
  DET2: { name: 'Shock',        city: 'Detroit',      primary: '#003DA5', secondary: '#041E42', logo: null, league: 'WNBA', era: '2002-2009', folded: false }, // Blue, Dark Blue — became Tulsa
  ORL:  { name: 'Miracle',      city: 'Orlando',      primary: '#0057B7', secondary: '#010101', logo: null, league: 'WNBA', era: '1999-2002', folded: false }, // Miracle Blue, Black — became Connecticut
  // ⚠ PORTLAND FIRE, TWICE. This is the 2000-2002 franchise, which folded; the
  // POR row in WNBA_TEAMS is the 2026 EXPANSION team of the same name in the
  // same city, and it is pink. One abbreviation, two franchises, twenty-four
  // years apart — the WNBA's version of the NBA's CHA/CHB collision, and the
  // reason wnbaFranchiseForSeason exists rather than a flat merge of the two
  // tables. Keyed PORF so it can never shadow the live row.
  PORF: { name: 'Fire',         city: 'Portland',     primary: '#C8102E', secondary: '#010101', logo: null, league: 'WNBA', era: '2000-2002', folded: true }, // Red, Black
  MIA:  { name: 'Sol',          city: 'Miami',        primary: '#A6192E', secondary: '#010101', logo: null, league: 'WNBA', era: '2000-2002', folded: true }, // Fiery Red, Black
  SAS:  { name: 'Silver Stars', city: 'San Antonio',  primary: '#010101', secondary: '#8D9093', logo: '/logos/WNBA/SAS.png', league: 'WNBA', era: '2003-2017', folded: false }, // Black, Silver — became Las Vegas
  TUL:  { name: 'Shock',        city: 'Tulsa',        primary: '#FFB81C', secondary: '#010101', logo: null, league: 'WNBA', era: '2010-2015', folded: false }, // Yellow, Black — became Dallas

  // ── Live franchises, in the colours they actually wore ─────────────────────
  SEA00:  { name: 'Storm',   city: 'Seattle',      primary: '#00573F', secondary: '#9E2B2F', logo: '/logos/WNBA/SEA00.png', league: 'WNBA', era: '2000-2015' }, // Hunter Green, Maroon
  MIN99:  { name: 'Lynx',    city: 'Minnesota',    primary: '#00843D', secondary: '#236192', logo: '/logos/WNBA/MIN99.png', league: 'WNBA', era: '1999-2010' }, // Green, Slate Blue
  MIN11:  { name: 'Lynx',    city: 'Minnesota',    primary: '#236192', secondary: '#010101', logo: '/logos/WNBA/MIN11.png', league: 'WNBA', era: '2011-2017' }, // Slate Blue, Black
  PHO97:  { name: 'Mercury', city: 'Phoenix',      primary: '#EF3340', secondary: '#5F249F', logo: '/logos/WNBA/PHO97.png', league: 'WNBA', era: '1997-2010' }, // Planet Red, Purple
  PHO11:  { name: 'Mercury', city: 'Phoenix',      primary: '#582C83', secondary: '#CB6015', logo: '/logos/WNBA/PHO11.png', league: 'WNBA', era: '2011-2014' }, // Purple, Orange
  PHO15:  { name: 'Mercury', city: 'Phoenix',      primary: '#211747', secondary: '#CB6015', logo: '/logos/WNBA/PHO.png', logoEra: '2026-present', league: 'WNBA', era: '2015-2025' }, // Dark Purple, Burnt Orange
  NYL97:  { name: 'Liberty', city: 'New York',     primary: '#010101', secondary: '#0057B7', logo: '/logos/WNBA/NYL.png', logoEra: '2020-present', league: 'WNBA', era: '1997-2002' }, // Gotham Black, Harbor Blue
  NYL03:  { name: 'Liberty', city: 'New York',     primary: '#0057B7', secondary: '#6ECEB2', logo: '/logos/WNBA/NYL.png', logoEra: '2020-present', league: 'WNBA', era: '2003-2011' }, // Harbor Blue, Liberty Green
  NYL12:  { name: 'Liberty', city: 'New York',     primary: '#010101', secondary: '#003DA5', logo: '/logos/WNBA/NYL12.png', league: 'WNBA', era: '2012-2019' }, // Black, Blue
  WAS98:  { name: 'Mystics', city: 'Washington',   primary: '#236192', secondary: '#8F654D', logo: '/logos/WNBA/WAS.png', logoEra: '2011-present', league: 'WNBA', era: '1998-2010' }, // Slate Blue, Bronze
  CON03:  { name: 'Sun',     city: 'Connecticut',  primary: '#041E42', secondary: '#A6192E', logo: '/logos/WNBA/CON03.png', league: 'WNBA', era: '2003-2015' }, // Navy, Dark Red
  CON16:  { name: 'Sun',     city: 'Connecticut',  primary: '#DC4405', secondary: '#041E42', logo: '/logos/WNBA/CONN.png', logoEra: '2021-present', league: 'WNBA', era: '2016-2020' }, // Orange, Navy
  ATL08:  { name: 'Dream',   city: 'Atlanta',      primary: '#418FDE', secondary: '#C8102E', logo: '/logos/WNBA/ATL.png', logoEra: '2020-present', league: 'WNBA', era: '2008-2015' }, // Sky Blue, Red
  ATL16:  { name: 'Dream',   city: 'Atlanta',      primary: '#0C2340', secondary: '#C8102E', logo: '/logos/WNBA/ATL.png', logoEra: '2020-present', league: 'WNBA', era: '2016-2019' }, // Navy, Red
  LVA18:  { name: 'Aces',    city: 'Las Vegas',    primary: '#010101', secondary: '#BA0C2F', logo: '/logos/WNBA/LVA.png', logoEra: '2024-present', league: 'WNBA', era: '2018-2023' }, // Black, Red
};

/**
 * Which WNBA franchise key an abbreviation meant IN A GIVEN SEASON.
 *
 * A DECLARED TABLE rather than a chain of ifs, because it is a fact about the
 * league and not a computation: each row says "this abbreviation, through this
 * season, is that key". Rows are checked in order and the FIRST season-match
 * wins, so the ranges may be written oldest-first and read as a timeline.
 *
 * An abbreviation with no row, or a season past every row's `through`, resolves
 * to the abbreviation itself — which is the live WNBA_TEAMS row. That default
 * is what keeps the current set, which never passes a season at all, behaving
 * exactly as it did before this table existed.
 */
export const WNBA_TEAM_ERAS = [
  { abbr: 'CHA', through: 2003, key: 'CHA' },
  { abbr: 'CHA', through: 2006, key: 'CHA2' },
  { abbr: 'DET', through: 2001, key: 'DET' },
  { abbr: 'DET', through: 2009, key: 'DET2' },
  { abbr: 'POR', through: 2002, key: 'PORF' },
  { abbr: 'SEA', through: 2015, key: 'SEA00' },
  { abbr: 'MIN', through: 2010, key: 'MIN99' },
  { abbr: 'MIN', through: 2017, key: 'MIN11' },
  { abbr: 'PHO', through: 2010, key: 'PHO97' },
  { abbr: 'PHO', through: 2014, key: 'PHO11' },
  { abbr: 'PHO', through: 2025, key: 'PHO15' },
  { abbr: 'NYL', through: 2002, key: 'NYL97' },
  { abbr: 'NYL', through: 2011, key: 'NYL03' },
  { abbr: 'NYL', through: 2019, key: 'NYL12' },
  { abbr: 'WAS', through: 2010, key: 'WAS98' },
  { abbr: 'CON', through: 2015, key: 'CON03' },
  { abbr: 'CON', through: 2020, key: 'CON16' },
  { abbr: 'ATL', through: 2015, key: 'ATL08' },
  { abbr: 'ATL', through: 2019, key: 'ATL16' },
  { abbr: 'LVA', through: 2023, key: 'LVA18' },
];

/**
 * The WNBA franchise key for an abbreviation AS OF a season.
 *
 * No season means "today", which is what every caller in the current WNBA set
 * passes by omission and is the answer they already relied on.
 */
export function wnbaFranchiseForSeason(abbr, season) {
  const key = String(abbr ?? '').toUpperCase();
  if (!Number.isFinite(season)) return key;
  const era = WNBA_TEAM_ERAS.find(e => e.abbr === key && season <= e.through);
  return era ? era.key : key;
}

/**
 * NINE WNBA ABBREVIATIONS COLLIDE WITH NBA ONES — ATL, CHI, DAL, IND, POR, SEA,
 * TOR, WAS and PHO all mean something in both tables, and in every case a
 * different franchise. `getTeam('ATL')` cannot answer for both.
 *
 * So WNBA lookups are EXPLICIT rather than a fallthrough: `getTeam` never
 * reaches this table, and a caller who knows it is holding a WNBA card asks for
 * it by passing the league. That is the same shape as `franchiseForSeason` —
 * resolve the ambiguity with the one fact that actually distinguishes them,
 * and never guess.
 *
 * The live table first, then the historical one — the same order and the same
 * argument as `getTeam`: every key in WNBA_HISTORICAL_TEAMS is either one
 * WNBA_TEAMS does not have (HOU, CLE, SAC, …) or a synthetic era key that
 * cannot collide by construction (SEA00, PHO97, …), so the fallthrough can only
 * ever add franchises and never shadow a live one. Portland's genuine collision
 * is resolved by wnbaFranchiseForSeason before it reaches here.
 */
export function getWnbaTeam(abbr) {
  const key = String(abbr ?? '').toUpperCase();
  if (Object.hasOwn(WNBA_TEAMS, key)) return WNBA_TEAMS[key];
  return Object.hasOwn(WNBA_HISTORICAL_TEAMS, key) ? WNBA_HISTORICAL_TEAMS[key] : null;
}

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
 * The key a team is stored and OVERRIDDEN under, once its league is known.
 *
 * WNBA codes are NOT canonicalized: TEAM_ALIASES maps Basketball-Reference's
 * NBA spellings onto nba.com's, and the WNBA table is already keyed the way its
 * own source spells it. Running "PHO" through the alias map would turn the
 * Phoenix Mercury into the key of the Phoenix Suns — so a colour tuned on a
 * Mercury card would be written under "PHX" and never read back.
 *
 * A named function rather than a line inside getThemedTeam because the studio's
 * team editor has to derive the SAME key to write an override the card will
 * read. Two copies of this rule drifting apart is an override that silently
 * does nothing.
 */
export function canonicalTeamFor(abbr, { league } = {}) {
  if (league === 'WNBA') return String(abbr ?? '').toUpperCase();
  return canonicalTeam(abbr);
}

/** How many franchises a league's table holds — the editor's denominator. */
export function leagueTeamCount(league) {
  return league === 'WNBA' ? Object.keys(WNBA_TEAMS).length : Object.keys(TEAMS).length;
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
export function getTeam(abbr, { league } = {}) {
  // A LEAGUE, WHEN GIVEN, IS AN EXCLUSIVE ROUTE, not a first guess. Nine
  // abbreviations mean one franchise in the NBA table and a different one in
  // the WNBA table, so a WNBA card falling through to `TEAMS` would print the
  // Atlanta Hawks' colours on an Atlanta Dream card — wrong, and wrong in a way
  // that looks perfectly fine. An unknown WNBA code gets the neutral fallback,
  // which is the correct signal, rather than an NBA team's identity.
  if (league === 'WNBA') return getWnbaTeam(abbr) ?? FALLBACK;
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
export function getThemedTeam(abbr, overrides = {}, { league } = {}) {
  const canonical = canonicalTeamFor(abbr, { league });
  const base = getTeam(canonical, { league });
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
