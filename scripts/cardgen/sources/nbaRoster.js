// nba.com/players source adapter — resolves each active player's CURRENT team.
//
// Why this exists: Basketball-Reference (our stats source) reports players who
// were traded mid-season under aggregate team codes "2TM"/"3TM" rather than a
// real team. 45 of the 331-player pool carry those codes. A card can't show a
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

  return players.map((p) => ({
    personId: p.PERSON_ID,
    firstName: p.PLAYER_FIRST_NAME,
    lastName: p.PLAYER_LAST_NAME,
    fullName: `${p.PLAYER_FIRST_NAME} ${p.PLAYER_LAST_NAME}`,
    team: p.TEAM_ABBREVIATION,
    teamCity: p.TEAM_CITY,
    teamName: p.TEAM_NAME,
    jersey: p.JERSEY_NUMBER,
    position: p.POSITION,
  }));
}

/** Fetches and parses the current active-player roster from nba.com. */
export async function fetchRoster() {
  const res = await fetch('https://www.nba.com/players', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`nba.com fetch failed: ${res.status}`);
  return parseRosterHtml(await res.text());
}
