// THE HOME PAGE'S ARITHMETIC — what the signed-in landing shows, worked out
// from the collection, the seasons and the lifetime tracker with no React and
// no Firebase, so the tests can pin it.
//
// The user, 2026-09-10: "Can you build a homepage, so that it just doesn't
// show blank on the screen when you navigate to the site? Latest news (like
// get your starter pack, Unethical Hoops), closest collections with a link to
// the pack shop, seasons in progress with your current standing and next
// opponent, player stats, etc."
import { GOALS, goalProgress } from './collections.js';
import { PACK_TYPES } from './packEngine.js';
import { getCardByKey } from './cardSets.js';
import { standings, nextFixtureFor, teamsById, totalRounds, PHASE } from './modes/seasonCore.js';
import { LENGTHS } from './modes/schedule.js';
import { teamIdFor } from './modes/league.js';

// ── News ─────────────────────────────────────────────────────────────────────

/**
 * What changed, newest first. `to` is where the button goes: a tab id, or
 * 'shop' / 'goals' for a Collection section. Add an item the day a feature
 * ships; the page shows the latest few and the rest behind "All news".
 */
export const NEWS = [
  {
    id: 'free-agents', date: '2026-09-10', title: 'Free Agents: ask for any season',
    body: 'Search any NBA player\'s season from 1984-85 on (plus 1975-76 and 1976-77), or a playoff run from 2002, and see what their card would cost. Request it, and when the card is built you can sign it for its price. Up to three requests can wait at once.',
    to: 'freeagents', cta: 'Free Agents',
  },
  {
    id: 'device-handoff', date: '2026-09-10', title: 'Pick up on any device',
    body: 'Start a game or a season fixture on your desktop and carry on from your phone, or the other way round: the newest copy of the game is picked up by itself, and a device left open can no longer overwrite the one you moved to.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'placement-undo', date: '2026-09-10', title: 'Undo a placement',
    body: 'Put the wrong player on the floor? Take it back. Against the coach, until you place your next player; in PvP, until your opponent places.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'awards', date: '2026-09-10', title: 'End-of-season awards',
    body: 'When the regular season ends the league names an MVP (value over replacement), a Defensive Player of the Year (fewest points allowed per minute, 16 minutes a game to qualify), a Sixth Man, a Rookie of the Year and a Scoring Title.',
    to: 'season', cta: 'Go to Season',
  },
  {
    id: 'matchup-pm', date: '2026-09-10', title: 'Matchup +/- and a deeper box score',
    body: 'Every point is now charged to the defender guarding the scorer. Season stats show each player\'s matchup +/-, plus starts, paint checks, blocks and points for and against while he was on the floor.',
    to: 'season', cta: 'See season stats',
  },
  {
    id: 'mobile', date: '2026-09-10', title: 'Showdown on your phone',
    body: 'A tab bar at the bottom, a compact court, and one section on screen at a time. Tell us what still does not fit.',
  },
  {
    id: 'pack-prices', date: '2026-09-09', title: 'Super Season and Standouts packs repriced',
    body: 'The Super Season Pack is now 300 coins and the Summer Standouts Pack 275, priced against what their cards are measured to be worth.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'timeout-search', date: '2026-09-09', title: 'Crunch-Time timeouts search your deck',
    body: 'Call your timeout in Crunch Time and take one crunch card from your deck, then shuffle it.',
    to: 'howtoplay', cta: 'Read the rules',
  },
  {
    id: 'unethical-hoops', date: '2026-09-07', title: 'Unethical Hoops, presented by Underdog',
    body: 'The sign-up card. In Crunch Time, a player of yours with a Speed or Power advantage draws the foul: four free-throw checks at +4. One comes in every Starter Pack.',
    image: 'unethical_hoops',
  },
];

/** The starter pack, while it is still unopened: always the first item. */
export const STARTER_NEWS = {
  id: 'starter', date: null, title: 'Your Starter Pack is waiting',
  body: '20 players, 30 strategy cards and Unethical Hoops. Pick the team you support and the pack is built around them.',
  to: 'collection', cta: 'Open it', highlight: true, image: 'unethical_hoops',
};

/** The news in the order the page shows it. */
export function newsFor({ starterOpened = true } = {}) {
  const items = [...NEWS].sort((a, b) => b.date.localeCompare(a.date));
  return starterOpened ? items : [STARTER_NEWS, ...items];
}

// ── Collections ──────────────────────────────────────────────────────────────

/** Special sets with a pack of their own. Dissonance and the WNBA specials have none. */
const SET_PACKS = {
  'set-super-season': 'super_season',
  'set-rookie': 'rookie_pack',
  'set-summer-standouts': 'standouts',
};

/** The pack that feeds a goal, or null when no pack targets it. */
export function packForGoal(goal) {
  let id;
  if (goal.league === 'WNBA') id = goal.kind === 'team' || goal.id === 'wnba-set' ? 'wnba_booster' : null;
  else if (goal.kind === 'team' || goal.kind === 'conference' || goal.id === 'nba-set') id = 'nba_booster';
  else id = SET_PACKS[goal.id] ?? null;
  const def = id ? PACK_TYPES[id] : null;
  return def ? { id, name: def.name, price: def.price } : null;
}

