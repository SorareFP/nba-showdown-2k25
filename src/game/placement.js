// PLACEMENT, AND TAKING ONE BACK.
//
// placePlayer is the solo snake step CourtBoard used to do inline: the side
// whose turn it is puts one of its picks in its next open row. PvP places
// through its own handler (each side's picks are private to the room) but
// undoes with the helpers below.
//
// UNDO (2026-09-10). The user: "We need an undo button that applies to
// placing a player on the mat for player matchups. Against the AI, you can
// undo the last player you place down until you place another player down.
// In PvP, you can only undo until the opponent places someone down. I have
// fat-fingered the wrong player too many times."
//
// When you place, the game as it stood before your pick is kept, and Undo
// puts it back. Undo stays available while:
//   - it is the same section and nothing but placements has happened since.
//     A card played, a pass or a lock writes some other log line, and that
//     ends it;
//   - against the coach, you have not placed again. The coach's replies are
//     placements made in answer to yours, so they come back with it, and the
//     coach answers the corrected pick;
//   - in PvP, your opponent has not placed.
// A second pick of your own in a row (the snake deals two) takes a fresh
// snapshot, so Undo always means the last player you put down.

const DEFAULT_ORDER = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'];
const orderOf = g => g.placementOrder || DEFAULT_ORDER;
const teamOf = (g, k) => (k === 'A' ? g.teamA : g.teamB);
const clone = g => JSON.parse(JSON.stringify(g));

/** The side whose placement is next, or null once all ten are down. */
export function placingTeam(game) {
  const step = game?.placementStep ?? 10;
  return step < 10 ? orderOf(game)[step] : null;
}

/**
 * The next placement: `playerId`, one of the placing side's picks, takes
 * that side's next open row. Returns the new game, or null when the pick is
 * not legal (not a pick, already down, or placement is over).
 */
export function placePlayer(game, playerId) {
  const step = game?.placementStep ?? 10;
  if (step >= 10) return null;
  const g = clone(game);
  const teamKey = orderOf(g)[step];
  const team = teamOf(g, teamKey);
  const picks = teamKey === 'A' ? g.draft?.aPicks ?? [] : g.draft?.bPicks ?? [];
  if (!picks.includes(playerId) || team.starters.some(pl => pl.id === playerId)) return null;
  const player = (team.roster || []).find(r => r.id === playerId);
  if (!player) return null;
  team.starters.push(player);
  g.placementStep = step + 1;
  g.log = [...g.log, { team: teamKey, msg: `${player.name} takes the floor.` }];
  if (g.placementStep === 10) {
    g.matchupTurn = 'A';
    g.matchupPasses = 0;
    g.log = [...g.log, { team: null, msg: 'Placement complete — Matchup Strategy Phase.' }];
  }
  return g;
}

/** Taken the moment a coach places: the game before the pick. Null outside placement. */
export function placementSnapshot(game) {
  const teamKey = placingTeam(game);
  if (!teamKey) return null;
  return { before: clone(game), teamKey, step: game.placementStep, logLen: (game.log ?? []).length };
}

// The closing line each placement path writes when the tenth player is down.
const CLOSING_LINE = /^(Placement complete|All ten on the floor)/;

/**
 * Whether everything since the snapshot is placements and nothing else. Each
 * step's line must be exactly that player taking the floor, in snake order,
 * so a card's log line, or a starter moved by anything but placement, fails it.
 */
function onlyPlacementsSince(game, snap) {
  const b = snap.before;
  const i0 = snap.logLen - 1;
  if (i0 >= 0 && JSON.stringify(game.log?.[i0]) !== JSON.stringify(b.log?.[i0])) return false;
  const order = orderOf(game);
  const since = (game.log ?? []).slice(snap.logLen);
  const count = { A: teamOf(b, 'A').starters.length, B: teamOf(b, 'B').starters.length };
  let i = 0;
  for (let s = snap.step; s < (game.placementStep ?? 10); s += 1) {
    const k = order[s];
    const pl = teamOf(game, k).starters[count[k]];
    count[k] += 1;
    const line = since[i];
    i += 1;
    if (!pl || !line || line.team !== k || line.msg !== `${pl.name} takes the floor.`) return false;
  }
  if (teamOf(game, 'A').starters.length !== count.A || teamOf(game, 'B').starters.length !== count.B) return false;
  return since.slice(i).every(l => l && l.team == null && CLOSING_LINE.test(l.msg ?? ''));
}

/** Whether `snap` can still be undone on `game`. `pvp` stops it at the opponent's pick. */
export function canUndoPlacement(game, snap, { pvp = false } = {}) {
  if (!snap || !game || game.done || game.phase !== 'matchup_strats') return false;
  if (game.quarter !== snap.before.quarter || game.section !== snap.before.section) return false;
  const step = game.placementStep ?? 10;
  if (step <= snap.step) return false;
  const placers = orderOf(game).slice(snap.step, step);
  if (placers[0] !== snap.teamKey) return false;
  if (placers.slice(1).includes(snap.teamKey)) return false;   // placed again: that pick has its own snapshot
  if (pvp && placers.length > 1) return false;                 // the opponent has answered
  return onlyPlacementsSince(game, snap);
}

/** The player an undo would take back off the floor. */
export function takenBackName(game, snap) {
  if (!game || !snap) return null;
  return teamOf(game, snap.teamKey).starters[teamOf(snap.before, snap.teamKey).starters.length]?.name ?? null;
}

/** The game with your last placement (and any reply to it) taken back. */
export function undoPlacement(game, snap) {
  const name = takenBackName(game, snap);
  const g = clone(snap.before);
  g.log = [...(g.log ?? []), { team: snap.teamKey, msg: `↩ ${name ?? 'A placement'} taken back.` }];
  return g;
}
