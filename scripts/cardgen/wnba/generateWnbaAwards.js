/**
 * Award marks for the three WNBA sets — the data gap, closed.
 *
 *   node scripts/cardgen/wnba/generateWnbaAwards.js
 *
 * Basketball-Reference serves the WNBA's awards nothing like the NBA's: there
 * is no awards column on any season table. What exists instead is a VOTING
 * PAGE per season (/wnba/awards/awards_{year}.html) with one table per award,
 * where the rank-1 row is the winner and carries the same player id the
 * archive keys on. The champion is not there either; the season page's
 * playoff bracket names the Finals winner by TEAM NAME, which the team tables
 * map back to an abbreviation.
 *
 * FIVE AWARDS AND THE RING. MVP, ROY, DPOY, MIP map to their NBA codes; the
 * Sixth Woman of the Year prints through the 6MOY mark, which is the same
 * fact in the other league's spelling. The ring is a JERSEY fact exactly as
 * the NBA sets have it: a card wears it only when its (era-resolved) team is
 * the season's champion. All-Star selections are NOT here yet — they live on
 * per-season All-Star pages that would double the polite fetch count, and the
 * five awards plus the ring carry the sets' story; noted as the remaining gap.
 *
 * Writes card-data/generated/wnba-card-awards.json in card-awards.json's
 * `sets` shape, which the studio merges alongside the NBA file.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { cached, CACHE_DIR, politeDelay, DEFAULT_REQUEST_SPACING_MS, REPO_ROOT } from '../cache.js';
import { wnbaFranchiseForSeason } from '../../../src/cards/teams.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'wnba-card-awards.json');

/** award-table id on the voting page -> the card mark it prints. */
const AWARD_TABLES = {
  mvp: 'MVP',
  roy: 'ROY',
  dpoy: 'DPOY',
  // The Sixth Woman of the Year, through the sixth-man mark: the same fact in
  // the other league's spelling.
  swoy: '6MOY',
  mip: 'MIP',
};

const AWARDS_CACHE_KEY = season => `wnba-${season}-awards-page`;
const CHAMPION_CACHE_KEY = season => `wnba-${season}-champion`;

async function fetchHtml(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return (await res.text()).replace(/<!--|-->/g, '');
}

/** The rank-1 winner of each award table on one season's voting page. */
export function parseAwardWinners(html) {
  const winners = {};
  for (const [tableId, code] of Object.entries(AWARD_TABLES)) {
    const i = html.indexOf(`id="${tableId}"`);
    if (i === -1) continue;
    const tb = html.indexOf('<tbody', i);
    if (tb === -1) continue;
    const seg = html.slice(tb, tb + 3000);
    const row = seg.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/)?.[0];
    if (!row) continue;
    const id = row.match(/data-append-csv="([^"]+)"/)?.[1];
    const name = row
      .match(/data-stat="player"[^>]*>([\s\S]*?)<\/(?:td|th)>/)?.[1]
      ?.replace(/<[^>]*>/g, '')
      .trim();
    if (id) winners[code] = { playerId: id, name };
  }
  return winners;
}

/** The Finals winner on one season page, as a team abbreviation, or null. */
export function parseChampion(html) {
  // The plainest possible row walk — split on the row closer, take each
  // chunk's last <tr — because two regex-driven cuts of this parser failed in
  // ways that resisted diagnosis. The Finals row reads "<winner> over
  // <loser>", winner first, with SINGLE-quoted hrefs.
  const t = html.indexOf('id="all_playoffs"');
  if (t === -1) return null;
  const seg = html.slice(t, t + 8000);
  for (const chunk of seg.split('</tr>')) {
    const i = chunk.lastIndexOf('<tr');
    if (i === -1) continue;
    const row = chunk.slice(i);
    const text = row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text.startsWith('Finals')) continue;
    const href = row.match(/\/wnba\/teams\/([A-Z]{2,3})\//);
    return href ? href[1] : null;
  }
  return null;
}

async function loadSeasonAwards(season) {
  const body = await cached(AWARDS_CACHE_KEY(season), async () =>
    parseAwardWinners(await fetchHtml(`https://www.basketball-reference.com/wnba/awards/awards_${season}.html`)),
    { meta: { source: 'basketball-reference.com', season, kind: 'wnba-awards' } });
  return body?.data ?? body ?? {};
}

