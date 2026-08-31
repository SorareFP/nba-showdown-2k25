// Basketball-Reference game-log source adapter.
//
// NOTE ON TABLE STRUCTURE: the table's id used to be assumed as "pgl_basic"
// (per older docs/tooling), but as of this writing (verified 2026-08-28 by
// fetching a real page) Basketball-Reference's game-log table is
// `<table id="player_game_log_reg">` inside `<div id="div_player_game_log_reg">`
// — NOT `pgl_basic`. The per-cell `data-stat` attributes we rely on here
// (`mp`, `pts`, `trb`, `ast`) were confirmed against the live markup at
// https://www.basketball-reference.com/players/j/jokicni01/gamelog/2024
// A trimmed excerpt of that real page is saved as
// scripts/cardgen/sources/__fixtures__/sample-gamelog.html.
//
// Games the player did not play (inactive, did-not-dress, suspended, etc.)
// are rendered by Basketball-Reference as a row with class="partial_table"
// where the normal stat cells are collapsed into a single
// `<td data-stat="is_starter" colspan="26">Inactive</td>`-style cell — there
// is no `data-stat="mp"` cell at all on those rows. We treat "no mp cell, or
// an empty mp cell" as the signal to skip a row.

const MINUTES_STAT = 'mp';
const STAT_MAP = { pts: 'pts', reb: 'trb', ast: 'ast' };

// The full gamelog page (fetchGameLog hits .../gamelog/{season}, which
// Basketball-Reference renders with BOTH tables present) also contains a
// separate `<table id="player_game_log_post">` for playoff games. If we
// naively scanned the whole page for <tr> rows, a playoff team's games would
// get blended into the "regular season" result. So we scope parsing to just
// the regular-season table before extracting rows.
const REG_SEASON_TABLE_ID = 'player_game_log_reg';

/**
 * Isolates the `<tbody>...</tbody>` of `<table id="player_game_log_reg">` from a full page
 * (or a fixture that already *is* just that table's markup, id attribute included).
 *
 * We isolate `<tbody>` specifically, not the whole `<table>...</table>`: the table also has
 * a `<tfoot>` with a season-totals row that (like a real game row) has a non-empty
 * `data-stat="mp"` cell, so scoping to just the table would let that summary row slip through
 * and get counted as an extra "game".
 *
 * Deliberately throws rather than falling back to parsing the unscoped input when any expected
 * landmark is missing: this ran into exactly this failure mode once already during development
 * (Basketball-Reference's table id turned out to be `player_game_log_reg`, not the `pgl_basic`
 * older docs/tooling assumed), and a silent fallback would let a future markup change either
 * quietly drop a player from a 300+-player batch (empty result) or, worse, quietly blend
 * regular-season and playoff rows together — both wrong-data failures with no visible signal.
 * A loud throw on the first player where the site structure doesn't match is far preferable.
 */
function isolateRegSeasonTable(html) {
  const idAttr = `id="${REG_SEASON_TABLE_ID}"`;
  const idIndex = html.indexOf(idAttr);
  if (idIndex === -1) {
    throw new Error(
      `parseGameLogHtml: could not find ${idAttr} in the input HTML — Basketball-Reference's ` +
        'game-log table structure may have changed again; verify against a live page before ' +
        'assuming the site is just temporarily unreachable.'
    );
  }

  const tbodyStart = html.indexOf('<tbody', idIndex);
  if (tbodyStart === -1) {
    throw new Error(
      `parseGameLogHtml: found ${idAttr} but no following <tbody> — table markup around the ` +
        'regular-season game log has changed shape.'
    );
  }

  const tbodyEndTagIndex = html.indexOf('</tbody>', tbodyStart);
  if (tbodyEndTagIndex === -1) {
    throw new Error(
      `parseGameLogHtml: found <tbody> after ${idAttr} but no matching </tbody> — input HTML ` +
        'may be truncated.'
    );
  }

  return html.slice(tbodyStart, tbodyEndTagIndex + '</tbody>'.length);
}

