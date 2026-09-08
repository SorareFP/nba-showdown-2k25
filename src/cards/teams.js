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
  SEA: { name: 'SuperSonics', city: 'Seattle',     primary: '#00653A', secondary: '#FFC72C', logo: '/logos/SEA.png', era: '1967-2008', unverifiedColors: true },
  // ── EIGHT MARKS ADDED 2026-09-04 ───────────────────────────────────────
  // Every colour below is SAMPLED from the installed PNG rather than recalled:
  // the two most-covered non-outline bins, which is what auditEraColors checks
  // a declared palette against. That is why none is flagged unverifiedColors —
  // the logo IS the source.
  UTA96: { name: 'Jazz',    city: 'Utah',         primary: '#8033C4', secondary: '#00B7E9', logo: '/logos/UTA96.png', era: '1996-2004' },
  UTA04: { name: 'Jazz',    city: 'Utah',         primary: '#00275D', secondary: '#6CAEDF', logo: '/logos/UTA04.png', era: '2004-2010' },
  UTA16: { name: 'Jazz',    city: 'Utah',         primary: '#002144', secondary: '#FFA200', logo: '/logos/UTA16.png', era: '2016-2022' },
  PHI77: { name: '76ers',   city: 'Philadelphia', primary: '#243E7C', secondary: '#EC1A34', logo: '/logos/PHI77.png', era: '1977-1997' },
  PHI09: { name: '76ers',   city: 'Philadelphia', primary: '#0046AD', secondary: '#D7083B', logo: '/logos/PHI09.png', era: '2009-2015' },
  DET79: { name: 'Pistons', city: 'Detroit',      primary: '#EC0028', secondary: '#003CAB', logo: '/logos/DET79.png', era: '1979-1996' },
  DET96: { name: 'Pistons', city: 'Detroit',      primary: '#006271', secondary: '#9D2235', logo: '/logos/DET96.png', era: '1996-2001' },
  MIL06: { name: 'Bucks',   city: 'Milwaukee',    primary: '#195331', secondary: '#B80028', logo: '/logos/MIL06.png', era: '2006-2015' },
  NJN: { name: 'Nets',        city: 'New Jersey',  primary: '#002A60', secondary: '#CE1141', logo: '/logos/NJN.png', era: '1977-2012', unverifiedColors: true },
  NOH: { name: 'Hornets',     city: 'New Orleans', primary: '#002B5C', secondary: '#B4975A', logo: '/logos/NOH.png', era: '2002-2013', unverifiedColors: true },
  NOK: { name: 'Hornets',     city: 'New Orleans/Oklahoma City', primary: '#002B5C', secondary: '#B4975A', logo: '/logos/NOK.png', era: '2005-2007', unverifiedColors: true },
  CHH: { name: 'Hornets',     city: 'Charlotte',   primary: '#00778B', secondary: '#280071', logo: '/logos/CHH.png', era: '1988-2002', unverifiedColors: true },
  CHB: { name: 'Bobcats',     city: 'Charlotte',   primary: '#F9423A', secondary: '#004071', logo: '/logos/CHB.png', era: '2004-2014', unverifiedColors: true },
  CHB04: { name: 'Bobcats',   city: 'Charlotte',   abbr: 'CHB', primary: '#F9423A', secondary: '#004071', logo: '/logos/CHB04.png', era: '2005-2008', unverifiedColors: true },
  CHB08: { name: 'Bobcats',   city: 'Charlotte',   abbr: 'CHB', primary: '#F9423A', secondary: '#004071', logo: '/logos/CHB08.png', era: '2009-2012', unverifiedColors: true },
  CHB13: { name: 'Bobcats',   city: 'Charlotte',   abbr: 'CHB', primary: '#F9423A', secondary: '#004071', logo: '/logos/CHB13.png', era: '2013-2014', unverifiedColors: true },
  VAN: { name: 'Grizzlies',   city: 'Vancouver',   primary: '#00B2A9', secondary: '#BC7844', logo: '/logos/VAN.png', era: '1995-2001', unverifiedColors: true },
  WSB: { name: 'Bullets',     city: 'Washington',  primary: '#002B5C', secondary: '#E03A3E', logo: '/logos/WSB.png', era: '1974-1997', unverifiedColors: true },

  // ── ERA IDENTITIES OF LIVE FRANCHISES ─────────────────────────────────────
  //
  // Same franchise, different clothes. The Summer Standouts set put 2009
  // Chauncey Billups on a card wearing today's navy-and-red Nuggets, which is
  // as wrong on its face as Durant's rookie card saying OKC — the 2009 Nuggets
  // wore POWDER BLUE. These keys are what franchiseForSeason returns for a
  // season inside the era (see FRANCHISE_ERAS), so the card carries the era
  // key and this table dresses it. `abbr` is what the lettered-circle fallback
  // and any code-shaped surface should print — the key is an internal season
  // qualifier, not a thing a card should say.
  //
  // Logo paths are PRE-WIRED to each key's own stem — drop a file at
  // public/logos/{KEY}.png (webp/jpg probe too) and it lights up with no code
  // edit; until then AssetImage 404s to the lettered circle showing `abbr`.
  // Wanted marks: DEN04 (rainbow-skyline pickaxe), SAC95 (1994 crown), CLE04
  // (sword C), DET02 (horsepower), LAC16 (2015 script), TOR96 (dino-ball),
  // ATL96 (hawk head), ATL08 (navy), WSB (Bullets), and the relocated
  // franchises above. Colours are from general knowledge, marked unverified.
  DEN04: { name: 'Nuggets',  city: 'Denver',      abbr: 'DEN', primary: '#418FDE', secondary: '#FFC72C', logo: '/logos/DEN04.png', era: '2004-2012', unverifiedColors: true },
  SAC95: { name: 'Kings',    city: 'Sacramento',  abbr: 'SAC', primary: '#5A2D81', secondary: '#000000', logo: '/logos/SAC95.png', era: '1995-2016', unverifiedColors: true },
  CLE04: { name: 'Cavaliers', city: 'Cleveland',  abbr: 'CLE', primary: '#860038', secondary: '#FDBB30', logo: '/logos/CLE04.png', era: '2004-2010', unverifiedColors: true },
  CLE16: { name: 'Cavaliers', city: 'Cleveland',  abbr: 'CLE', primary: '#860038', secondary: '#FDBB30', logo: '/logos/CLE16.png', era: '2011-2017', unverifiedColors: true },
  // THE WINE-AND-GOLD C, AFTER NAVY WAS DROPPED and before the 2022 rebrand —
  // the mark five cards were played under (Sexton 2019, Garland 2020, Okoro
  // 2021, Mobley 2022, Rondo 2022), all of which read today's CLE.png until
  // now. The colours matter as much as the file here: the 2022 rebrand moved
  // the wine to #6F263D and the gold to #B9975B, so those cards were printing
  // a palette their season never wore. The mark is the black shield with the
  // C-sword, and it is genuinely a different logo from CLE16's wordmark-and-ball
  // — the two were checked side by side before this row was given a file of its
  // own, rather than widening CLE16's range. The user supplied the whole
  // Cavaliers suite 2026-09-07; CLE71/84/95 and CLE11 are in
  // card-art/logo-originals/ and stay uninstalled, no card wearing those years.
  CLE17: { name: 'Cavaliers', city: 'Cleveland',  abbr: 'CLE', primary: '#860038', secondary: '#FDBB30', logo: '/logos/CLE17.png', era: '2018-2022', unverifiedColors: true },
  DET02: { name: 'Pistons',  city: 'Detroit',     abbr: 'DET', primary: '#C8102E', secondary: '#1D42BA', logo: '/logos/DET02.png', era: '2002-2005', unverifiedColors: true },
  LAC16: { name: 'Clippers', city: 'Los Angeles', abbr: 'LAC', primary: '#C8102E', secondary: '#1D428A', logo: '/logos/LAC16.png', era: '2016-2024', unverifiedColors: true },
  TOR96: { name: 'Raptors',  city: 'Toronto',     abbr: 'TOR', primary: '#753BBD', secondary: '#CE1141', logo: '/logos/TOR96.png', era: '1996-2006', unverifiedColors: true },
  TOR07: { name: 'Raptors',  city: 'Toronto',     abbr: 'TOR', primary: '#CE1141', secondary: '#000000', logo: '/logos/TOR07.png', era: '2007-2008', unverifiedColors: true },
  TOR09: { name: 'Raptors',  city: 'Toronto',     abbr: 'TOR', primary: '#CE1141', secondary: '#A1A1A4', logo: '/logos/TOR09.png', era: '2009-2015', unverifiedColors: true },
  ATL96: { name: 'Hawks',    city: 'Atlanta',     abbr: 'ATL', primary: '#E03A3E', secondary: '#FDB927', logo: '/logos/ATL96.png', era: '1996-2007', unverifiedColors: true },
  ATL08: { name: 'Hawks',    city: 'Atlanta',     abbr: 'ATL', primary: '#002B5C', secondary: '#E03A3E', logo: '/logos/ATL08.png', era: '2008-2015', unverifiedColors: true },
  DAL80: { name: 'Mavericks', city: 'Dallas',     abbr: 'DAL', primary: '#00843D', secondary: '#0064B1', logo: '/logos/DAL80.png', era: '1981-2001', unverifiedColors: true },
  HOU72: { name: 'Rockets',  city: 'Houston',     abbr: 'HOU', primary: '#CE1141', secondary: '#FDB927', logo: '/logos/HOU72.png', era: '1972-1995', unverifiedColors: true },
  // THE SILVER ERA, 2003-04 through 2018-19. Added because two Summer Standouts
  // cards sit inside it — Chris Paul and PJ Tucker, both 2018 — and were
  // rendering in the CURRENT palette, whose Championship Yellow the Rockets did
  // not wear until the 2019-20 rebrand. Red carried across that rebrand; silver
  // did not, so the yellow was the visible error rather than the red.
  //
  // Neither hex is invented: #CE1141 is already this file's Rockets red (HOU72)
  // and #C4CED4 is already its silver (ORL01). Still flagged unverified like
  // every other era row, to be checked against the same authority as the live
  // table when the set is finalised.
  //
  // The mark is the era's own: the R-rocket with the orbit ring, supplied and
  // installed as public/logos/HOU03.png. It briefly borrowed the current mark
  // with a logoEra flag, which is why that field is absent now rather than
  // never having been here — logoFiles.test.js asserts the two states are
  // exclusive, so a row with its own era art must not claim one.
  HOU03: { name: 'Rockets',  city: 'Houston',     abbr: 'HOU', primary: '#CE1141', secondary: '#C4CED4', logo: '/logos/HOU03.png', era: '2003-2019', unverifiedColors: true },
  // THE 2019 MARK, FROZEN. Every Rockets card outside the base set is a
  // 2022-2025 season, and until now they all read the CURRENT HOU.png — which
  // is about to become the 2026 rebrand. A copy of today's file, so the
  // pre-26-27 cards keep the mark they were played under when HOU.png changes.
  // The 1995-2003 pinstripe era has no file yet and stays unmapped.
  // The 2019-20 rebrand mark, installed by the user as HOU20 (card-art/logo-originals/HOU20.png, 2026-09-06).
  HOU20: { name: 'Rockets',  city: 'Houston',     abbr: 'HOU', primary: '#CE1141', secondary: '#C4CED4', logo: '/logos/HOU20.png', era: '2019-2026' },
  MIL94: { name: 'Bucks',    city: 'Milwaukee',   abbr: 'MIL', primary: '#5C2F83', secondary: '#00471B', logo: '/logos/MIL94.png', era: '1994-2006', unverifiedColors: true },
  MIN89: { name: 'Timberwolves', city: 'Minnesota', abbr: 'MIN', primary: '#005084', secondary: '#00A94F', logo: '/logos/MIN89.png', era: '1989-1996', unverifiedColors: true },
  // SAMPLED FROM MIN97.png ITSELF, which is the only authority this row has:
  // the mark is 26% #236192 blue, 21% #8D9093 silver, 21% #00843D green, and
  // those three are the Timberwolves' documented 1996-2008 palette. It had
  // been carrying #0C2340 / #78BE20 — today's navy and today's lime — which
  // matched neither the art it sits beside nor the era it names.
  MIN97: { name: 'Timberwolves', city: 'Minnesota', abbr: 'MIN', primary: '#236192', secondary: '#00843D', logo: '/logos/MIN97.png', era: '1997-2017', unverifiedColors: true },
  MEM01: { name: 'Grizzlies', city: 'Memphis',    abbr: 'MEM', primary: '#00285E', secondary: '#6CACE4', logo: '/logos/MEM01.png', era: '2001-2004', unverifiedColors: true },
  PHI97: { name: '76ers',    city: 'Philadelphia', abbr: 'PHI', primary: '#000000', secondary: '#C8102E', logo: '/logos/PHI97.png', era: '1998-2009', unverifiedColors: true },
  ORL89: { name: 'Magic',    city: 'Orlando',     abbr: 'ORL', primary: '#0077C0', secondary: '#000000', logo: '/logos/ORL89.png', era: '1989-2000', unverifiedColors: true },
  ORL01: { name: 'Magic',    city: 'Orlando',     abbr: 'ORL', primary: '#0077C0', secondary: '#C4CED4', logo: '/logos/ORL01.png', era: '2001-2010', unverifiedColors: true },
  // The lightning-bolt wordmark era, worn through Chris Webber's rookie year —
  // the Warriors' only card before 1998. Installed by the user 2026-09-07 as a
  // GIF (card-art/logo-originals/GSW89.gif) — the EXTENSION IS LOAD-BEARING:
  // logoFiles.test.js picks its header parser by it. Royal blue and gold, as
  // the GSW row carries today.
  GSW89: { name: 'Warriors', city: 'Golden State', abbr: 'GSW', primary: '#1D4289', secondary: '#FFC72C', logo: '/logos/GSW89.gif', era: '1989-1997', unverifiedColors: true },
  GSW98: { name: 'Warriors', city: 'Golden State', abbr: 'GSW', primary: '#04529C', secondary: '#FFCC33', logo: '/logos/GSW98.png', era: '1998-2010', unverifiedColors: true },
  LAC84: { name: 'Clippers', city: 'Los Angeles', abbr: 'LAC', primary: '#ED174C', secondary: '#006BB6', logo: '/logos/LAC84.png', era: '1985-2015', unverifiedColors: true },
  PHX93: { name: 'Suns',     city: 'Phoenix',     abbr: 'PHX', primary: '#1D1160', secondary: '#E56020', logo: '/logos/PHX93.png', era: '1993-2000', unverifiedColors: true },
  PHX01: { name: 'Suns',     city: 'Phoenix',     abbr: 'PHX', primary: '#1D1160', secondary: '#E56020', logo: '/logos/PHX01.png', era: '2001-2013', unverifiedColors: true },
  SEA06: { name: 'SuperSonics', city: 'Seattle',  abbr: 'SEA', primary: '#00653A', secondary: '#FFC72C', logo: '/logos/SEA06.png', era: '2002-2008', unverifiedColors: true },
  DEN13: { name: 'Nuggets',  city: 'Denver',      abbr: 'DEN', primary: '#0E2240', secondary: '#FEC524', logo: '/logos/DEN13.png', era: '2013-2018', unverifiedColors: true },
  DET06: { name: 'Pistons',  city: 'Detroit',     abbr: 'DET', primary: '#ED174C', secondary: '#0058A6', logo: '/logos/DET06.png', era: '2006-2017', unverifiedColors: true },

  // THE FIRST NBA ROW TO BORROW A LIVE MARK, on the WNBA table's convention:
  // `logoEra` says the art is right as to franchise and WRONG AS TO YEAR, and
  // is what keeps it on the shopping list until era art arrives. Washington had
  // no era row at all, so Antawn Jamison's 2005-06 card wore today's red and
  // navy — a scheme the franchise did not adopt until 2011-12. The colours are
  // the blue-black-bronze the Wizards actually wore from 1997-98; the mark is
  // still the modern one, and the era file is wanted.
  WAS97: { name: 'Wizards',  city: 'Washington',  abbr: 'WAS', primary: '#246394', secondary: '#8F664E', logo: '/logos/WAS97.png', era: '1997-2011' }, // Blue, Bronze — sampled from the mark
};

