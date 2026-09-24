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
    id: 'dogged-rare', date: '2026-09-24', title: 'Dogged is a rare',
    body: 'Dogged (−2 Speed and −2 Power on a fatigued opponent) was far stronger than a common, so it is now a rare: one printed copy and a rare\'s share of packs.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'rebound-lead', date: '2026-09-24', title: 'Rebound cards need the lead',
    body: 'A strategy card that spends rebounds now needs your team to lead the rebound battle by at least what it spends, so playing it can never hand the lead (and its end-of-section assist) to the other side. The 5-rebound paint check is unchanged.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'zigzag-court', date: '2026-09-24', title: 'The court fits a big monitor',
    body: 'On a wide screen the ten players now stand as cards in two zig-zags, your five on the left and the coach\'s on the right, instead of five rows, so a whole game fits without scrolling. The number on each card pairs the matchups; hover a card to bring it to the front and outline the man it faces, and hold for two seconds to see the whole card. Laptops and phones keep the rows.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'glass-cards', date: '2026-09-23', title: 'Four cards for the glass',
    body: 'New strategy cards for teams that win the boards, now in packs: Kick-Out Three (after your miss, 2 REB sends a 3PT check to a shooter on the kick-out), Grab and Go (3 REB become 2 AST), Rebound and Push (after their miss, 2 REB and your defender on the shooter takes a paint check at +1) and Own the Glass (lead the Rebound Track by 6: 5 REB for two paint checks at +1). Placeholder art for now.',
    to: 'shop', cta: 'Shop',
  },
  {
    id: 'rebounds-spend', date: '2026-09-23', title: 'Rebounds spend like assists',
    body: 'Your rebounds are a currency now: 5 REB buys a paint check for any player, any time, the same price as the assist paint check. Winning a section on the glass still pays: +1 assist, and a lead of 3 or more puts your next rebound check at +2. Teams used to finish games with 30 rebounds they could never use; a big front line now turns them into points.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'wide-screens', date: '2026-09-23', title: 'Built for a big monitor',
    body: 'On a wide screen the app now uses the width: more cards per row in your collection, collection goals side by side, and in a game the court is a size larger with the game log and analytics open in a rail beside it, so a whole game reads without scrolling. Laptops and phones look exactly as before.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'recover-game', date: '2026-09-23', title: 'A game in progress is never lost',
    body: 'Any game in progress that gets replaced or cleared — another device, a new game, a crash, even one you abandon — is kept. Play and Home offer it under "Recover a game", and Resume puts you back where you were. If a screen ever breaks, it now says so and offers to reload instead of going blank.',
    to: 'play', cta: 'Play',
  },
  {
    id: 'wave-two-twins', date: '2026-09-23', title: 'Five new strategy cards',
    body: 'The twins the deck was missing, now in packs: Blow-By (Speed 13+ and hot: +2 pts, another hot marker), Point God (a Speed edge before he rolls: his assists doubled), Passing Lane (cancel a roll\'s assists, one more with the Speed edge), Clamp the Reserve (an opposing $400 man still to roll keeps the lower die) and Feeling It (your hot marker draws two). Placeholder art for now.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'dynasty-staff', date: '2026-09-23', title: 'Hire a front office',
    body: 'Franchise Points now hire staff, three tiers a role, kept for the dynasty: a Head Scout (a graded class, the AI\'s mock board, +25% lottery weight, a steal after the last pick), a Cap Strategist (every free agent\'s floor shown, your own players re-sign 10% under their ask, a 125-DP apron) and, in an aging dynasty, Sports Science (retirement starts later, one protected player a year). Tiers cost 3, 6 and 12 — a full role is a legendary\'s worth of points.',
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'legendary-odds', date: '2026-09-23', title: 'Where the Legendaries are',
    body: 'Nobody had packed a Legendary yet — about one booster in seventy carries one. Now every premium pack carries its own chance, and the dearer the pack the better the rate: Rare Deluxe about one pack in nine, Super Deluxe one in four, Mega Deluxe one in two, the Chase still the only sure thing. The Super Season and Summer Standouts packs deal their sets\' own odds — most of a pack rare or better — and are priced for it: 450 and 350.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'pack-rip', date: '2026-09-23', title: 'Tear the pack open',
    body: 'Every pack now arrives sealed: drag across the top to tear it, or tap. A Super Rare or a Legendary lands with a flash, a stamp and confetti — and a horn for the Legendary. And a claimed collection\'s reward chip opens the reward card itself.',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'franchise-points', date: '2026-09-22', title: 'Franchise Points, and a deck you can change',
    body: 'A dynasty now pays its coaches in Franchise Points as each year closes: your regular-season finish (first of the league is 10), 3 for every playoff series you win, 10 for the title, all weighted by the coach rung. Spend them in the offseason to bring a card you own into the league — a common for 2, a rare for 8, a legendary for 32 — and the player signs at his value for two years under the cap. And your strategy deck is no longer frozen at the start: change it in the Front Office or between rounds, alone or with friends.',
    to: 'dynasty', cta: 'Dynasty',
  },
  {
    id: 'reward-identities', date: '2026-09-22', title: 'Reward cards wear their identity',
    body: 'Every Team and Set reward now prints in the look of what it is — gold for a Super Season, green for a Rookie, the Throwback brush for a season that was neither, its own for a playoff run — with the reward pill on top. Three franchise rewards were re-picked after Kawhi Leonard\'s move to Toronto and Brandon Ingram\'s to the Clippers: Toronto pays Vince Carter\'s 1999-2000, Washington John Wall\'s 2016-17 (his Super Season card), and the Clippers Elton Brand\'s 2002-03. New cards: Super Seasons for Wall, Brand (2005-06), Gilbert Arenas (2005-06), DeAndre Jordan (2014-15) and Anthony Parker (2006-07), Rookie cards for Wall, Brand, Arenas and Jordan, Bradley Beal\'s 2020-21 as a Throwback, and Ivica Zubac\'s 2024-25 back in Super Season. Because those sets grew, the Super Season and Rookie collections — and the East and West conference collections, which swapped Kawhi and Ingram — reopen for anyone who had finished them; the capstone you already earned is yours.',
    to: 'collection', cta: 'See the rewards',
  },
  {
    id: 'wnba-team-packs', date: '2026-09-21', title: 'WNBA Team Packs, and plain free throws',
    body: 'The Pack Shop sells a WNBA Team Pack: five players from one WNBA roster and a strat, 250 coins, priced against the NBA Team Pack by what comes out. And Unethical Hoops draws four plain free throws now: the +4 on each check is gone (a free throw carries its own +10).',
    to: 'shop', cta: 'Pack Shop',
  },
  {
    id: 'coin-fixes', date: '2026-09-18', title: 'What a game pays: four fixes',
    body: 'A harder coach\'s premium is now a win\'s: a loss pays the standard rate at King and Deity (below Prince the discount stays). A game where you built the coach\'s team or picked its deck, or a Quick Match, pays at most the standard rate — the premium is for beating a team the coach drew itself. A finished game is paid once, however often the page reloads, and it keeps the difficulty and the opponent it was dealt with. Season and dynasty title money is paid by the share of your own games you played — simmed ones do not count.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'tired-checks', date: '2026-09-16', title: 'Tired legs miss shots too',
    body: 'The fatigue tracker\'s penalty now applies to 3PT and paint checks the way it applies to scoring rolls — the rules pages had said so all along; the dice had not. Free throws are exempt. A trial: say so if it plays wrong.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'difficulty-ladder', date: '2026-09-16', title: 'The coach\'s ladder, reshaped',
    body: 'Prince is now the fair game and the default: the full search on an even roster, at the standard rate. Below it the coach is handicapped and games pay less. Above it the coach\'s team gets better — King and Deity draft to a richer cap and read more of your lineups — and games pay more, up to 1.5× on Deity. PvP pays the top rate. A season or dynasty pays at the rung it was built at, so turn the coach down whenever you like.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'twelve-minutes', date: '2026-09-16', title: 'Twelve straight minutes is the limit',
    body: 'A player at twelve minutes on the tracker sits the next section — you and the coach alike — and a section on the bench clears the tracker at eight minutes or under — two on, one off, fresh again — while a player pushed past eight gets only four back. The fourth quarter and overtime lift the limit; halftime resets everything. Season and dynasty sims follow the same rule, so the 40-point averages are gone.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'free-agent-filters', date: '2026-09-16', title: 'Free Agents: browse by season, team and salary',
    body: 'Pick a season or a team to see everyone the archive has — every 1995-96 Cavalier, best-paid first — and narrow by salary either way. A name still works on its own.',
    to: 'freeagents', cta: 'Free Agents',
  },
  {
    id: 'cards-reworked', date: '2026-09-16', title: 'Three cards reworked',
    body: 'Burst of Momentum fires on a top-tier roll of 3+ points (a top band never paid 5, so it never fired). Post Domination reads the matchup: a player with a Power advantage over his defender, before he rolls, doubles his rebounds this period. Dogged fires at any opponent with minutes on the fatigue tracker. Burst and Post Domination join the default fifty; Cross-Court Dime and Turnover leave it.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'commissioner-tools', date: '2026-09-16', title: 'Commissioner\'s tools for a dynasty with friends',
    body: 'The host can sim the coaches\' games — it asks twice and refuses a game open in a room — and can delete the dynasty outright by typing its name. A declined Free Agents invoice can be sent again.',
    to: 'dynasty', cta: 'Go to Dynasty',
  },
  {
    id: 'season-in-dynasty', date: '2026-09-11', title: 'Seasons now live in Dynasty',
    body: 'One tab for leagues: a single season, a ten-year dynasty, or either with friends. Your seasons in progress are right where you left them — under One season in the Dynasty tab.',
    to: 'season', cta: 'Your seasons',
  },
  {
    id: 'dynasty-friends', date: '2026-09-11', title: 'Dynasty with friends',
    body: 'Run one dynasty together: each of you coaches a team and AI teams fill the rest. Draft on a twelve-hour clock, bid sealed through three weeks of free agency, trade with each other (the commissioner can veto), and move on when everyone is ready. Each year\'s title money goes straight to every coach.',
    to: 'dynasty', cta: 'Start one',
  },
  {
    id: 'dynasty', date: '2026-09-11', title: 'Dynasty mode: ten years, one league',
    body: 'Bring your own team or fantasy-draft the league, then sign everyone with Dynasty Points. Every player has a personality to haggle with, your own free agents talk only to you, the lottery hands out a class of legends and rookies, and the AI bids against you in free agency. Finish all ten years for a coin bonus; a fantasy-draft start pays half, so bring your own team for the full amount.',
    to: 'dynasty', cta: 'Start a dynasty',
  },
  {
    id: 'margin-coins', date: '2026-09-11', title: 'Wins pay by the margin',
    body: 'The victory bonus now scales with how much you win by: 20 coins for a one-point squeaker, up to 100 for a 50-point blowout (PvP pays half again). Losing by five or fewer, or a tie, pays 15 on top of the coins for finishing.',
    to: 'play', cta: 'Play a game',
  },
  {
    id: 'overtime', date: '2026-09-11', title: 'No more ties: overtime',
    body: 'A game tied after regulation now goes to overtime — another Crunch-Time section at any margin, with a fresh timeout and Clutch Possession for each side, and another after that if it is still tied. In every game: against the coach, in PvP, and in every simulated season fixture.',
    to: 'play', cta: 'Play a game',
  },
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
    body: 'When the regular season ends the league names an MVP (value over replacement), a Defensive Player of the Year (fewest points allowed per minute, 16 minutes a game to qualify), a Sixth Player, a Rookie of the Year and a Scoring Title.',
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
    body: 'The sign-up card. In Crunch Time, a player of yours with a Speed or Power advantage draws the foul: four free-throw checks. One comes in every Starter Pack.',
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