async function loadSeasonChampion(season) {
  const body = await cached(CHAMPION_CACHE_KEY(season), async () =>
    ({ abbr: parseChampion(await fetchHtml(`https://www.basketball-reference.com/wnba/years/${season}.html`)) }),
    { meta: { source: 'basketball-reference.com', season, kind: 'wnba-champion' } });
  const v = body?.data ?? body ?? {};
  return v.abbr ?? null;
}

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

export async function main({ log = console.log } = {}) {
  const setFiles = {
    wnba: 'cards-wnba.json',
    'wnba-rookie': 'cards-wnba-rookie.json',
    'wnba-super-season': 'cards-wnba-super-season.json',
  };
  const sets = {};
  const seasonsNeeded = new Set();
  const cardsBySet = {};
  for (const [set, file] of Object.entries(setFiles)) {
    const full = path.join(GEN_DIR, file);
    if (!fs.existsSync(full)) { log(`  ${set}: ${file} missing — skipped`); continue; }
    const body = readJson(full);
    cardsBySet[set] = body.cards ?? [];
    for (const card of cardsBySet[set]) {
      // The base WNBA set carries no season field; its stats season is the
      // reference year and its awards should be too.
      const season = Number.isFinite(card.season) ? card.season : body.referenceSeason ?? 2026;
      if (season >= 1997) seasonsNeeded.add(season);
    }
  }

  const awardsBySeason = new Map();
  const championBySeason = new Map();
  let fetched = 0;
  for (const season of [...seasonsNeeded].sort()) {
    const hadAwards = fs.existsSync(path.join(CACHE_DIR, `${AWARDS_CACHE_KEY(season)}.json`));
    try {
      awardsBySeason.set(season, await loadSeasonAwards(season));
    } catch (e) {
      // An in-progress season has no voting page yet; that is data, not error.
      awardsBySeason.set(season, {});
      log(`  ${season}: no awards page (${e.message.slice(0, 40)})`);
    }
    if (!hadAwards) { fetched += 1; await politeDelay(DEFAULT_REQUEST_SPACING_MS); }
    const hadChampion = fs.existsSync(path.join(CACHE_DIR, `${CHAMPION_CACHE_KEY(season)}.json`));
    try {
      championBySeason.set(season, await loadSeasonChampion(season));
    } catch {
      championBySeason.set(season, null);
    }
    if (!hadChampion) { fetched += 1; await politeDelay(DEFAULT_REQUEST_SPACING_MS); }
  }

  for (const [set, cards] of Object.entries(cardsBySet)) {
    const records = [];
    for (const card of cards) {
      const season = Number.isFinite(card.season) ? card.season : 2026;
      const winners = awardsBySeason.get(season) ?? {};
      const champion = championBySeason.get(season) ?? null;
      const awards = [];
      for (const [code, w] of Object.entries(winners)) {
        if (w.playerId === card.bbrefId) awards.push(code);
      }
      // The ring is a jersey fact, exactly as the NBA sets have it.
      if (champion && wnbaFranchiseForSeason(champion, season) === card.team) {
        awards.push('CHAMP');
      }
      if (awards.length) {
        records.push({ id: card.id, name: card.name, season, bbrefId: card.bbrefId, awards, champion: awards.includes('CHAMP') ? champion : null });
      }
    }
    sets[set] = records;
    log(`  ${set}: ${records.length} of ${cards.length} cards marked`);
  }

  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify({
    generatedAt: new Date().toISOString(),
    source:
      "Basketball-Reference's WNBA award voting pages (rank-1 rows) and each season page's " +
      'Finals result. All-Star selections are the remaining gap: they live on per-season ' +
      'All-Star pages this does not fetch yet.',
    declared: [...Object.values(AWARD_TABLES), 'CHAMP'],
    seasons: [...seasonsNeeded].sort(),
    sets,
  }, null, 1)}\n`);
  log(`Wrote ${OUTPUT_FILE} (${fetched} page fetches)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