function extractCell(rowHtml, stat) {
  // Matches `<td ... data-stat="STAT" ...>VALUE</td>`. Attribute order
  // around data-stat varies row to row, so we don't anchor on position.
  // Deliberately `<td>` only (not `<th>`): the repeated header rows
  // Basketball-Reference inserts down the table use `<th data-stat="mp">MP</th>`
  // for the same data-stat name, and restricting to `<td>` is what lets us
  // tell a real data row apart from a header row without a separate check.
  const re = new RegExp(`<td[^>]*data-stat="${stat}"[^>]*>([^<]*)</td>`);
  const match = rowHtml.match(re);
  return match ? match[1].trim() : null;
}

/** Splits a table's <tbody> markup into individual <tr>...</tr> row strings. */
function extractRows(html) {
  const rows = [];
  const re = /<tr\b[^>]*>[\s\S]*?<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    rows.push(m[0]);
  }
  return rows;
}

/**
 * Parses Basketball-Reference's game-log table HTML into normalized rows.
 * Skips header rows (repeated `class="thead"` rows Basketball-Reference
 * inserts periodically down the table) and games the player didn't play
 * (no minutes-played cell).
 */
export function parseGameLogHtml(html) {
  const regSeasonTableHtml = isolateRegSeasonTable(html);
  const rows = extractRows(regSeasonTableHtml);
  const games = [];

  for (const row of rows) {
    const minutes = extractCell(row, MINUTES_STAT);
    if (!minutes) continue; // header row, DNP/inactive row, or footer row

    const pts = extractCell(row, STAT_MAP.pts);
    const reb = extractCell(row, STAT_MAP.reb);
    const ast = extractCell(row, STAT_MAP.ast);
    if (pts === null || reb === null || ast === null) continue;

    games.push({
      minutes,
      pts: Number(pts),
      reb: Number(reb),
      ast: Number(ast),
    });
  }

  return games;
}

