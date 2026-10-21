// THE PLAY HUB'S CARDS. The user (2026-10-19): "Maybe we collapse all the game
// modes into play and have a menu from there?" — "the modes as cards, with
// resume buttons for what's in progress" — and Dynasty, Tournament and PvP off
// the top bar. Pure: PlayHub.jsx loads the saves and hands them in; each card
// says what the mode is, where you stand in it, and the one button that goes
// there (`to` and `opts` are App's homeGo arguments).
import { describeSave } from './gameSave.js';
import { potPreview } from './modes/run.js';
import { stopById, ACTS, ACT_NAMES } from './modes/climbMap.js';
import { summarizeDynasty, DPHASE } from './modes/dynasty.js';
import { STATUS as LEAGUE_STATUS } from './modes/league.js';

const going = l => l && (l.status === LEAGUE_STATUS.lobby || l.status === LEAGUE_STATUS.live);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** Where a climb stands, in a few words; null with none going. */
export function climbStatus(run) {
  if (!run?.map) return null;
  const coins = potPreview(run).coins;
  const pot = coins ? ` · pot ${coins.toLocaleString('en-US')}` : '';
  const floor = run.at ? stopById(run.map, run.at)?.floor ?? 0 : 0;
  const actLabel = ACT_NAMES[run.act ?? 1];
  switch (run.status) {
    case 'camp': return 'Training Camp next';
    case 'game': {
      const stop = stopById(run.map, run.game?.stopId);
      return `${stop?.kind === 'boss' ? `${actLabel}'s boss game` : `${actLabel}, a floor ${stop?.floor ?? floor + 1} game`} under way${pot}`;
    }
    case 'reward': return `A reward to choose${pot}`;
    case 'rest': return `Rest Day${pot}`;
    case 'won': return (run.act ?? 1) < ACTS ? `${actLabel} beaten: take the pot or keep climbing${pot}` : `All three acts climbed: bank the pot${pot}`;
    case 'retired': return `Retired: bank the pot${pot}`;
    default: return `${actLabel}: ${floor ? `floor ${floor} cleared` : 'floor 1 ahead'}${pot}`;
  }
}

/** Your dynasties in progress (solo, and with friends) in a line; null with none. */
export function dynastyStatus(dynasties = [], leagues = []) {
  const solo = dynasties.filter(d => d && d.phase !== DPHASE.done);
  const friends = leagues.filter(l => l?.kind === 'dynasty' && going(l));
  const n = solo.length + friends.length;
  if (!n) return null;
  if (n > 1) return `${n} in progress`;
  if (friends.length) return `${friends[0].name} · with friends`;
  const d = solo[0];
  try {
    const s = summarizeDynasty(d);
    return `${d.name} · Year ${s.year}${s.years ? ` of ${s.years}` : ''} · ${s.phaseLabel}`;
  } catch {
    return d.name ?? '1 in progress';
  }
}

/** Your seasons in progress (seasonsInProgress rows) in a line; null with none. */
export function seasonStatus(rows = []) {
  if (!rows.length) return null;
  if (rows.length > 1) return `${rows.length} in progress`;
  const r = rows[0];
  const next = r.next ? ` · next: ${r.next.home ? 'vs' : 'at'} ${r.next.opponent}` : '';
  return `${r.title} · ${r.record}${next}`;
}

/**
 * The cards, in a fixed order so they stay where your hand expects them: the
 * game in progress first when there is one, then The Climb, Quick game,
 * Season, Dynasty, Tournament, Online PvP. `loading`: the saves are still on
 * their way, so no mode claims to be fresh yet.
 */
export function hubCards({ save = null, fromOther = false, run = null, dynasties = [], leagues = [], seasons = [], pvp = null, loading = false, now = Date.now() } = {}) {
  const cards = [];
  if (save?.game && !save.game.done) {
    cards.push({
      id: 'game', icon: '▶️', name: 'Game in progress',
      blurb: null, status: describeSave(save, now),
      action: { label: fromOther ? 'Resume here' : 'Resume', to: 'play' },
    });
  }
  const open = (status, resume, start, to, opts) => ({
    label: status ? resume : loading ? 'Open' : start, to, opts: status ? undefined : opts,
  });

  const climb = loading ? null : climbStatus(run);
  cards.push({
    id: 'climb', icon: '🧗', name: 'The Climb',
    blurb: 'Five of your players, seven floors of one-quarter games, a classic team at the top. Wins fill the pot; one loss empties it.',
    status: climb, action: open(climb, 'Resume', 'Start a climb', 'climb'),
  });

  cards.push({
    id: 'quick', icon: '🏀', name: 'Quick game',
    blurb: 'One game against the coach, or play both sides yourself.',
    status: null,
    note: cards[0].id === 'game' ? 'One game at a time: finish or abandon the one in progress first.' : null,
    action: { label: 'New game', to: 'play', disabled: cards[0].id === 'game' },
  });

  const season = loading ? null : seasonStatus(seasons);
  const one = seasons.length === 1 ? seasons[0] : null;
  cards.push({
    id: 'season', icon: '📅', name: 'Season',
    blurb: 'A schedule against coached teams or friends: standings, playoffs and awards.',
    status: season,
    action: season
      ? { label: 'Resume', to: 'season', opts: one ? (one.kind === 'league' ? { leagueId: one.id } : { seasonId: one.id }) : undefined }
      : { label: loading ? 'Open' : 'Start a season', to: 'season', opts: loading ? undefined : { action: 'new' } },
  });

  const dynasty = loading ? null : dynastyStatus(dynasties, leagues);
  cards.push({
    id: 'dynasty', icon: '👑', name: 'Dynasty',
    blurb: 'Years running a franchise: the draft, contracts, trades and free agency, alone or with friends.',
    status: dynasty, action: open(dynasty, 'Resume', 'Start a dynasty', 'dynasty'),
  });

  const brackets = loading ? [] : leagues.filter(l => l?.kind === 'tournament' && going(l));
  const tournament = brackets.length === 1 ? brackets[0].name : brackets.length ? plural(brackets.length, 'bracket', 'brackets') + ' under way' : null;
  cards.push({
    id: 'tournament', icon: '🏆', name: 'Tournament',
    blurb: 'A bracket with friends: pay in, win or go home, the pot to the winners.',
    status: tournament, action: open(tournament, 'Resume', 'Open', 'tournament'),
  });

  const room = pvp?.roomCode ? `In room ${pvp.roomCode}` : null;
  cards.push({
    id: 'pvp', icon: '⚔️', name: 'Online PvP',
    blurb: 'A live game against a friend, by room code.',
    status: room, action: open(room, 'Resume', 'Find a game', 'pvp'),
  });
  return cards;
}
