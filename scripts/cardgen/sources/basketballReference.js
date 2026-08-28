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
 * (or a fixture that already *is* just that table's tbody — in which case, since there's
 * no further `id="player_game_log_reg"` to find, this falls back to the whole input).
 *
 * We isolate `<tbody>` specifically, not the whole `<table>...</table>`: the table also has
 * a `<tfoot>` with a season-totals row that (like a real game row) has a non-empty
 * `data-stat="mp"` cell, so scoping to just the table would let that summary row slip through
 * and get counted as an extra "game".
 */
function isolateRegSeasonTable(html) {
  const idAttr = `id="${REG_SEASON_TABLE_ID}"`;
  const idIndex = html.indexOf(idAttr);
  if (idIndex === -1) return html; // not found — fall back to parsing whatever we were given

  const tbodyStart = html.indexOf('<tbody', idIndex);
  if (tbodyStart === -1) return html;

  const tbodyEndTagIndex = html.indexOf('</tbody>', tbodyStart);
  if (tbodyEndTagIndex === -1) return html;

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