/**
 * Seasons in which a LIVE franchise wore an identity today's row does not.
 *
 * Consulted by franchiseForSeason after the Bobcats rule. `to` and `from` are
 * Basketball-Reference season numbers (2004 means 2003-04). A franchise absent
 * here has worn one identity for every season this app cards, which is true of
 * most of them and the reason this is a short list rather than a registry of
 * every rebrand in league history — a row earns its place by a card actually
 * wearing it.
 */
export const FRANCHISE_ERAS = {
  WAS: [{ from: 1998, to: 2011, key: 'WAS97' }],
  // UTAH HAD NO ERA LIST AT ALL until 2026-09-04, so every Jazz card printed
  // the 2023 mark whatever season it was. The 2011-2016 navy-and-gold note era
  // is deliberately absent rather than guessed: no card sits in it, and a range
  // with no logo behind it would print a lettered circle where the current mark
  // at least prints a Jazz.
  UTA: [
    { from: 1997, to: 2004, key: 'UTA96' },
    { from: 2005, to: 2010, key: 'UTA04' },
    { from: 2017, to: 2022, key: 'UTA16' },
  ],
  DEN: [
    { from: 2004, to: 2012, key: 'DEN04' },
    { from: 2013, to: 2018, key: 'DEN13' },
  ],
  SAC: [{ from: 1995, to: 2016, key: 'SAC95' }],
  CLE: [
    { from: 2004, to: 2010, key: 'CLE04' },
    { from: 2011, to: 2017, key: 'CLE16' },
    { from: 2018, to: 2022, key: 'CLE17' },
  ],
  DET: [
    { from: 1979, to: 1996, key: 'DET79' },
    { from: 1997, to: 2001, key: 'DET96' },
    { from: 2002, to: 2005, key: 'DET02' },
    { from: 2006, to: 2017, key: 'DET06' },
  ],
  LAC: [
    { from: 1985, to: 2015, key: 'LAC84' },
    { from: 2016, to: 2024, key: 'LAC16' },
  ],
  TOR: [
    { from: 1996, to: 2006, key: 'TOR96' },
    { from: 2007, to: 2008, key: 'TOR07' },
    { from: 2009, to: 2015, key: 'TOR09' },
  ],
  ATL: [
    { from: 1996, to: 2007, key: 'ATL96' },
    { from: 2008, to: 2015, key: 'ATL08' },
  ],
  CHB: [
    { from: 2005, to: 2008, key: 'CHB04' },
    { from: 2009, to: 2012, key: 'CHB08' },
    { from: 2013, to: 2014, key: 'CHB13' },
  ],
  DAL: [{ from: 1981, to: 2001, key: 'DAL80' }],
  HOU: [{ from: 1972, to: 1995, key: 'HOU72' }, { from: 2004, to: 2019, key: 'HOU03' }, { from: 2020, to: 2026, key: 'HOU20' }],
  MIL: [
    { from: 1994, to: 2006, key: 'MIL94' },
    { from: 2007, to: 2015, key: 'MIL06' },
  ],
  MIN: [
    { from: 1989, to: 1996, key: 'MIN89' },
    { from: 1997, to: 2017, key: 'MIN97' },
  ],
  MEM: [{ from: 2001, to: 2004, key: 'MEM01' }],
  PHI: [
    { from: 1977, to: 1997, key: 'PHI77' },
    { from: 1998, to: 2009, key: 'PHI97' },
    { from: 2010, to: 2015, key: 'PHI09' },
  ],
  ORL: [
    { from: 1989, to: 2000, key: 'ORL89' },
    { from: 2001, to: 2010, key: 'ORL01' },
  ],
  GSW: [{ from: 1989, to: 1997, key: 'GSW89' }, { from: 1998, to: 2010, key: 'GSW98' }],
  PHX: [
    { from: 1993, to: 2000, key: 'PHX93' },
    { from: 2001, to: 2013, key: 'PHX01' },
  ],
  SEA: [{ from: 2002, to: 2008, key: 'SEA06' }],
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
  POR: { name: 'Fire',      city: 'Portland',     primary: '#C8102E', secondary: '#E93CAC', logo: '/logos/WNBA/POR.png', league: 'WNBA' }, // Red, Pink — TruColor's PAIR, its ORDER deliberately reversed; see ORDER_REVERSED in teams.test.js
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
  CLE:  { name: 'Rockers',      city: 'Cleveland',    primary: '#010101', secondary: '#009FDF', logo: '/logos/WNBA/CLE97.png', league: 'WNBA', era: '1997-2003', folded: true,
          // THE SIRENS — Cleveland's 2028 expansion team, the one CLE.png belongs
          // to — stand for the Rockers in the favourite-team picker (the user,
          // 2026-09-08: "swap the Rockers for the Sirens"); the cards behind the
          // choice are still the Rockers' legends. Inline rather than a row: the
          // WNBA era table has no Cleveland entry, so a 1998 face resolves
          // straight to whatever `CLE` names, and every historical row must be
          // one an era can produce (teams.test.js). Colours unverified.
          successor: { name: 'Sirens', city: 'Cleveland', primary: '#0B1F3A', secondary: '#7FD1E6', logo: '/logos/WNBA/CLE.png', era: '2028-' } },
  CHA:  { name: 'Sting',        city: 'Charlotte',    primary: '#00778B', secondary: '#280071', logo: '/logos/WNBA/CHA97.png', league: 'WNBA', era: '1997-2003', folded: true }, // Teal, Purple — 1997 mark (the user, 2026-09-06)
  CHA2: { name: 'Sting',        city: 'Charlotte',    primary: '#F9423A', secondary: '#1B365D', logo: '/logos/WNBA/CHA04.png', league: 'WNBA', era: '2004-2006', folded: true }, // Orange, Blue — 2004 mark (the user, 2026-09-06)
  SAC:  { name: 'Monarchs',     city: 'Sacramento',   primary: '#753BBD', secondary: '#010101', logo: '/logos/WNBA/SAC97.png', league: 'WNBA', era: '1997-2009', folded: true }, // Purple, Black — 1997 mark (the user, 2026-09-06)
  UTA:  { name: 'Starzz',       city: 'Utah',         primary: '#006271', secondary: '#753BBD', logo: '/logos/WNBA/UTA97.png', league: 'WNBA', era: '1997-2002', folded: false }, // Green, Purple — became San Antonio; 1997 mark (the user, 2026-09-06)
  DET:  { name: 'Shock',        city: 'Detroit',      primary: '#F8A10F', secondary: '#126D6C', logo: '/logos/WNBA/DET97.png', league: 'WNBA', era: '1998-2001', folded: false }, // Gold, Teal — sampled
  DET2: { name: 'Shock',        city: 'Detroit',      primary: '#00265D', secondary: '#ED154B', logo: '/logos/WNBA/DET03.png', league: 'WNBA', era: '2002-2009', folded: false }, // Navy, Red — sampled; became Tulsa
  ORL:  { name: 'Miracle',      city: 'Orlando',      primary: '#0057B7', secondary: '#010101', logo: '/logos/WNBA/ORL99.png', league: 'WNBA', era: '1999-2002', folded: false }, // Miracle Blue, Black — became Connecticut; 1999 mark (the user, 2026-09-06)
  // ⚠ PORTLAND FIRE, TWICE. This is the 2000-2002 franchise, which folded; the
  // POR row in WNBA_TEAMS is the 2026 EXPANSION team of the same name in the
  // same city, and it is pink. One abbreviation, two franchises, twenty-four
  // years apart — the WNBA's version of the NBA's CHA/CHB collision, and the
  // reason wnbaFranchiseForSeason exists rather than a flat merge of the two
  // tables. Keyed PORF so it can never shadow the live row.
  PORF: { name: 'Fire',         city: 'Portland',     primary: '#C8102E', secondary: '#010101', logo: '/logos/WNBA/PORF.png', league: 'WNBA', era: '2000-2002', folded: true }, // Red, Black
  MIA:  { name: 'Sol',          city: 'Miami',        primary: '#A6192E', secondary: '#010101', logo: '/logos/WNBA/MIA00.png', league: 'WNBA', era: '2000-2002', folded: true }, // Fiery Red, Black — 2000 mark (the user, 2026-09-06); the last WNBA franchise to get one
  SAS:  { name: 'Silver Stars', city: 'San Antonio',  primary: '#010101', secondary: '#8D9093', logo: '/logos/WNBA/SAS.png', league: 'WNBA', era: '2003-2013', folded: false }, // Black, Silver — renamed Stars in 2014
  SAS14: { name: 'Stars',       city: 'San Antonio',  primary: '#010101', secondary: '#8D9093', logo: '/logos/WNBA/SAS14.png', league: 'WNBA', era: '2014-2017', folded: false, unverifiedColors: true }, // Black, Silver carried over from the Silver Stars row — the 2014 mark (the user, 2026-09-06); became Las Vegas
  TUL:  { name: 'Shock',        city: 'Tulsa',        primary: '#FFB81C', secondary: '#010101', logo: '/logos/WNBA/TUL.png', league: 'WNBA', era: '2010-2015', folded: false }, // Yellow, Black — became Dallas

  // ── Live franchises, in the colours they actually wore ─────────────────────
  SEA00:  { name: 'Storm',   city: 'Seattle',      primary: '#00573F', secondary: '#9E2B2F', logo: '/logos/WNBA/SEA00.png', league: 'WNBA', era: '2000-2015' }, // Hunter Green, Maroon
  MIN99:  { name: 'Lynx',    city: 'Minnesota',    primary: '#00843D', secondary: '#236192', logo: '/logos/WNBA/MIN99.png', league: 'WNBA', era: '1999-2010' }, // Green, Slate Blue
  MIN11:  { name: 'Lynx',    city: 'Minnesota',    primary: '#236192', secondary: '#010101', logo: '/logos/WNBA/MIN11.png', league: 'WNBA', era: '2011-2017' }, // Slate Blue, Black
  PHO97:  { name: 'Mercury', city: 'Phoenix',      primary: '#EF3340', secondary: '#5F249F', logo: '/logos/WNBA/PHO97.png', league: 'WNBA', era: '1997-2010' }, // Planet Red, Purple
  PHO11:  { name: 'Mercury', city: 'Phoenix',      primary: '#582C83', secondary: '#CB6015', logo: '/logos/WNBA/PHO11.png', league: 'WNBA', era: '2011-2014' }, // Purple, Orange
  PHO15:  { name: 'Mercury', city: 'Phoenix',      primary: '#DD5800', secondary: '#22164A', logo: '/logos/WNBA/PHO15.png', league: 'WNBA', era: '2015-2025' }, // Dark Purple, Burnt Orange
  // BOTH HISTORIC LIBERTY ERAS WEAR THE 1997 MARK, and that is the user's call
  // from the source rather than a shortcut: "I only see the 97 liberty and the
  // present liberty as all that have existed." Both rows used to borrow the
  // MODERN logo — their own `logoEra: '2020-present'` said so — which put a
  // 2024 mark and a black-and-mint palette on Cappie Pondexter's 2010 card.
  // Colours sampled from the file: orange #FF6418, harbor blue #0046AE.
  NYL97:  { name: 'Liberty', city: 'New York',     primary: '#FF6418', secondary: '#0046AE', logo: '/logos/WNBA/NYLRetro1.png', league: 'WNBA', era: '1997-2002' }, // Torch Orange, Harbor Blue
  NYL03:  { name: 'Liberty', city: 'New York',     primary: '#FF6418', secondary: '#0046AE', logo: '/logos/WNBA/NYLRetro1.png', league: 'WNBA', era: '2003-2011' }, // Torch Orange, Harbor Blue
  NYL12:  { name: 'Liberty', city: 'New York',     primary: '#010101', secondary: '#003DA5', logo: '/logos/WNBA/NYL12.png', league: 'WNBA', era: '2012-2019' }, // Black, Blue
  WAS98:  { name: 'Mystics', city: 'Washington',   primary: '#004F82', secondary: '#B97745', logo: '/logos/WNBA/WAS98.png', league: 'WNBA', era: '1998-2010' }, // Slate Blue, Bronze
  CON03:  { name: 'Sun',     city: 'Connecticut',  primary: '#041E42', secondary: '#A6192E', logo: '/logos/WNBA/CON03.png', league: 'WNBA', era: '2003-2015' }, // Navy, Dark Red
  CON16:  { name: 'Sun',     city: 'Connecticut',  primary: '#E34912', secondary: '#AC1A2F', logo: '/logos/WNBA/CON16.png', league: 'WNBA', era: '2016-2020' }, // Orange, Navy
  ATL08:  { name: 'Dream',   city: 'Atlanta',      primary: '#4891DC', secondary: '#CC092F', logo: '/logos/WNBA/ATL08.png', league: 'WNBA', era: '2008-2019' }, // Sky Blue, Red
  LVA18:  { name: 'Aces',    city: 'Las Vegas',    primary: '#BA0C2F', secondary: '#B9975B', logo: '/logos/WNBA/LVA18.png', league: 'WNBA', era: '2018-2023' }, // Red, Gold — sampled
  // TWO NEW ERAS, both supplied for a team reward and both covering more than
  // that one card — an era is a span, not a card. LAS97 carries Tamecka Dixon's
  // 1997 (the Sparks reward) and Lisa Leslie's 2004; CHI06 carries Epiphanny
  // Prince's 2013 (the Sky reward) plus Vandersloot 2011, Delle Donne 2015 and
  // Gabby Williams 2018. Both run to a 2020 rebrand — the Sparks' end date was
  // first guessed at 2005 and corrected by the user to 2020, which moved Lisa
  // Leslie's 2004, Candace Parker's 2008 and Nneka Ogwumike's 2012 onto it too.
  LAS97:  { name: 'Sparks',  city: 'Los Angeles',  primary: '#682E86', secondary: '#FFC82E', logo: '/logos/WNBA/LAS97.png', league: 'WNBA', era: '1997-2020' }, // Purple, Gold — sampled
  CHI06:  { name: 'Sky',     city: 'Chicago',      primary: '#4891DC', secondary: '#FFCC00', logo: '/logos/WNBA/CHI06.png', league: 'WNBA', era: '2006-2019' }, // Sky Blue, Yellow — sampled
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
  // ONE DREAM ERA, NOT TWO. The original mark ran 2008-2019, so the split at
  // 2015 was a distinction the logo never made — ATL16 existed only because
  // nobody had the file and it was borrowing the 2020 mark. Its row is gone
  // rather than kept: a row nothing can resolve to is a colour nobody will
  // ever see, which is exactly what the era test refuses.
  { abbr: 'ATL', through: 2019, key: 'ATL08' },
  { abbr: 'LVA', through: 2023, key: 'LVA18' },
  { abbr: 'LAS', through: 2020, key: 'LAS97' },
  { abbr: 'CHI', through: 2019, key: 'CHI06' },
  { abbr: 'SAS', through: 2013, key: 'SAS' },
  { abbr: 'SAS', through: 2017, key: 'SAS14' },
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
  // The Bobcats rule feeds INTO the era table now instead of returning early:
  // the user supplied all three cat marks, so a 2008 Bobcat and a 2012 Bobcat
  // wear different ones.
  const key = raw === 'CHA' && Number.isFinite(season) && season <= LAST_BOBCATS_SEASON
    ? 'CHB'
    : canonicalTeam(raw);
  // A live franchise's dated identity — the 2009 Nuggets are powder blue, not
  // today's navy. See FRANCHISE_ERAS.
  if (Number.isFinite(season) && Object.hasOwn(FRANCHISE_ERAS, key)) {
    for (const era of FRANCHISE_ERAS[key]) {
      if (season >= era.from && season <= era.to) return era.key;
    }
  }
  return key;
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
/**
 * Franchises that MOVED OR WERE RENAMED, and where they went.
 *
 * FRANCHISE_ERAS already covers a club that restyled in place — TOR09 is listed
 * under TOR, SEA06 under OKC — because an era is a season range belonging to a
 * franchise. These four are not eras of anybody: they are the club's own old
 * identity in another city, so nothing lists them and they resolve to nothing.
 *
 * It matters because a targeted pack asks "is this card THIS franchise's?", and
 * without these a New Jersey Nets card is nobody's. See `currentFranchise`.
 */
export const RELOCATED_TO = {
  NJN: 'BKN',  // New Jersey Nets -> Brooklyn, 2012
  NOH: 'NOP',  // New Orleans Hornets -> Pelicans, 2013
  VAN: 'MEM',  // Vancouver Grizzlies -> Memphis, 2001
  WSB: 'WAS',  // Washington Bullets -> Wizards, 1997
  SEA: 'OKC',  // Seattle SuperSonics -> Oklahoma City, 2008
  CHB: 'CHA',  // Charlotte Bobcats -> renamed Hornets, 2014
};

/** Era key -> the franchise that owns it, inverted from FRANCHISE_ERAS once. */
const ERA_OWNER = (() => {
  const out = {};
  for (const [franchise, eras] of Object.entries(FRANCHISE_ERAS)) {
    for (const era of eras) out[era.key] = franchise;
  }
  return out;
})();

/**
 * WHICH LIVE FRANCHISE A CARD BELONGS TO, whatever era it prints.
 *
 * Three cases in order, and the order is the whole function: an era key belongs
 * to the franchise that declared it, a relocation belongs to where it went, and
 * anything else is already a current code (possibly under a Basketball-Reference
 * spelling, which is what canonicalTeam is for).
 *
 * THE ERA LOOKUP FEEDS THE RELOCATION LOOKUP, and it has to. FRANCHISE_ERAS is
 * keyed by the franchise as it was NAMED at the time, so SEA06 is listed under
 * SEA and CHB04 under CHB — both of which have since moved. Resolving the era
 * and stopping would hand back a franchise that no longer exists.
 *
 * NBA ONLY. The WNBA has its own era table and its own relocations, resolved by
 * `franchiseOf` in scripts/cardgen/wnba/wnbaRewardCandidates.js — and the two
 * leagues share codes (ATL, CHI, MIN, PHO, WAS all exist in both), so one
 * resolver across both would silently mix them.
 */
export function currentFranchise(team) {
  const code = String(team ?? '').toUpperCase();
  if (!code) return null;
  const owner = Object.hasOwn(ERA_OWNER, code) ? ERA_OWNER[code] : canonicalTeam(code);
  return Object.hasOwn(RELOCATED_TO, owner) ? RELOCATED_TO[owner] : owner;
}

export function canonicalTeamFor(abbr, { league } = {}) {
  if (league === 'WNBA') return String(abbr ?? '').toUpperCase();
  return canonicalTeam(abbr);
}

/**
 * The franchise a card's team code belongs to TODAY, in the right league.
 *
 * `currentFranchise` reads every code as an NBA one, and two of the NBA's own
 * franchise moves then land on WNBA teams that never went anywhere: PHO is an
 * alias for the Suns, so the Phoenix Mercury came out as "PHX"; SEA relocated
 * to Oklahoma City, so the Seattle Storm came out as "OKC". Both then miss
 * WNBA_TEAMS entirely and print as Unknown — which is how this was found, two
 * blank tiles in the favourite-team picker.
 *
 * There is nothing to resolve on the WNBA side: that table is keyed by
 * Basketball-Reference's current codes, with no era keys and no relocations, so
 * a WNBA code IS its franchise.
 */
export function currentFranchiseFor(team, { league } = {}) {
  if (league === 'WNBA' || league === 'wnba') {
    const code = String(team ?? '').toUpperCase();
    return code || null;
  }
  return currentFranchise(team);
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
