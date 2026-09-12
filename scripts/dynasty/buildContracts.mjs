/**
 * REAL NBA CONTRACTS, for the dynasty's own-team start.
 *
 * The user (2026-09-12): "If a player just uses normal rosters/brings their
 * team in, all players come in on their current contracts, Wemby included,
 * and there is no signing period... Players who need to be re-signed or are
 * free agents should ask for what their card is worth." So this file is only
 * about the deal a player ARRIVES on; every negotiation still prices the card.
 *
 * SOURCE: basketball-reference.com/contracts/{TEAM}.html — one row a player,
 * one column a season. Spotrac has the same numbers behind a block on
 * automated requests (403), and the two agree where the user checked them by
 * hand; this one can be regenerated, so it is the source.
 *
 *   node scripts/dynasty/buildContracts.mjs            (uses the cache)
 *   node scripts/dynasty/buildContracts.mjs --refresh  (re-fetches, 3s apart)
 *
 * Writes card-data/generated/dynasty-contracts.json:
 *   { generatedAt, capUsd, source, contracts: { [cardId]: { usd, years } } }
 */
import fs from 'node:fs';
import path from 'node:path';

const CACHE = process.env.CONTRACT_CACHE || path.join(process.cwd(), '.contract-cache');
const OUT = 'card-data/generated/dynasty-contracts.json';
// The 2025-26 cap, the season these contracts are keyed to.
const CAP_USD = 154647000;
const TEAMS = ['ATL','BOS','BRK','CHI','CHO','CLE','DAL','DEN','DET','GSW','HOU','IND','LAC','LAL','MEM','MIA','MIL','MIN','NOP','NYK','OKC','ORL','PHI','PHO','POR','SAC','SAS','TOR','UTA','WAS'];
const REFRESH = process.argv.includes('--refresh');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = t => Number(String(t).replace(/[^0-9]/g, '')) || 0;

fs.mkdirSync(CACHE, { recursive: true });

/** Every contract row Basketball-Reference lists, cached per team. */
async function rowsFor(team) {
  const file = path.join(CACHE, `${team}.html`);
  let html;
  if (!REFRESH && fs.existsSync(file)) html = fs.readFileSync(file, 'utf8');
  else {
    const res = await fetch(`https://www.basketball-reference.com/contracts/${team}.html`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) throw new Error(`${team}: HTTP ${res.status}`);
    html = await res.text();
    fs.writeFileSync(file, html);
    await sleep(3000);   // their robots.txt asks for three seconds
  }
  const out = [];
  const rowRe = /<tr[^>]*>\s*<th[^>]*data-stat="player"[^>]*>(.*?)<\/th>(.*?)<\/tr>/gs;
  let m;
  while ((m = rowRe.exec(html))) {
    const name = m[1].replace(/<[^>]*>/g, '').trim();
    if (!name || name === 'Player' || /Team Totals/i.test(name)) continue;
    // A non-guaranteed or option year is wrapped in <em>, so each cell is read
    // whole and stripped. Reading only to the first tag scored every such
    // player a zero and dropped them (Jay Huff, Michael Porter Jr.).
    // A non-guaranteed or option year is wrapped in <em>, so each cell is read
    // whole and stripped. Reading only to the first tag scored every such
    // player a zero and dropped them (Jay Huff, Michael Porter Jr.).
    const cellRe = new RegExp('data-stat="y([0-9])"[^>]*>(.*?)<' + '/td>', 'g');
    const years = [...m[2].matchAll(cellRe)].map(x => money(x[2].replace(/<[^>]*>/g, '')));
    if (!years.length || !years[0]) continue;
    // THE YEARS HE HAS LEFT ON *THIS* DEAL. The row runs a rookie contract
    // straight into the extension that follows it, which would have
    // Wembanyama on his rookie money for five years instead of one. A rise
    // of more than 40% from one season to the next is a new contract, not a
    // raise (a raise is 5-8%), so the count stops there.
    let left = 1;
    while (left < years.length && years[left] && years[left] <= years[left - 1] * 1.4) left += 1;
    out.push({ name, team, usd: years[0], years: left });
  }
  return out;
}

const rows = [];
for (const t of TEAMS) rows.push(...await rowsFor(t));

/**
 * DEALS THE SOURCE HAS NOT CAUGHT UP WITH, by card id.
 *
 * Basketball-Reference lists a contract once the season's books show it, so a
 * player who signed after that reads as a free agent and would arrive at card
 * value. That fallback is fine (the user, 2026-09-12: "card value is a
 * perfectly fine fallback") — this is only for the ones worth being exact
 * about. `usd` is the season's salary; where only a total and a length are
 * known, the average is the honest estimate.
 *
 * Every entry needs a source in its note, and should be deleted once the
 * source carries the deal — a stale override outlives the contract it copies.
 */
const MANUAL = {
  Bennedict_Mathurin: {
    usd: 8000000, years: 2,
    note: 'signed with NOP for 2026-27: 2 years, $16.0M total ($8.0M average). From the Spotrac screenshot the user sent on 2026-09-12; BBRef had no row yet.',
  },
};

// MATCHING. Exact spelling first; only then the suffix-stripped form, and only
// when it is unambiguous — "LeBron James Jr." must never become LeBron James
// (the Gary Payton lesson).
const plain = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const stripped = s => plain(s).replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
const exact = new Map();
const loose = new Map();
for (const r of rows) {
  const k = plain(r.name);
  // Several rows for one player (an extension): the biggest current figure wins.
  if (!exact.has(k) || exact.get(k).usd < r.usd) exact.set(k, r);
  const s = stripped(r.name);
  if (!loose.has(s)) loose.set(s, []);
  loose.get(s).push(r);
}

const cards = JSON.parse(fs.readFileSync('card-data/generated/cards-2026-27.json', 'utf8'));
const list = Array.isArray(cards) ? cards : (cards.cards ?? Object.values(cards)[0]);
const contracts = {};
const missed = [];
const filled = [];
for (const c of list) {
  let hit = exact.get(plain(c.name));
  if (!hit) {
    const near = loose.get(stripped(c.name)) ?? [];
    if (near.length === 1) [hit] = near;            // unambiguous only
  }
  if (!hit) {
    const manual = MANUAL[c.id];
    if (manual) {
      contracts[c.id] = { usd: manual.usd, years: Math.max(1, Math.min(5, manual.years)), manual: true, note: manual.note };
      filled.push(c.name);
    } else missed.push(c.name);
    continue;
  }
  contracts[c.id] = { usd: hit.usd, years: Math.max(1, Math.min(5, hit.years)) };
}

fs.writeFileSync(OUT, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  capUsd: CAP_USD,
  source: 'basketball-reference.com/contracts (one row a player, first season column)',
  note: 'The deal a player ARRIVES on in an own-team start. Negotiations price the card, not this.',
  contracts,
}, null, 1)}\n`);

console.log(`rows ${rows.length} · matched ${Object.keys(contracts).length}/${list.length} (${(Object.keys(contracts).length / list.length * 100).toFixed(1)}%)`);
if (filled.length) console.log(`filled by hand (${filled.length}): ${filled.join(', ')}`);
console.log(`no contract, so card value (${missed.length}): ${missed.slice(0, 20).join(', ')}`);
