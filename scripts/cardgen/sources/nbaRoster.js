// nba.com/players source adapter — resolves each active player's CURRENT team.
//
// Why this exists: Basketball-Reference (our stats source) reports players who
// were traded mid-season under aggregate team codes "2TM"/"3TM" rather than a
// real team. 46 of the 350-player pool carry those codes. A card can't show a
// logo or team colors for "2TM", so we need a real-team source.
//
// STRUCTURE (verified 2026-08-29 against the live page): nba.com is a Next.js
// app that server-renders its data into a <script id="__NEXT_DATA__"> tag. The
// player array lives at props.pageProps.players and contains 581 active
// players. A trimmed excerpt of the real page is saved as
// __fixtures__/sample-nba-players.html.
//
// NAMES ARE PASSED THROUGH VERBATIM — no diacritic stripping, no suffix
// normalization. Both this feed and Basketball-Reference spell accented names
// the same way (both give "Nikola Jokić"), so a source adapter has no business
// guessing at a canonical form. Cross-source name matching is the consumer's
// job (see scripts/cardgen/resolveTeams.js); doing it here would bake one
// matching strategy into the fetch layer and hide mismatches from that caller.
//
// Only ACTIVE players appear here, and "active" does NOT guarantee a team. Two
// distinct gaps a caller must handle, both expected rather than errors:
//   1. Absent entirely — retired players, and players not on any roster
//      (verified 2026-08-29: e.g. Ochai Agbaji, Guerschon Yabusele).
//   2. Present with a NULL team — an unsigned free agent still carried in the
//      feed keeps its PERSON_ID but has TEAM_ABBREVIATION/TEAM_CITY/TEAM_NAME
//      all null (verified 2026-08-29: DeMar DeRozan, 201942).
// So a lookup that merely finds a record is not enough; the team can still be
// null. Callers fill both gaps via manual assignment (see
// scripts/cardgen/resolveTeams.js). We pass the nulls through untouched rather
// than dropping or defaulting those records, so the caller can tell "no such
// player" apart from "player exists but has no team".

const SCRIPT_ID = '__NEXT_DATA__';

// Keys every record must carry for this adapter's output to mean anything. We
// check PRESENCE, not truthiness — see the `in` check in parseRosterHtml.
const REQUIRED_KEYS = [
  'PERSON_ID',
  'PLAYER_FIRST_NAME',
  'PLAYER_LAST_NAME',
  'TEAM_ABBREVIATION',
];

/**
 * Extracts and parses the __NEXT_DATA__ JSON blob from an nba.com page.
 *
 * Deliberately throws rather than falling back to scanning the whole document
 * when a landmark is missing — the same discipline as
 * basketballReference.js's isolateRegSeasonTable. A silent fallback here would
 * be worse than useless: this adapter feeds a batch run over 300+ players, so a
 * markup change that quietly yielded an empty roster would strand every traded
 * player on a "2TM" code with no visible signal that anything broke.
 */
function extractNextData(html) {
  const marker = `id="${SCRIPT_ID}"`;
  const idIndex = html.indexOf(marker);
  if (idIndex === -1) {
    throw new Error(
      `parseRosterHtml: could not find ${marker} in the input HTML — nba.com's page structure ` +
        'may have changed; verify against a live page before assuming the site is unreachable.'
    );
  }

  const openEnd = html.indexOf('>', idIndex);
  const closeStart = openEnd === -1 ? -1 : html.indexOf('</script>', openEnd);
  if (openEnd === -1 || closeStart === -1) {
    throw new Error(
      `parseRosterHtml: found ${marker} but its <script> tag is malformed or truncated.`
    );
  }

  const json = html.slice(openEnd + 1, closeStart);
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new Error(`parseRosterHtml: ${SCRIPT_ID} contents were not valid JSON: ${err.message}`);
  }
}

/** Parses nba.com/players HTML into normalized roster records. */
export function parseRosterHtml(html) {
  const data = extractNextData(html);
  const players = data?.props?.pageProps?.players;
  if (!Array.isArray(players)) {
    throw new Error(
      "parseRosterHtml: props.pageProps.players was not an array — the shape of nba.com's " +
        'embedded data has changed.'
    );
  }

  // An empty array is a failure, not a valid roster. nba.com/players is the
  // league's full active-player list (581 on 2026-08-29); it is never legitimately
  // empty. The realistic way to get [] is nba.com moving the roster out of
  // __NEXT_DATA__ into a client-side fetch and leaving the key behind as an empty
  // placeholder — which Array.isArray() happily accepts. Returning [] there would
  // strand all 45 traded players on their "2TM" codes with no visible signal,
  // exactly the silent-wrong-data failure extractNextData's throws exist to prevent.
  if (players.length === 0) {
    throw new Error(
      'parseRosterHtml: props.pageProps.players was empty — nba.com never serves an empty ' +
        'active-player list, so its data is likely no longer server-rendered into ' +
        `${SCRIPT_ID}; verify against a live page.`
    );
  }

  return players.map((p, i) => {
    if (!p || typeof p !== 'object') {
      throw new Error(
        `parseRosterHtml: players[${i}] was not an object — nba.com's record shape has changed.`
      );
    }
    for (const key of REQUIRED_KEYS) {
      // `in`, not truthiness: TEAM_ABBREVIATION is legitimately null for unsigned
      // free agents (see the DeRozan case in this module's header), and
      // JERSEY_NUMBER can be an empty string. Testing presence is what lets us
      // tell "nba.com renamed its keys" apart from "this player has no team" —
      // a distinction resolveTeams.js depends on and could not otherwise recover.
      if (!(key in p)) {
        throw new Error(
          `parseRosterHtml: players[${i}] has no ${key} key — nba.com's record shape has changed.`
        );
      }
    }

    return {
      personId: p.PERSON_ID,
      firstName: p.PLAYER_FIRST_NAME,
      lastName: p.PLAYER_LAST_NAME,
      fullName: `${p.PLAYER_FIRST_NAME} ${p.PLAYER_LAST_NAME}`,
      team: p.TEAM_ABBREVIATION,
      teamCity: p.TEAM_CITY,
      teamName: p.TEAM_NAME,
      jersey: p.JERSEY_NUMBER,
      position: p.POSITION,
    };
  });
}

/** Fetches and parses the current active-player roster from nba.com. */
export async function fetchRoster() {
  const res = await fetch('https://www.nba.com/players', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`nba.com fetch failed: ${res.status}`);
  return parseRosterHtml(await res.text());
}
