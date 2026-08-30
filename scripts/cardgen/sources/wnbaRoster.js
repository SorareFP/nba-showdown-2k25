// wnba.com/players source adapter — resolves each active WNBA player's CURRENT
// team.
//
// THE PROBLEM, which is the NBA path's problem word for word: Basketball-
// Reference reports a player who moved mid-season under the aggregate code
// `TOT` rather than a real team, and 16 of the 263 rows in the 2026 WNBA
// per-game table carry it. `TOT` is not a franchise — it has no colours and no
// logo, so a card built on it renders on the neutral grey fallback and looks
// broken. See scripts/cardgen/sources/nbaRoster.js, which this mirrors
// deliberately rather than generalising: the two feeds share a framing and
// share almost nothing else.
//
// ── THE ROW IS A TUPLE, NOT AN OBJECT ───────────────────────────────────────
//
// This is the difference that matters and the reason this is a separate module.
// nba.com serves self-describing records — `{ PERSON_ID: 203999,
// PLAYER_LAST_NAME: "Jokić", TEAM_ABBREVIATION: "DEN", ... }` — so its adapter
// can check that a key is PRESENT and fail loudly when the site renames one.
// wnba.com serves POSITIONAL ARRAYS with the column names nowhere on the page:
//
//   [1628276,"Plum","Kelsey","kelsey-plum",1611661319,"mercury","Phoenix",
//    "Mercury","PHX","10","G","5-8",...]
//
// A feed like that cannot announce a breaking change. If a column is inserted
// ahead of the tricode, index 8 keeps parsing — it just starts returning
// jersey numbers, and every player in the pool gets a team of "10". So the
// checks below are on the SHAPE OF THE VALUES rather than on the presence of
// keys: an id must be a number, the names must be non-empty strings, and the
// tricode must be null or look like a tricode. That is the only tripwire this
// feed makes available, and without it the failure is silent and league-wide.
//
// ── TWO TRICODES DISAGREE WITH BASKETBALL-REFERENCE ──────────────────────────
//
// PHX/PHO and PDX/POR. Both spellings are correct for their own site and
// neither is going to change, so they are mapped here — at the edge, once —
// rather than anywhere the rest of the pipeline can see them. Everything
// downstream (src/cards/teams.js's WNBA_TEAMS, the generated cards, the pool
// file) is keyed the way Basketball-Reference spells it, so this adapter's job
// is to speak that.
//
// Verified against the live page 2026-08-30: 236 current players, 15 teams, 27
// of them with a null team. A trimmed excerpt is saved as
// __fixtures__/sample-wnba-players.html.

const SCRIPT_ID = '__NEXT_DATA__';

/**
 * Column positions in `currentPlayersData`, named once.
 *
 * There is no header row anywhere on the page — these were read off the live
 * feed on 2026-08-30 by matching known players against known facts (Kelsey
 * Plum's person id, the Mercury's tricode, her number). Anything past
 * POSITION is height, weight, college, country, draft year, seasons and
 * per-game averages, none of which this adapter has a use for.
 */
export const COLUMNS = {
  personId: 0,
  lastName: 1,
  firstName: 2,
  slug: 3,
  teamId: 4,
  teamSlug: 5,
  teamCity: 6,
  teamName: 7,
  team: 8,
  jersey: 9,
  position: 10,
};

/** Enough columns for every index above to exist. */
const MIN_COLUMNS = COLUMNS.position + 1;

/**
 * wnba.com tricode -> the abbreviation Basketball-Reference's WNBA tables use.
 *
 * Exactly two entries, and both are checked by the test against the full live
 * tricode list rather than assumed to be the only two. The other thirteen
 * franchises spell the same on both sites.
 */
export const WNBA_ROSTER_ALIASES = {
  PHX: 'PHO', // Phoenix Mercury
  PDX: 'POR', // Portland Fire
};

/** A tricode as Basketball-Reference spells it. Null stays null. */
export function canonicalWnbaTeam(tricode) {
  if (tricode == null || tricode === '') return null;
  const key = String(tricode).toUpperCase();
  return WNBA_ROSTER_ALIASES[key] ?? key;
}

/**
 * Extracts and parses the __NEXT_DATA__ JSON blob from a wnba.com page.
 *
 * Throws rather than falling back to scanning the document, for the reason
 * nbaRoster.js states: this feeds a batch run over a whole set, and a markup
 * change that quietly yielded an empty roster would leave every moved player
 * on her aggregate code with nothing to show that anything broke.
 */
