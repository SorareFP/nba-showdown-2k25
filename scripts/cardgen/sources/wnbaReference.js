// Basketball-Reference WNBA season-table adapter.
//
// A SEPARATE MODULE FROM basketballReference.js, not an option on it, and the
// reason is that almost nothing about the two pages is the same. The WNBA
// tables are served by the same site and are visibly the same kind of table,
// and every single one of the four things a parser needs to find is spelled
// differently:
//
//   URL          /wnba/years/{season}_{slug}.html, not /leagues/NBA_{season}_...
//   table id     equals the slug on ALL THREE tables — `per_game`, `advanced`,
//                `per_poss`. The NBA's per-game table is `per_game_stats`,
//                which is exactly the mismatch SEASON_TABLES exists to record.
//   player name  `data-stat="player"`, not `name_display`, and WRAPPED IN
//                `<strong>` — see stripCellMarkup, this is the gotcha.
//   player id    there is NO `data-append-csv` attribute anywhere on these
//                pages. The id is only in the player link's href.
//
// Sharing one parser across that would mean four conditionals threaded through
// every function, in a file whose whole job is to be exact about markup.
//
// ── THE `<strong>` GOTCHA, WHICH SILENTLY CORRUPTS EVERY NAME ───────────────
//
// The WNBA per-game and advanced pages wrap the leading player's name in
// `<strong>` — and Basketball-Reference emits the closing tag UNTERMINATED:
//
//     <th data-stat="player"><strong><a href='...'>Kiah Stokes</a></strong</th>
//                                                                 ^ no '>'
//
// The usual `.replace(/<[^>]*>/g, '')` cannot match `</strong` because there is
// no closing angle bracket, so it strips the `<strong>` and the `<a>` and
// leaves `Kiah Stokes</strong`. That name then fails every join in the
// pipeline, and it fails SILENTLY — the player simply never matches anything.
//
// Two defences, because one is not enough: the name is read out of the `<a>`'s
// text where there is one (the exact string, no stripping involved), and
// stripCellMarkup also drops an unterminated trailing tag for the cells that
// have no link.
//
// ── TOT ─────────────────────────────────────────────────────────────────────
//
// A mid-season move gives a player one `TOT` row plus one row per team, exactly
// like the NBA's `2TM`/`3TM`. The aggregate always carries the most games, so
// `dedupeByMaxGames` — the same rule the NBA path uses — picks the whole season
// over either half. Verified on the 2026 table: 276 body rows, 230 distinct
// players, 16 of them with a TOT row.
//
// Verified against live pages 2026-08-30. A trimmed excerpt of each of the
// three real tables is saved as __fixtures__/sample-wnba-*.html.

/**
 * The three tables this module knows how to ask for.
 *
 * `tableId` is spelled out per entry rather than derived from `slug` even
 * though all three currently match: the NBA adapter's SEASON_TABLES had exactly
 * this shape for exactly this reason, and one of ITS three does not match. A
 * derived id is a landmine that goes off the day a fourth table is added.
 */
export const WNBA_SEASON_TABLES = {
  perGame: { slug: 'per_game', tableId: 'per_game' },
  advanced: { slug: 'advanced', tableId: 'advanced' },
  perPoss: { slug: 'per_poss', tableId: 'per_poss' },
  // ── WHY THE TOTALS TABLE IS FETCHED AT ALL ─────────────────────────────────
  //
  // Because a scoring chart is anchored on production per FOUR MINUTES, and
  // this table is the only one that answers that exactly.
  //
  // The NBA pipeline has to go the long way round — dunksandthrees publishes
  // per-100-possession rates and nothing else, so per-4-minute production is
  // RECONSTRUCTED as `per100 * pace * 4/48` at an assumed league pace. That
  // reconstruction carries every player's own TEAM pace as error: on the 2026
  // WNBA table it runs from -2% for a league-average team to +6% for the
  // slowest (Golden State at 74.6 possessions against the league's 79.24).
  //
  // Totals make it arithmetic instead of an estimate: `4 * PTS / MP`, with no
  // pace in it anywhere. It also removes the rounding in the per-game table —
  // 26.0 points a game over 37 games is 962 exactly here and 962 ± 4 there —
  // and it makes a two-season blend a straight addition.
  totals: { slug: 'totals', tableId: 'totals' },
};

/** Basketball-Reference's multi-team aggregate code on the WNBA tables. */
export const AGGREGATE_TEAMS = new Set(['TOT', '2TM', '3TM', '4TM']);
export const isAggregateTeam = team => AGGREGATE_TEAMS.has(String(team ?? '').toUpperCase());