/** Fetches and parses a player's game log for a given end-year season (e.g. 2024 = 2023-24). */
export async function fetchGameLog(playerId, season) {
  const res = await fetch(
    `https://www.basketball-reference.com/players/${playerId[0]}/${playerId}/gamelog/${season}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) throw new Error(`Basketball-Reference fetch failed: ${res.status}`);
  return parseGameLogHtml(await res.text());
}

// ---------------------------------------------------------------------------
// Season-level stat tables.
//
// Separate from the game log above because they answer a different question:
// the game log gives one player's DISTRIBUTION, these give every player's
// season MEAN. Both are needed — see scripts/cardgen/variance.js, which fits
// the first onto the second.
//
// Why Basketball-Reference for this at all, when dunksandthrees has richer
// per-100 data: only dunksandthrees' CURRENT season is public. Every fit that
// looks BACKWARD — anything calibrated against the finished 2025-26 card set,
// whose stats are the 2024-25 season — has to read a prior season, and this is
// the source that serves one.
//
// The four tables share one markup shape (`<table id="{kind}">` with
// `data-stat` cells), so one parser covers them. `data-append-csv` on the name
// cell carries Basketball-Reference's own player id, which is the key the game
// log is fetched by.
// ---------------------------------------------------------------------------

/**
 * The season tables this module knows how to ask for.
 *
 * `slug` is the URL segment, `tableId` is the `<table id>` on the page — and
 * they are NOT the same string for every table (`NBA_2025_per_game.html` holds
 * `<table id="per_game_stats">`, while `per_poss` and `advanced` both match
 * their slug). Verified against live pages 2026-08-29; assuming they matched is
 * exactly the failure this shape exists to prevent.
 *
 * ── PLAY-BY-PLAY, AND WHY IT IS HERE ───────────────────────────────────────
 *
 * `NBA_{season}_play-by-play.html` holds `<table id="pbp_stats">` — a THIRD
 * spelling, and one that shares no substring with its slug. It is the only page
 * on the site that answers "what share of his minutes did this player spend at
 * each position", under an over-header group `header_pos_estimates`:
 *
 *     pct_1 = PG%   pct_2 = SG%   pct_3 = SF%   pct_4 = PF%   pct_5 = C%
 *
 * The page also carries `<table id="pbp_stats_post">` for the playoffs.
 * `isolateTableBody` matches on `id="pbp_stats"` INCLUDING the closing quote,
 * so the regular-season table is picked and the playoff one cannot be reached
 * by accident — the same discipline the game-log parser applies.
 *
 * Verified live 2026-08-31 for 2026, 2004 and 1997: the group exists in all
 * three, every body row carries all five cells, and no cell is ever blank.
 */
export const SEASON_TABLES = {
  perGame: { slug: 'per_game', tableId: 'per_game_stats' },
  perPoss: { slug: 'per_poss', tableId: 'per_poss' },
  advanced: { slug: 'advanced', tableId: 'advanced' },
  playByPlay: { slug: 'play-by-play', tableId: 'pbp_stats' },
};

/**
 * The five `data-stat` names of the Position Estimate group, in position order.
 *
 * Spelled out rather than generated from an index so that a reader who has the
 * page open can check the mapping without counting columns — `pct_1` is PG and
 * `pct_5` is C, which is only obvious once someone has looked.
 */
export const POSITION_ESTIMATE_STATS = {
  PG: 'pct_1',
  SG: 'pct_2',
  SF: 'pct_3',
  PF: 'pct_4',
  C: 'pct_5',
};

function isolateTableBody(html, tableId) {
  const idAttr = `id="${tableId}"`;
  const idIndex = html.indexOf(idAttr);
  if (idIndex === -1) {
    throw new Error(`parseSeasonTableHtml: no ${idAttr} in the input HTML`);
  }
  const tbodyStart = html.indexOf('<tbody', idIndex);
  const tbodyEnd = html.indexOf('</tbody>', tbodyStart);
  if (tbodyStart === -1 || tbodyEnd === -1) {
    throw new Error(`parseSeasonTableHtml: no <tbody> for ${idAttr}`);
  }
  return html.slice(tbodyStart, tbodyEnd + '</tbody>'.length);
}

/**
 * Every `data-stat` cell in a row, as strings.
 *
 * Reads `<th>` as well as `<td>` here (unlike the game-log parser): on the
 * season tables the player-name cell is a `<th>`, and it is the one cell we
 * cannot do without. Repeated header rows are excluded by the caller instead,
 * on the absence of a `data-append-csv` player id.
 */
function parseRowCells(rowHtml) {
  const cells = {};
  const re = /<(?:td|th)[^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/(?:td|th)>/g;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    cells[m[1]] = m[2].replace(/<[^>]*>/g, '').trim();
  }
  return cells;
}

/**
 * Parses one of the season tables into `{ playerId, name, cells }` records.
 *
 * Values stay strings: the three tables disagree about which columns exist and
 * a caller that knows which table it asked for is better placed to coerce than
 * a parser that does not.
 */
export function parseSeasonTableHtml(html, tableId) {
  const body = isolateTableBody(html, tableId);
  const rows = extractRows(body);
  const out = [];
  for (const row of rows) {
    const idMatch = row.match(/data-append-csv="([^"]+)"/);
    if (!idMatch) continue; // repeated header row, or a league-average footer
    const cells = parseRowCells(row);
    const name = cells.name_display ?? cells.player;
    if (!name) continue;
    out.push({ playerId: idMatch[1], name, cells });
  }
  return out;
}

/** Fetches and parses one season table. `season` is the END year (2025 = 2024-25). */
export async function fetchSeasonTable(season, kind, { fetchImpl = fetch } = {}) {
  const table = SEASON_TABLES[kind];
  if (!table) throw new Error(`fetchSeasonTable: unknown table kind ${JSON.stringify(kind)}`);
  const res = await fetchImpl(
    `https://www.basketball-reference.com/leagues/NBA_${season}_${table.slug}.html`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) throw new Error(`Basketball-Reference fetch failed: ${res.status}`);
  return parseSeasonTableHtml(await res.text(), table.tableId);
}