/**
 * THE COLLECTIONS NEAREST DONE. A complete goal that has not been claimed
 * comes first, since a reward is waiting. Then the fewest cards missing, with
 * ties going to the larger share owned and then the name.
 *
 * A goal with nothing owned is not "close". It only fills the list when fewer
 * than `limit` goals have been started. This is the one list sorted by
 * progress: the Collections screen keeps its rows alphabetical (the user,
 * 2026-09-06), and this list exists to answer "which is closest".
 */
export function closestGoals(ownedKeys, { claimed = new Set(), limit = 4 } = {}) {
  const rows = GOALS.map(g => ({ ...goalProgress(g.id, ownedKeys, { missingLimit: 0 }), pack: packForGoal(g) }));
  const ready = rows.filter(r => r.claimable && !claimed.has(r.id)).map(r => ({ ...r, ready: true }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const byClose = (a, b) => a.missingCount - b.missingCount
    || b.owned / b.total - a.owned / a.total
    || a.label.localeCompare(b.label);
  const open = rows.filter(r => !r.complete && r.total > 0);
  const started = open.filter(r => r.owned > 0).sort(byClose);
  const fresh = open.filter(r => r.owned === 0).sort(byClose);
  return [...ready, ...started, ...fresh].slice(0, limit);
}

// ── Seasons ──────────────────────────────────────────────────────────────────

const ordinal = n => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * Where one team stands in a season: the record, the rank out of how many,
 * games behind the leader, the stage, and the next opponent.
 */
export function seasonGlance(season, myId) {
  const table = standings(season);
  const by = teamsById(season);
  const me = table.find(t => t.id === myId) ?? null;
  const leader = table[0] ?? null;
  const gb = me && leader && leader.id !== myId ? ((leader.w - me.w) + (me.l - leader.l)) / 2 : 0;
  const done = season.phase === PHASE.done;
  const f = done ? null : nextFixtureFor(season, myId);
  let next = null;
  if (f) {
    const home = f.home === myId;
    const oppId = home ? f.away : f.home;
    const opp = oppId ? table.find(t => t.id === oppId) : null;
    next = {
      fixtureId: f.id,
      home,
      playoff: Boolean(f.playoff),
      opponent: oppId ? (by.get(oppId)?.name ?? 'TBD') : 'TBD',
      oppRecord: opp ? `${opp.w}–${opp.l}` : null,
      human: Boolean(oppId && by.get(oppId)?.human),
    };
  }
  const stage = done
    ? (season.champion === myId ? 'Champions' : 'Season complete')
    : season.phase === PHASE.playoffs
      ? (next ? 'Playoffs' : 'Out of the playoffs')
      : `Round ${season.round} of ${totalRounds(season)}`;
  return {
    team: by.get(myId)?.name ?? null,
    record: me ? `${me.w}–${me.l}` : '0–0',
    rank: me?.rank ?? null,
    place: me?.rank ? `${ordinal(me.rank)} of ${table.length}` : null,
    gb,
    stage,
    done,
    champion: done && season.champion === myId,
    next,
  };
}

/**
 * The seasons still being played, for the home page: solo seasons (your team
 * is the human one) and live shared seasons (your team is `h:<uid>`).
 * `shared` is `[{ league, season }]` with the season already hydrated.
 */
export function seasonsInProgress({ solo = [], shared = [], uid = null } = {}) {
  const out = [];
  for (const s of solo) {
    if (!s || s.phase === PHASE.done) continue;
    const me = s.teams.find(t => t.human);
    if (!me) continue;
    out.push({
      kind: 'solo', id: s.id,
      title: `${LENGTHS[s.length]?.label ?? 'A'} season · ${s.size} teams`,
      ...seasonGlance(s, me.id),
    });
  }
  for (const { league, season } of shared) {
    if (!league || league.kind !== 'season' || league.status !== 'live' || !season || !uid) continue;
    if (season.phase === PHASE.done) continue;
    out.push({ kind: 'league', id: league.id, title: league.name, ...seasonGlance(season, teamIdFor(uid)) });
  }
  return out;
}

// ── Lifetime stats ───────────────────────────────────────────────────────────

/**
 * Your players' lifetime leaders from the per-card tracker, most points
 * first, with per-game lines. A key whose card left the pool is skipped.
 */
export function careerLeaders(stats, { limit = 5 } = {}) {
  return Object.entries(stats ?? {})
    .map(([key, r]) => ({ key, card: getCardByKey(key), rec: r ?? {} }))
    .filter(r => r.card && (r.rec.games || 0) > 0)
    .sort((a, b) => (b.rec.pts || 0) - (a.rec.pts || 0) || (b.rec.games || 0) - (a.rec.games || 0) || a.key.localeCompare(b.key))
    .slice(0, limit)
    .map(({ key, card, rec }) => {
      const g = rec.games;
      return {
        key, card, games: g, wins: rec.wins || 0, pts: rec.pts || 0,
        ppg: (rec.pts || 0) / g, rpg: (rec.reb || 0) / g, apg: (rec.ast || 0) / g,
      };
    });
}

/** How many of your cards have played, and their points between them. */
export function careerTotals(stats) {
  const rows = Object.values(stats ?? {}).filter(r => (r?.games || 0) > 0);
  return { cards: rows.length, pts: rows.reduce((t, r) => t + (r.pts || 0), 0) };
}