function extractNextData(html) {
  const marker = `id="${SCRIPT_ID}"`;
  const idIndex = html.indexOf(marker);
  if (idIndex === -1) {
    throw new Error(
      `parseWnbaRosterHtml: could not find ${marker} in the input HTML — wnba.com's page ` +
        'structure may have changed; verify against a live page before assuming the site is ' +
        'unreachable.'
    );
  }
  const openEnd = html.indexOf('>', idIndex);
  const closeStart = openEnd === -1 ? -1 : html.indexOf('</script>', openEnd);
  if (openEnd === -1 || closeStart === -1) {
    throw new Error(
      `parseWnbaRosterHtml: found ${marker} but its <script> tag is malformed or truncated.`
    );
  }
  try {
    return JSON.parse(html.slice(openEnd + 1, closeStart));
  } catch (err) {
    throw new Error(
      `parseWnbaRosterHtml: ${SCRIPT_ID} contents were not valid JSON: ${err.message}`
    );
  }
}

/** A tricode, or null. Two to four uppercase letters — never a jersey number. */
const looksLikeTricode = value =>
  value == null || (typeof value === 'string' && /^[A-Z]{2,4}$/.test(value));

/** Parses wnba.com/players HTML into normalized roster records. */
export function parseWnbaRosterHtml(html) {
  const data = extractNextData(html);
  const rows = data?.props?.pageProps?.currentPlayersData;
  if (!Array.isArray(rows)) {
    throw new Error(
      "parseWnbaRosterHtml: props.pageProps.currentPlayersData was not an array — the shape of " +
        "wnba.com's embedded data has changed."
    );
  }
  // An empty array is a failure, not a valid roster: wnba.com/players is the
  // league's whole active list (236 on 2026-08-30) and is never legitimately
  // empty. The realistic way to get [] is the data moving to a client-side
  // fetch and leaving the key behind — which Array.isArray happily accepts.
  if (rows.length === 0) {
    throw new Error(
      'parseWnbaRosterHtml: props.pageProps.currentPlayersData was empty — wnba.com never ' +
        'serves an empty active-player list, so its data is likely no longer server-rendered ' +
        `into ${SCRIPT_ID}; verify against a live page.`
    );
  }

  return rows.map((row, i) => {
    // Every check below exists because the row is positional. See the header:
    // a shifted column parses perfectly and yields nonsense.
    if (!Array.isArray(row) || row.length < MIN_COLUMNS) {
      throw new Error(
        `parseWnbaRosterHtml: currentPlayersData[${i}] is not a ${MIN_COLUMNS}+ element array — ` +
          "wnba.com's row shape has changed."
      );
    }
    const personId = row[COLUMNS.personId];
    const lastName = row[COLUMNS.lastName];
    const firstName = row[COLUMNS.firstName];
    const team = row[COLUMNS.team];
    if (typeof personId !== 'number') {
      throw new Error(
        `parseWnbaRosterHtml: currentPlayersData[${i}][${COLUMNS.personId}] is not a numeric ` +
          `person id (got ${JSON.stringify(personId)}) — the columns have shifted.`
      );
    }
    if (typeof lastName !== 'string' || typeof firstName !== 'string' || !lastName || !firstName) {
      throw new Error(
        `parseWnbaRosterHtml: currentPlayersData[${i}] has no name at columns ` +
          `${COLUMNS.firstName}/${COLUMNS.lastName} — the columns have shifted.`
      );
    }
    if (!looksLikeTricode(team)) {
      throw new Error(
        `parseWnbaRosterHtml: currentPlayersData[${i}][${COLUMNS.team}] is ` +
          `${JSON.stringify(team)}, which is not a team tricode — the columns have shifted, and ` +
          'a jersey number is what this index returns when they do.'
      );
    }

    return {
      personId,
      firstName,
      lastName,
      // Names pass through VERBATIM, exactly as nbaRoster.js does: cross-source
      // matching is the consumer's job (see wnba/resolveWnbaTeams.js), and
      // baking one strategy in here would hide every mismatch from it.
      fullName: `${firstName} ${lastName}`,
      // Null for a player on no roster — an unsigned free agent stays in the
      // feed with her person id and every team field null (verified
      // 2026-08-30: NaLyssa Smith, Azzi Fudd). The null must survive to the
      // caller, which has to tell "no team" apart from "the feed changed".
      team: canonicalWnbaTeam(team),
      teamCity: row[COLUMNS.teamCity] ?? null,
      teamName: row[COLUMNS.teamName] ?? null,
      jersey: row[COLUMNS.jersey] ?? null,
      position: row[COLUMNS.position] ?? null,
    };
  });
}

export const WNBA_ROSTER_URL = 'https://www.wnba.com/players';

/** Fetches and parses the current active-player roster from wnba.com. */
export async function fetchWnbaRoster({ fetchImpl = fetch } = {}) {
  const res = await fetchImpl(WNBA_ROSTER_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`wnba.com fetch failed: ${res.status}`);
  return parseWnbaRosterHtml(await res.text());
}