function isolateTableBody(html, tableId) {
  const idAttr = `id="${tableId}"`;
  const idIndex = html.indexOf(idAttr);
  if (idIndex === -1) {
    throw new Error(
      `parseWnbaTableHtml: no ${idAttr} in the input HTML — Basketball-Reference's WNBA ` +
        'table structure may have changed; verify against a live page before assuming the ' +
        'site is just temporarily unreachable.'
    );
  }
  const tbodyStart = html.indexOf('<tbody', idIndex);
  if (tbodyStart === -1) {
    throw new Error(`parseWnbaTableHtml: no <tbody> for ${idAttr}`);
  }
  // ── THE WNBA PAGES NEVER CLOSE THEIR <tbody> ──────────────────────────────
  //
  // Verified on all three 2026 tables: one `<tbody`, zero `</tbody`, and the
  // body runs to `</table>`. The NBA pages DO close theirs, which is why the
  // NBA parser can end on `</tbody>` alone — copying that here silently
  // returns everything from the tbody to the end of the FILE. It happens to be
  // harmless on a page with one table and would stop being harmless the moment
  // Basketball-Reference adds a second one below it.
  //
  // So the body ends at whichever boundary comes first, and a page with
  // NEITHER is a structural change worth failing on rather than guessing past.
  const candidates = [html.indexOf('</tbody>', tbodyStart), html.indexOf('</table>', tbodyStart)]
    .filter(i => i !== -1);
  if (candidates.length === 0) {
    throw new Error(
      `parseWnbaTableHtml: <tbody> for ${idAttr} is closed by neither </tbody> nor </table> — ` +
        'input HTML may be truncated.'
    );
  }
  return html.slice(tbodyStart, Math.min(...candidates));
}

function extractRows(html) {
  const rows = [];
  const re = /<tr\b[^>]*>[\s\S]*?<\/tr>/g;
  let m;
  while ((m = re.exec(html)) !== null) rows.push(m[0]);
  return rows;
}

/**
 * Cell text with markup removed, INCLUDING an unterminated trailing tag.
 *
 * The second replace is the whole point — see the header. `</strong` with no
 * closing bracket survives the first pass and would ride along on the value.
 */
export function stripCellMarkup(html) {
  return String(html ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/<\/?[A-Za-z][A-Za-z0-9]*$/, '')
    .trim();
}

/**
 * Every `data-stat` cell in a row, as strings.
 *
 * FIRST OCCURRENCE WINS, and that is deliberate: the WNBA tables print `g` and
 * `mp` TWICE in every row (once as the sortable season column, once inside the
 * stat block). Both carry the same value today; taking the first is the stable
 * reading either way.
 */
export function parseRowCells(rowHtml) {
  const cells = {};
  const re = /<(?:td|th)[^>]*data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/(?:td|th)>/g;
  let m;
  while ((m = re.exec(rowHtml)) !== null) {
    if (cells[m[1]] === undefined) cells[m[1]] = stripCellMarkup(m[2]);
  }
  return cells;
}

/** `/wnba/players/s/stokeki01w.html` -> `stokeki01w`, or null. */
export function playerIdFromRow(rowHtml) {
  const m = String(rowHtml ?? '').match(/\/wnba\/players\/[a-z]\/([a-z0-9.]+)\.html/i);
  return m ? m[1] : null;
}

/**
 * The player's name, read out of the link text where there is one.
 *
 * Preferred over the stripped cell because it involves no stripping at all: the
 * anchor's text is the exact string Basketball-Reference printed, so the
 * `</strong` defect cannot reach it even if stripCellMarkup were wrong.
 */
