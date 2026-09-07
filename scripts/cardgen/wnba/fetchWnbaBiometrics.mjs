// HEIGHT AND WEIGHT FOR EVERY WNBA PLAYER A CARD IS BUILT FROM.
//
//   node scripts/cardgen/wnba/fetchWnbaBiometrics.mjs           # carded players
//   node scripts/cardgen/wnba/fetchWnbaBiometrics.mjs --pool    # everyone cardable
//   node scripts/cardgen/wnba/fetchWnbaBiometrics.mjs --limit 60
//
// ── WHY THIS EXISTS, AND WHY IT NEARLY DID NOT ──────────────────────────────
//
// Speed and Power split a card's budget on SIZE: guards skew Speed, bigger
// players skew Power. The NBA sets take that from real biometrics. I looked for
// the WNBA equivalent, found no height or weight in any SEASON TABLE or on the
// per-letter player index, concluded it would cost a fetch per player, and
// built a proxy out of the box score instead (see bigness.js).
//
// The user pointed out that it is printed at the top of every player page. It
// is:  "6-1, 167lb (185cm, 75kg)".  One fetch per player is the honest price
// for the real number, and 135 carded players is twenty minutes of polite
// requests — which is not expensive, it just is not free.
//
// ── WHAT IT PARSES, AND WHY THE METRIC PAIR ────────────────────────────────
//
// The page prints both "6-1, 167lb" and "(185cm, 75kg)". This reads the METRIC
// pair and converts, because it is one unambiguous number each: the imperial
// height is two fields joined by a hyphen that also appears in ranges elsewhere
// on the page, and a player listed without a weight still prints the height, so
// a combined pattern silently matches the wrong thing. Centimetres and
// kilograms are single integers with a unit attached.
//
// ── ONE PLAYER PER CACHE ENTRY ─────────────────────────────────────────────
//
// So a re-run costs nothing for anyone already fetched, an interrupted run
// resumes, and a player whose page 404s does not poison the rest.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  REPO_ROOT, readCache, writeCache, politeDelay, DEFAULT_REQUEST_SPACING_MS,
} from '../cache.js';
import { readSeason } from './fetchWnba.js';
import { archivedSeasons } from './fetchWnbaHistory.js';
import { joinWnbaSeason } from './pool.js';
import { WNBA_SEASON } from './constants.js';
import { CARD_SETS } from '../../../src/game/cardSets.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const OUTPUT_FILE = path.join(GEN_DIR, 'wnba-biometrics.json');
const cacheKey = id => `wnba-bio-${id}`;

/** The pool cut a card is built from, so `--pool` fetches nobody unusable. */
const MIN_MPG = 16;
const MIN_GAMES = 20;

/**
 * Height in inches and weight in pounds, from a player page.
 *
 * Reads the metric pair and converts — see the note at the top of the file.
 * Returns nulls rather than throwing: a page that renders without a listed
 * height is a real thing (a few early players have none) and must not stop a
 * run, it must just be recorded as unknown.
 */
export function parseWnbaBio(html) {
  const m = String(html ?? '').match(/\((\d{3})cm,&nbsp;(\d{2,3})kg\)/);
  if (!m) return { inches: null, weight: null };
  const cm = Number(m[1]);
  const kg = Number(m[2]);
  return {
    inches: Number((cm / 2.54).toFixed(1)),
    weight: Number((kg * 2.2046226).toFixed(1)),
    cm,
    kg,
  };
}

export async function fetchWnbaBio(playerId, { fetchImpl = fetch } = {}) {
  const url = `https://www.basketball-reference.com/wnba/players/${playerId[0]}/${playerId}.html`;
  const res = await fetchImpl(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Basketball-Reference WNBA bio failed: ${res.status} (${playerId})`);
  return parseWnbaBio(await res.text());
}

/** Every player a WNBA card is currently built from. */
function cardedIds() {
  const ids = new Set();
  for (const set of ['wnba', 'wnba-super-season', 'wnba-rookie', 'wnba-team-rewards']) {
    for (const card of CARD_SETS[set] ?? []) if (card.bbrefId) ids.add(card.bbrefId);
  }
  return [...ids];
}

/** Everyone who has ever cleared the card threshold, for the wider baseline. */
function poolIds() {
  const ids = new Set();
  for (const season of [...archivedSeasons(), 2025, WNBA_SEASON]) {
    const tables = readSeason(season);
    if (!tables) continue;
    for (const row of joinWnbaSeason({ season, ...tables })) {
      if (!row.playerId) continue;
      if ((row.mpg ?? 0) < MIN_MPG || (row.games ?? 0) < MIN_GAMES) continue;
      ids.add(row.playerId);
    }
  }
  return [...ids];
}

export async function main({ log = console.log, pool = false, limit = Infinity } = {}) {
  const ids = pool ? poolIds() : cardedIds();
  const todo = ids.filter(id => !readCache(cacheKey(id))).slice(0, limit);
  log(`${ids.length} player(s) wanted, ${ids.length - todo.length} already cached, ${todo.length} to fetch.`);

  let ok = 0;
  let missing = 0;
  for (const [i, id] of todo.entries()) {
    if (i > 0) await politeDelay(DEFAULT_REQUEST_SPACING_MS);
    try {
      const bio = await fetchWnbaBio(id);
      writeCache(cacheKey(id), bio, {
        meta: { source: 'basketball-reference.com', kind: 'wnba-bio', playerId: id },
      });
      if (bio.inches === null) missing += 1; else ok += 1;
    } catch (e) {
      log(`  FAILED ${id}: ${e.message}`);
    }
    if ((i + 1) % 25 === 0) log(`  ${i + 1}/${todo.length}…`);
  }
  log(`fetched ${ok} with a listed size, ${missing} without.`);

  // ── the index the generators read ────────────────────────────────────────
  const bios = {};
  for (const id of ids) {
    const cached = readCache(cacheKey(id));
    const bio = cached?.data ?? cached;
    if (bio && Number.isFinite(bio.inches)) bios[id] = { inches: bio.inches, weight: bio.weight };
  }
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(
    OUTPUT_FILE,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), source: 'basketball-reference.com', count: Object.keys(bios).length, bios }, null, 1)}\n`
  );
  log(`${Object.keys(bios).length} player(s) with a size -> ${path.relative(REPO_ROOT, OUTPUT_FILE)}`);
  return bios;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const limitArg = args.indexOf('--limit');
  await main({
    pool: args.includes('--pool'),
    limit: limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity,
  });
}
