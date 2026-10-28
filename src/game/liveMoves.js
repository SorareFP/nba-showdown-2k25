// THE LIVE SERIES TABLE (2026-10-28; the user: "a live series dashboard that
// shows how players' card details have changed over time"). Every Live card
// against the night its window opens, from the history the nightly job keeps
// (card-data/generated/live-history.json, scripts/cardgen/liveHistory.js):
// today's numbers, then's, the move, the salary night by night, and the chart
// both ways. LiveMovers.jsx draws it.
import { getPlayerRarity, RARITY_ORDER } from './rarity.js';
import { LIVE_WINDOWS, anchorIndex } from './liveWindows.js';

export { LIVE_WINDOWS, anchorIndex };

/** The numbers a row compares, in the table's order. */
export const MOVE_FIELDS = ['salary', 'speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost'];
const HISTORY_FIELDS = [...MOVE_FIELDS, 'games'];

const nowOf = card => ({
  ...Object.fromEntries(MOVE_FIELDS.map(f => [f, card[f] ?? 0])),
  games: card.live?.games?.real ?? 0,
  chart: card.chart ?? [],
});
const unpackChart = packed => packed.map(([lo, hi, pts, reb, ast]) => ({ lo, hi, pts, reb, ast }));

/**
 * One row per card: `now` is the card as it stands, `then` the window's first
 * night — or the card's own first night, for a player who joined after the
 * window opened. A card the history has never seen shows no move. A night
 * whose chart was not kept compares the chart against itself.
 */
export function moveRows(history, cards, windowKey) {
  const nights = history?.nights ?? [];
  const fields = history?.fields ?? HISTORY_FIELDS;
  const salaryAt = fields.indexOf('salary');
  const start = anchorIndex(nights, windowKey);
  return cards.map(card => {
    const now = nowOf(card);
    const kept = history?.players?.[card.id];
    const rows = kept?.rows ?? [];
    let at = -1;
    for (let i = start; i < rows.length; i += 1) if (rows[i]) { at = i; break; }
    const then = at < 0 ? now : {
      ...Object.fromEntries(fields.map((f, i) => [f, rows[at][i]])),
      chart: kept.charts?.[at] ? unpackChart(kept.charts[at]) : now.chart,
    };
    const line = at < 0 ? [] : rows.slice(at).filter(Boolean).map(r => r[salaryAt]);
    if (line.at(-1) !== now.salary) line.push(now.salary);
    return {
      id: card.id,
      key: `${card.set ?? 'live'}:${card.id}`,
      card,
      now,
      then,
      delta: Object.fromEntries(MOVE_FIELDS.map(f => [f, (now[f] ?? 0) - (then[f] ?? 0)])),
      line,
      since: at < 0 ? null : nights[at],
      rarityThen: getPlayerRarity({ salary: then.salary }),
      rarityNow: getPlayerRarity(card),
    };
  });
}

const payAt = (chart, roll) => chart.find(t => roll >= t.lo && roll <= t.hi);

/**
 * Today's chart, each cell marked 'up' or 'down' against what the same roll
 * paid then — compared roll for roll, since the rows themselves move — and
 * each row marked `moved` when its range is not one the old chart had.
 */
export function chartChanges(thenChart, nowChart) {
  return nowChart.map(tier => {
    const was = payAt(thenChart, tier.lo);
    const cell = k => (!was || was[k] === tier[k] ? null : tier[k] > was[k] ? 'up' : 'down');
    return {
      tier,
      moved: !thenChart.some(o => o.lo === tier.lo && o.hi === tier.hi),
      cells: { pts: cell('pts'), reb: cell('reb'), ast: cell('ast') },
    };
  });
}

/** A column's gain: a lower shot line is the better one, and rarity moves by its band. */
function gainOf(row, key) {
  if (key === 'rarity') return RARITY_ORDER.indexOf(row.rarityNow) - RARITY_ORDER.indexOf(row.rarityThen);
  const d = row.delta[key] ?? 0;
  return key === 'shotLine' ? -d : d;
}

/**
 * `{ key, dir }`: the player column by name; any other by its move — 'up' the
 * biggest gains first, 'down' the biggest drops, 'abs' the biggest either way
 * (how the table opens, on salary). Ties go to the richer card, then the name.
 */
export function sortMoves(rows, { key, dir }) {
  const byName = (a, b) => a.card.name.localeCompare(b.card.name);
  const tie = (a, b) => (b.now.salary - a.now.salary) || byName(a, b);
  const score = key === 'name' ? null
    : dir === 'abs' ? r => Math.abs(gainOf(r, key))
      : dir === 'down' ? r => -gainOf(r, key)
        : r => gainOf(r, key);
  const cmp = score ? (a, b) => (score(b) - score(a)) || tie(a, b)
    : dir === 'down' ? (a, b) => byName(b, a) : byName;
  return [...rows].sort(cmp);
}

/** A header click: a new column starts at its gains, the same column flips. */
export const nextSort = (sort, key) => (sort.key !== key ? { key, dir: 'up' } : { key, dir: sort.dir === 'up' ? 'down' : 'up' });

const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** The search (a name or a team) and "Only my cards". */
export function filterMoves(rows, { query = '', onlyMine = false, owned = null } = {}) {
  const q = fold(query.trim());
  return rows.filter(r => (!onlyMine || owned?.has(r.key))
    && (!q || fold(r.card.name).includes(q) || fold(r.card.team).includes(q)));
}