export function playerNameFromRow(rowHtml, cells) {
  const m = String(rowHtml ?? '').match(/\/wnba\/players\/[a-z]\/[a-z0-9.]+\.html'?"?[^>]*>([^<]+)</i);
  if (m) return m[1].trim();
  return cells?.player ?? null;
}

/**
 * Parses one WNBA season table into `{ playerId, name, cells }` records.
 *
 * A row with no player link is dropped — that is how the thirteen repeated
 * header rows Basketball-Reference interleaves down the table are excluded,
 * and it is the same test the NBA parser makes against `data-append-csv`.
 * Values stay strings for the same reason they do there: the three tables
 * disagree about which columns exist and the caller knows which it asked for.
 */
export function parseWnbaTableHtml(html, tableId) {
  const body = isolateTableBody(html, tableId);
  const out = [];
  for (const row of extractRows(body)) {
    const playerId = playerIdFromRow(row);
    if (!playerId) continue;
    const cells = parseRowCells(row);
    const name = playerNameFromRow(row, cells);
    if (!name) continue;
    out.push({ playerId, name, cells });
  }
  return out;
}

const num = v => {
  const s = String(v ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

/**
 * Trims a parsed table to the columns anything downstream reads.
 *
 * WHAT IS AND IS NOT HERE IS THE WHOLE POINT OF THIS FUNCTION, because the
 * WNBA pages carry a DIFFERENT column set from the NBA ones and the gaps are
 * what the rest of this set has to work around:
 *
 *   advanced   has  per ts_pct efg_pct fg3ar ftr orb_pct trb_pct ast_pct
 *                   stl_pct blk_pct tov_pct usg_pct off_rtg def_rtg
 *                   ows dws ws ws_per_40
 *              LACKS bpm obpm dbpm vorp  — there is no plus/minus estimate of
 *                   any kind in the WNBA tables, which is the whole reason
 *                   scripts/cardgen/wnba/bpmModel.js exists.
 *              LACKS drb_pct — the NBA table has it, this one has only ORB%
 *                   and TRB%. Defensive rebounds come back through the
 *                   per-100 table instead (`drb100 = trb100 - orb100`).
 *              NOTE ws_per_40, NOT ws_per_48. A WNBA game is 40 minutes. The
 *                   two are the same quantity in each league's own units —
 *                   both league-average to exactly 0.100 — and mixing them
 *                   would be a silent 20% error.
 *
 *   perPoss    has  the full per-100 box score EXCEPT drb_per_poss, and no
 *                   off_rtg/def_rtg (those live on `advanced` here, unlike the
 *                   NBA where they are on this table).
 */
export function trimWnbaTable(rows, kind) {
  return rows.map(r => {
    const c = r.cells;
    const base = {
      playerId: r.playerId,
      name: r.name,
      team: c.team ?? null,
      pos: c.pos ?? null,
      games: num(c.g),
      minutes: num(c.mp),
    };
    if (kind === 'perGame') {
      return {
        ...base,
        starts: num(c.gs),
        mpg: num(c.mp_per_g),
        pts: num(c.pts_per_g),
        trb: num(c.trb_per_g),
        orb: num(c.orb_per_g),
        ast: num(c.ast_per_g),
        stl: num(c.stl_per_g),
        blk: num(c.blk_per_g),
        tov: num(c.tov_per_g),
        pf: num(c.pf_per_g),
        fga: num(c.fga_per_g),
        fg3a: num(c.fg3a_per_g),
        fg2a: num(c.fg2a_per_g),
        fta: num(c.fta_per_g),
        fgPct: num(c.fg_pct),
        fgPct3: num(c.fg3_pct),
        fgPct2: num(c.fg2_pct),
        ftPct: num(c.ft_pct),
      };
    }
    if (kind === 'totals') {
      // Season COUNTS, exact. `pts`/`trb`/`ast` here are whole-season totals,
      // not per-game figures — the same data-stat names mean different things
      // on the two tables, which is precisely why the suffixed per-game names
      // are spelled out above rather than derived.
      return {
        ...base,
        pts: num(c.pts),
        trb: num(c.trb),
        orb: num(c.orb),
        ast: num(c.ast),
        stl: num(c.stl),
        blk: num(c.blk),
        tov: num(c.tov),
        pf: num(c.pf),
        fga: num(c.fga),
        fg3a: num(c.fg3a),
        fg2a: num(c.fg2a),
        fta: num(c.fta),
      };
    }
    if (kind === 'perPoss') {
      const orb100 = num(c.orb_per_poss);
      const trb100 = num(c.trb_per_poss);
      return {
        ...base,
        pts100: num(c.pts_per_poss),
        trb100,
        orb100,
        // The WNBA per-100 table has no defensive-rebound column at all, so it
        // is the difference — exact, not an estimate, since total rebounds are
        // offensive plus defensive by definition.
        drb100: trb100 != null && orb100 != null ? Number((trb100 - orb100).toFixed(1)) : null,
        ast100: num(c.ast_per_poss),
        stl100: num(c.stl_per_poss),
        blk100: num(c.blk_per_poss),
        tov100: num(c.tov_per_poss),
        pf100: num(c.pf_per_poss),
        fga100: num(c.fga_per_poss),
        fg3a100: num(c.fg3a_per_poss),
        fg2a100: num(c.fg2a_per_poss),
        fta100: num(c.fta_per_poss),
        fgPct: num(c.fg_pct),
        fgPct3: num(c.fg3_pct),
        fgPct2: num(c.fg2_pct),
        ftPct: num(c.ft_pct),
      };
    }
    return {
      ...base,
      per: num(c.per),
      tsPct: num(c.ts_pct),
      efg: num(c.efg_pct),
      fg3aRate: num(c.fg3a_per_fga_pct),
      ftRate: num(c.fta_per_fga_pct),
      orbPct: num(c.orb_pct),
      trbPct: num(c.trb_pct),
      astPct: num(c.ast_pct),
      stlPct: num(c.stl_pct),
      blkPct: num(c.blk_pct),
      tovPct: num(c.tov_pct),
      usgPct: num(c.usg_pct),
      offRtg: num(c.off_rtg),
      defRtg: num(c.def_rtg),
      ows: num(c.ows),
      dws: num(c.dws),
      ws: num(c.ws),
      // Per FORTY minutes. See the note above.
      wsPer40: num(c.ws_per_40),
    };
  });
}

/**
 * One row per player, keeping the row with the most games.
 *
 * The TOT row of a player who moved covers his whole season and therefore has
 * the most games, so this both dedupes the splits away and keeps the complete
 * line — the same rule the NBA pool, the calibration snapshot and the history
 * archive all use.
 */
export function dedupeByMaxGames(rows) {
  const best = new Map();
  for (const row of rows) {
    const prev = best.get(row.playerId);
    if (!prev || (row.games ?? 0) > (prev.games ?? 0)) best.set(row.playerId, row);
  }
  return [...best.values()];
}

/** Fetches and parses one WNBA season table. `season` is the season year, 2026. */
export async function fetchWnbaSeasonTable(season, kind, { fetchImpl = fetch } = {}) {
  const table = WNBA_SEASON_TABLES[kind];
  if (!table) throw new Error(`fetchWnbaSeasonTable: unknown table kind ${JSON.stringify(kind)}`);
  const res = await fetchImpl(
    `https://www.basketball-reference.com/wnba/years/${season}_${table.slug}.html`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) throw new Error(`Basketball-Reference WNBA fetch failed: ${res.status}`);
  return parseWnbaTableHtml(await res.text(), table.tableId);
}

/**
 * League PACE — possessions per FORTY minutes — off the season summary page.
 *
 * This is the number every scoring chart in the set is scaled by, so it is
 * MEASURED rather than assumed: see scripts/cardgen/wnba/constants.js for what
 * it is used for and why a 40-minute game cannot reuse the NBA's 4/48.
 *
 * SCOPED TO `advanced-team`, NOT THE WHOLE PAGE, and the League Average row is
 * dropped. The season page carries a per-100 team table and a per-100 OPPONENT
 * table alongside the advanced one; an unscoped sweep for `data-stat="pace"`
 * picks up sixteen cells on a fifteen-team league, and the extra one is the
 * league-average row that would then be averaged in as if it were a sixteenth
 * team. It barely moves the mean, which is exactly what makes it worth
 * excluding deliberately rather than discovering later.
 */
export function parseWnbaLeaguePace(html) {
  const text = String(html ?? '');
  const start = text.indexOf('id="advanced-team"');
  if (start === -1) {
    throw new Error(
      "parseWnbaLeaguePace: no advanced-team table on the WNBA season page — its structure " +
        'has changed; verify against a live page.'
    );
  }
  const ends = ['</tbody>', '</table>'].map(t => text.indexOf(t, start)).filter(i => i !== -1);
  const body = text.slice(start, ends.length ? Math.min(...ends) : undefined);

  const teams = [];
  for (const row of extractRows(body)) {
    const name = stripCellMarkup((row.match(/data-stat="team"[^>]*>([\s\S]*?)<\/t[dh]>/) ?? [])[1]);
    const pace = Number((row.match(/data-stat="pace"[^>]*>([\d.]+)</) ?? [])[1]);
    if (!name || /league average/i.test(name) || !Number.isFinite(pace)) continue;
    teams.push({ team: name, pace });
  }
  if (teams.length < 8) {
    throw new Error(
      `parseWnbaLeaguePace: found only ${teams.length} team pace rows — expected one per team. ` +
        "Basketball-Reference's WNBA season page has changed shape."
    );
  }
  return {
    teams: teams.length,
    paces: teams,
    pace: Number((teams.reduce((a, t) => a + t.pace, 0) / teams.length).toFixed(4)),
  };
}

export async function fetchWnbaLeaguePace(season, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`https://www.basketball-reference.com/wnba/years/${season}.html`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`Basketball-Reference WNBA fetch failed: ${res.status}`);
  return parseWnbaLeaguePace(await res.text());
}
