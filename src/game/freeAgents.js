// FREE AGENTS: requested cards. The pieces the site and the server share.
// The design is docs/plans/2026-09-10-free-agents-design.md.
//
// A player asks for any archived player-season. The quote they see (salary,
// rarity, price) comes from the precomputed index that
// scripts/cardgen/freeAgentQuotes.js writes: the card generator cannot run
// inside the site. Signing the card costs its PRICE, the user's rule
// (2026-09-10): "between the rarity price table and the pack-odds cost", at
// 20% toward pack odds.
import { PACK_WEIGHTS, MARKET_PRICES, getPlayerRarity } from './rarity.js';
import { PACK_TYPES } from './packEngine.js';
import { CARD_SETS, BASE_SET } from './cardSets.js';
import { normName, isNeverCard, searchHitsNeverCard, AUTO_REJECT_MESSAGE } from './neverCard.js';

export { normName, isNeverCard, searchHitsNeverCard, AUTO_REJECT_MESSAGE };

/** How far the price leans from the rarity table toward the pack-odds cost. */
export const FA_PACK_WEIGHT = 0.2;
/** Requests one player may have waiting at once. */
export const OPEN_REQUEST_LIMIT = 3;

/**
 * Where a requested card can land. Classification is automatic:
 * playoffs → Standouts, first season → Rookie, best season → Super Season,
 * anything else → Throwbacks. `pack` is the set's own targeted pack; every
 * set is also reachable through the booster.
 */
export const FREE_AGENT_SETS = {
  'summer-standouts': { label: 'Summer Standouts', pack: 'standouts' },
  rookie: { label: 'Rookie', pack: 'rookie_pack' },
  'super-season': { label: 'Super Season', pack: 'super_season' },
  throwbacks: { label: 'Throwbacks', pack: null },
};

/** Chance one pull lands on ONE new card of `rarity` added to `pool` (collectionDifficulty's model). */
function perPull(pool, rarity) {
  const size = {};
  for (const card of pool) {
    const r = getPlayerRarity(card);
    size[r] = (size[r] ?? 0) + 1;
  }
  size[rarity] = (size[rarity] ?? 0) + 1;
  const live = Object.keys(size).reduce((t, r) => t + PACK_WEIGHTS[r], 0);
  return PACK_WEIGHTS[rarity] / live / size[rarity];
}

function packCost(pool, rarity, def) {
  const p = perPull(pool, rarity);
  return def.price / (1 - (1 - p) ** def.players);
}

/**
 * Expected coins to pull ONE specific new card of `rarity` in `set`, through
 * the cheapest pack that carries it: the set's own pack if it has one, or
 * the NBA Booster. The booster is measured over the base pool, a proxy for
 * a special card that competes inside a capped band.
 */
export function packOddsCost(set, rarity) {
  const routes = [[CARD_SETS[BASE_SET] ?? [], PACK_TYPES.nba_booster]];
  const own = FREE_AGENT_SETS[set]?.pack;
  if (own && PACK_TYPES[own] && CARD_SETS[set]) routes.push([CARD_SETS[set], PACK_TYPES[own]]);
  return Math.min(...routes.map(([pool, def]) => packCost(pool, rarity, def)));
}

/** What signing a requested card costs: the rarity table, leaned 20% toward pack odds. */
export function freeAgentPrice(set, rarity, w = FA_PACK_WEIGHT) {
  const table = MARKET_PRICES[rarity];
  if (!table) return null;
  const odds = packOddsCost(set, rarity);
  return Math.round(Math.exp((1 - w) * Math.log(table) + w * Math.log(odds)) / 10) * 10;
}

/**
 * One row of the quote index, read. The index stores it compactly:
 * `[bbrefId, name, season, kind, team, salary, set]`, where kind is
 * 'r' for a regular season and 'p' for a playoff run.
 */
export function readQuoteRow(row) {
  const [bbrefId, name, season, kind, team, salary, set] = row;
  const rarity = getPlayerRarity({ salary });
  return {
    bbrefId, name, season, playoffs: kind === 'p', team, salary, set, rarity,
    price: freeAgentPrice(set, rarity),
  };
}

// ── Requests ─────────────────────────────────────────────────────────────────

/** A request's life: asked, then answered (and, later, signed or gifted). */
export const REQUEST_STATUS = { requested: 'requested', rejected: 'rejected', invoiced: 'invoiced', signed: 'signed', gifted: 'gifted' };
export const REJECT_REASON_MAX = 200;
/** One-tap reasons in the Studio; any other text works too. */
export const QUICK_REJECT_REASONS = ['Not enough of a season to card.', "That one doesn't make sense.", "Not one we're going to make."];

export const quoteKey = (bbrefId, season, playoffs) => `${bbrefId}|${season}|${playoffs ? 'p' : 'r'}`;

/** The quote index by quoteKey: how the server finds the row it prices from. */
export function indexQuotes(rows) {
  const out = new Map();
  for (const row of rows) out.set(quoteKey(row[0], row[2], row[3] === 'p'), row);
  return out;
}

/** "1987-88" for a regular season, "1988 playoffs" for a run. */
export function seasonText({ season, playoffs }) {
  return playoffs ? `${season} playoffs` : `${season - 1}-${String(season % 100).padStart(2, '0')}`;
}

/** The index rows with their names normalized once, for the search box. */
export function prepareSearch(rows) {
  return rows.map(row => ({ row, n: normName(row[1]) }));
}

/**
 * Players whose name contains the search text, each with every quotable
 * season, earliest first. A name that STARTS with the text ranks first.
 */
export function searchQuotes(prepared, text, { limit = 12 } = {}) {
  const q = normName(text);
  if (q.length < 3) return [];
  const byPlayer = new Map();
  for (const { row, n } of prepared) {
    if (!n.includes(q)) continue;
    if (!byPlayer.has(row[0])) byPlayer.set(row[0], { bbrefId: row[0], name: row[1], starts: n.startsWith(q), seasons: [] });
    byPlayer.get(row[0]).seasons.push(readQuoteRow(row));
  }
  return [...byPlayer.values()]
    .sort((a, b) => Number(b.starts) - Number(a.starts) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(p => ({ ...p, seasons: p.seasons.sort((x, y) => x.season - y.season || Number(x.playoffs) - Number(y.playoffs)) }));
}

/**
 * May this request be made? The server's rule, shared so the form can say
 * the same thing. `row` is the quote row (or null), `openCount` the player's
 * waiting requests, `alreadyAsked` whether one of them is this very card.
 */
export function checkRequest({ row, openCount = 0, alreadyAsked = false }) {
  if (row && isNeverCard(row[1])) return { ok: false, code: 'auto-rejected', msg: AUTO_REJECT_MESSAGE };
  if (!row) return { ok: false, code: 'not-found', msg: 'That season is not in the archive, or it already has a card.' };
  if (alreadyAsked) return { ok: false, code: 'already-exists', msg: 'You have already asked for that card.' };
  if (openCount >= OPEN_REQUEST_LIMIT) {
    return { ok: false, code: 'resource-exhausted', msg: `You already have ${OPEN_REQUEST_LIMIT} requests waiting. One has to be answered first.` };
  }
  return { ok: true };
}
