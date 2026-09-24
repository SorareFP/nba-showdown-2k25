// WHERE TO LOOK FOR A CARD'S PHOTO — the image search and the uniform to find.
//
// Moved here from scripts/studio/photoHunt.mjs (2026-09-24) when the hunt came
// into the Card Studio as a live panel (the user, on the published page: "it
// still looks goofed" — a snapshot drifts the moment a photo is dropped). The
// page and the panel build the same search from the same card.
import { getTeam, franchiseForSeason, canonicalTeam } from '../cards/teams.js';

/**
 * The year to SEARCH for, which is not the year to print.
 *
 * A card says "2006-07" because that is the season. An image search for
 * "2006-07" only matches pages that spell the season that way, and most do not
 * — a photo agency captions it "2007". Searching the latter year alone finds
 * the same uniform and far more of it. WNBA labels are already a single year.
 *
 * A ROOKIE CARD SEARCHES THE EARLIER YEAR (the user, 2026-09-07): a rookie is
 * written about when he ARRIVES — "2024 NBA draft", "2024 rookie".
 */
export function searchSeason(label, rookie = false) {
  const span = /^(\d{4})-\d{2}$/.exec(String(label ?? ''));
  if (!span) return String(label ?? '');
  return String(Number(span[1]) + (rookie ? 0 : 1));
}

/** Google Images, large, with the trading cards this hunt is trying to MAKE excluded. */
const EXCLUDE = '-card -cards -topps -panini -facebook -instagram -threads';
const images = q => `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${encodeURIComponent(`${q} ${EXCLUDE}`)}`;

/** The search a human would type for a player-season, minus the part they would forget. */
export function searchUrl(name, team, seasonLabel, league, rookie = false) {
  const parts = [
    name, team?.city, team?.name,
    league === 'WNBA' ? 'WNBA' : null,
    searchSeason(seasonLabel, rookie),
    rookie ? 'rookie' : null,
  ].filter(Boolean).join(' ');
  return images(parts);
}

/** A strategy card's search is its idea, not a player: "NBA double team" finds a trap. */
export function stratSearchUrl(strat) {
  return images(`NBA ${strat.name} basketball`);
}

export const leagueOfSet = setId => (String(setId).startsWith('wnba') ? 'WNBA' : 'NBA');

/**
 * Everything the hunt says about one player card: the season label to look
 * for, the era-resolved team code and its uniform era, and the search.
 */
export function huntTarget(setId, card) {
  const league = leagueOfSet(setId);
  // The generators write era-resolved codes; resolving again is a no-op for
  // those and a correction for any that are not.
  const code = card.season ? franchiseForSeason(canonicalTeam(card.team), card.season) : card.team;
  const team = getTeam(code, { league });
  const label = card.seasonLabel ?? (league === 'WNBA' ? '2026' : '2025-26');
  // A capstone reward MIGRATED out of a rookie set is still a rookie card.
  const rookie = /rookie$/.test(setId) || /rookie$/.test(card.migratedFrom?.set ?? '');
  return { league, code, era: team?.era ?? '', team, label, rookie, url: searchUrl(card.name, team, label, league, rookie) };
}
