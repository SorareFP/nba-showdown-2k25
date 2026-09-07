// Which cards print TODAY'S team identity on a season that predates it.
//
//   node scripts/cardgen/auditEraMarks.js          # the gaps, with card counts
//   node scripts/cardgen/auditEraMarks.js --cards  # and every affected card
//
// ── WHY THIS IS A SCRIPT ────────────────────────────────────────────────────
//
// These were being found one at a time, by eye, off finished cards: PJ Tucker's
// Rockets, then Joe Johnson's Rockets, then Antawn Jamison's Wizards. Each was
// real and each cost a round trip, and the ones nobody happened to look at are
// still wrong. A franchise with no era row is not visibly broken — the card
// renders, in the wrong uniform.
//
// ── THE RULE ────────────────────────────────────────────────────────────────
//
// For every card carrying a season, ask franchiseForSeason what mark it gets.
// If the answer is the CURRENT key and the season is before that identity
// began, the card is wearing the wrong uniform. `IDENTITY_SINCE` below is the
// only hand-entered thing here: the first season each franchise's present-day
// primary mark and colourway was in use.
//
// A gap is reported as a REQUEST, not fixed automatically, because closing one
// needs a logo file and a colourway that nobody can derive from the data.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { CARD_SETS } from '../../src/game/cardSets.js';
import { franchiseForSeason, canonicalTeam, getTeam, FRANCHISE_ERAS } from '../../src/cards/teams.js';

/**
 * First season of each franchise's CURRENT primary mark and colourway.
 *
 * Hand-entered from the franchises' own rebrand announcements. A franchise
 * absent from this table has worn one identity for the whole 2002-2026 window
 * the card sets cover, so nothing can be out of era for it.
 *
 * "Current" means the mark public/logos/<CODE>.png actually holds. Where a very
 * recent refresh was a tweak rather than a rebrand (a wordmark, a shade), the
 * older season is not listed — the point is uniforms a reader would call wrong,
 * not every logo revision.
 */
export const IDENTITY_SINCE = {
  ATL: 2016, // pared-back Pac-Man, red/white
  BKN: 2013, // relocation from New Jersey; black and white
  CHA: 2015, // Hornets name and teal returned from the Bobcats
  CLE: 2018, // wine and gold refresh
  DAL: 2002, // silver/navy, replacing the 1980s green
  DEN: 2019, // navy/gold, replacing the 2013 mountain
  DET: 2018, // return to red/white/blue
  GSW: 2011, // the Bay Bridge roundel
  HOU: 2020, // the current stripped-back R
  LAC: 2025, // the Intuit Dome rebrand
  MEM: 2005, // Memphis blue, replacing the Vancouver-era carryover
  MIL: 2016, // cream city / good land green
  MIN: 2018, // the current north-star wordmark
  NOP: 2014, // Pelicans, from the New Orleans Hornets
  OKC: 2009, // relocation from Seattle
  ORL: 2011,
  PHI: 2016, // return of the classic Sixers script
  PHX: 2014,
  SAC: 2017,
  TOR: 2016, // the current raptor claw-ball
  UTA: 2023, // the current Jazz note
  WAS: 2012, // red/navy, replacing the 1997 blue-black-bronze wizard
};

/**
 * Sets whose cards name a season and therefore can be out of era.
 *
 * NBA ONLY. The WNBA sets are deliberately absent: their codes are not
 * canonicalized and they have their own historical table, so running them
 * through IDENTITY_SINCE reads the 2000 Houston COMETS as the Houston Rockets
 * and asks for a Rockets mark for a WNBA card. Their era gaps are a separate
 * list — see the WNBA shopping list in the card-studio notes.
 */
const SEASON_SETS = [
  'super-season', 'rookie', 'summer-standouts', 'dissonance', 'team-rewards',
];

/** Seasons already covered by an era row for this franchise. */
function coveredSeasons(code) {
  return (FRANCHISE_ERAS[code] ?? []).map(e => [e.from, e.to]);
}

const inAnyEra = (code, season) =>
  coveredSeasons(code).some(([from, to]) => season >= from && season <= to);

export function audit() {
  const gaps = new Map(); // "CODE" -> { code, since, seasons:Set, cards:[] }

  for (const setId of SEASON_SETS) {
    for (const card of CARD_SETS[setId] ?? []) {
      if (!Number.isFinite(card.season)) continue;
      // The card's printed key. WNBA codes are not canonicalized and have their
      // own historical table, so only NBA franchises are checked here.
      const code = canonicalTeam(String(card.team ?? '').replace(/\d+$/, ''));
      const base = Object.keys(IDENTITY_SINCE).find(
        c => c === code || franchiseForSeason(c, card.season) === card.team
      );
      if (!base) continue;
      const since = IDENTITY_SINCE[base];
      // Wrong only if the card ended up on the CURRENT key for an older season.
      if (card.team !== base) continue;
      if (card.season >= since) continue;
      if (inAnyEra(base, card.season)) continue;

      if (!gaps.has(base)) gaps.set(base, { code: base, since, seasons: new Set(), cards: [] });
      const g = gaps.get(base);
      g.seasons.add(card.season);
      g.cards.push({ set: setId, name: card.name, season: card.season, label: card.seasonLabel });
    }
  }

  return [...gaps.values()]
    .map(g => ({
      ...g,
      seasons: [...g.seasons].sort((a, b) => a - b),
      team: getTeam(g.code, { league: 'NBA' }),
    }))
    .sort((a, b) => b.cards.length - a.cards.length);
}

export function main({ log = console.log, showCards = false } = {}) {
  const gaps = audit();
  const total = gaps.reduce((n, g) => n + g.cards.length, 0);

  if (gaps.length === 0) {
    log('No card wears a modern mark on a season that predates it.');
    return { gaps, total };
  }

  log(`${total} card(s) across ${gaps.length} franchise(s) print TODAY'S mark on an older season.\n`);
  log('CODE  CURRENT SINCE  CARDS  SEASONS NEEDING A MARK');
  for (const g of gaps) {
    const span = `${Math.min(...g.seasons)}-${Math.max(...g.seasons)}`;
    log(
      `${g.code.padEnd(5)} ${String(g.since).padStart(13)} ${String(g.cards.length).padStart(6)}  ${span}` +
        `  (${g.team?.city} ${g.team?.name})`
    );
    if (showCards) {
      for (const c of g.cards.sort((a, b) => a.season - b.season)) {
        log(`        ${c.label ?? c.season}  ${c.name}  [${c.set}]`);
      }
    }
  }
  // The SEASONS are reported, not a span. Where one identity ended and the next
  // began is a fact about the franchise, not something this data knows — Utah's
  // eight cards straddle three different Jazz looks — so naming a single
  // "2002-2022" range here would be inventing the answer the request is for.
  log('\nEach gap needs a logo file and a colourway. Seasons actually carded:');
  for (const g of gaps) {
    log(`  ${g.code}: ${g.seasons.join(', ')}   (current mark dates from ${g.since})`);
  }

  fs.writeFileSync(
    path.join(REPO_ROOT, 'card-data', 'generated', 'era-mark-gaps.json'),
    `${JSON.stringify({ generatedAt: new Date().toISOString(), total, gaps }, null, 1)}\n`
  );
  return { gaps, total };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main({ showCards: process.argv.includes('--cards') });
}
