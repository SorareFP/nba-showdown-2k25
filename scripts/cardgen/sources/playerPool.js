// Basketball-Reference player-pool source: filters the league's per-game season
// stats table down to the new season's card-set player pool.
//
// Pool rule (decided 2026-08-28, see memory/new_season_player_pool.md): every
// player with MPG >= 12 and G >= 40 in the source season, no further manual
// curation. Verified against the real 2025-26 season page: 331 players.
//
// NOTE ON TABLE STRUCTURE (verified 2026-08-28 against
// https://www.basketball-reference.com/leagues/NBA_2026_per_game.html): the
// per-game stats table is `<table id="per_game_stats">` inside
// `<div id="div_per_game_stats">`. Column data-stat attributes used here:
// `name_display` (player name), `team_name_abbr`, `pos`, `games`, `mp_per_g`.
// A trimmed excerpt of the real page is saved as
// scripts/cardgen/sources/__fixtures__/sample-per-game-stats.html.
//
// Players traded mid-season get BOTH a combined multi-team row (team_name_abbr
// "2TM"/"3TM"/etc.) and one row per team they played for, all under the same
// player name — the combined row always has the highest games-played of the
// set, so keeping the max-games row per name naturally picks the combined row
// over the partial per-team ones.

const TABLE_ID = 'per_game_stats';

/**
 * Isolates the `<tbody>...</tbody>` of `<table id="per_game_stats">` from a full
 * league stats page (or a fixture that already *is* just that table's markup).
 *
 * Deliberately throws rather than silently falling back to parsing the unscoped
 * input when an expected landmark is missing — see basketballReference.js's
 * isolateRegSeasonTable for why (this exact failure mode, a Basketball-Reference
 * table id turning out to be different than assumed, already happened once
 * during this project's development).
 */
function isolatePerGameTable(html) {
  const idAttr = `id="${TABLE_ID}"`;
  const idIndex = html.indexOf(idAttr);
  if (idIndex === -1) {
    throw new Error(
      `parsePerGameStatsHtml: could not find ${idAttr} in the input HTML — ` +
        "Basketball-Reference's per-game stats table structure may have changed; " +
        'verify against a live page before assuming the site is just temporarily unreachable.'
    );
  }

  const tbodyStart = html.indexOf('<tbody', idIndex);
  if (tbodyStart === -1) {
    throw new Error(
      `parsePerGameStatsHtml: found ${idAttr} but no following <tbody> — table markup has changed shape.`
    );
  }

  const tbodyEndTagIndex = html.indexOf('</tbody>', tbodyStart);
  if (tbodyEndTagIndex === -1) {
    throw new Error(
      `parsePerGameStatsHtml: found <tbody> after ${idAttr} but no matching </tbody> — input HTML may be truncated.`
    );
  }

  return html.slice(tbodyStart, tbodyEndTagIndex + '</tbody>'.length);
}

function extractCell(rowHtml, stat) {
  // <th>/<td> both used depending on the column (name_display is a <td>, but
  // repeated header rows re-use the same data-stat names in <th> cells) — we
  // only ever look these stats up on rows we've already confirmed are real
  // data rows (see parsePerGameStatsHtml), so matching either tag is fine here.
  const re = new RegExp(`data-stat="${stat}"[^>]*>([\\s\\S]*?)</t[dh]>`);
  const match = rowHtml.match(re);
  if (!match) return null;
  return match[1].replace(/<[^>]+>/g, '').trim();
}

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
 * Parses Basketball-Reference's per-game season stats table HTML into one
 * record per player: { name, team, pos, games, mpg }. Repeated header rows
 * and any row without a valid games-played cell are skipped. When a player
 * has multiple rows (mid-season trade), only the highest-games row is kept.
 */
export function parsePerGameStatsHtml(html) {
  const tableHtml = isolatePerGameTable(html);
  const rows = extractRows(tableHtml);
  const players = new Map();

  for (const row of rows) {
    const name = extractCell(row, 'name_display');
    const gamesRaw = extractCell(row, 'games');
    const mpgRaw = extractCell(row, 'mp_per_g');
    if (!name || gamesRaw === null || mpgRaw === null) continue;

    const games = Number(gamesRaw);
    const mpg = Number(mpgRaw);
    if (!Number.isFinite(games) || !Number.isFinite(mpg)) continue;

    const existing = players.get(name);
    if (!existing || games > existing.games) {
      players.set(name, {
        name,
        team: extractCell(row, 'team_name_abbr'),
        pos: extractCell(row, 'pos'),
        games,
        mpg,
      });
    }
  }

  return [...players.values()];
}

/** Applies the new-season pool rule: MPG >= minMpg and G >= minGames. */
export function filterPlayerPool(players, { minMpg, minGames }) {
  return players.filter((p) => p.mpg >= minMpg && p.games >= minGames);
}

/**
 * Fetches and filters a season's per-game stats into the card-set player pool.
 * @param {number} season End-year of the season (e.g. 2026 = 2025-26).
 * @param {{minMpg?: number, minGames?: number}} [opts] Defaults to the decided
 *   pool rule (MPG >= 12, G >= 40).
 */
export async function fetchPlayerPool(season, { minMpg = 12, minGames = 40 } = {}) {
  const res = await fetch(`https://www.basketball-reference.com/leagues/NBA_${season}_per_game.html`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Basketball-Reference fetch failed: ${res.status}`);
  const players = parsePerGameStatsHtml(await res.text());
  return filterPlayerPool(players, { minMpg, minGames });
}
