// WHO WON, FROM THE PLAYER'S CHAIR — the one answer the reward claim, the
// game-over headline and the season report all read.
//
// The game-over screen used to say "self-play always has a winner" and
// claim a win whenever the score was not tied — true when solo meant one
// person playing both benches, and a Victory Bonus for a game lost to the
// coach once solo meant a human on A against the AI on B (the user,
// 2026-09-09: "I just got a victory bonus in a game I lost to the AI").

/**
 * `mode`: 'ai' (you coach A, the coach B), 'hotseat' (two people, one
 * screen — nobody is "you", so no win), or 'pvp' (your side is `myTeamKey`).
 * A tie is never a win.
 */
export function humanWon(game, { mode = 'ai', myTeamKey = null } = {}) {
  if (!game?.teamA || !game?.teamB) return false;
  const a = game.teamA.score ?? 0;
  const b = game.teamB.score ?? 0;
  if (a === b) return false;
  const mine = mode === 'pvp' ? myTeamKey : mode === 'ai' ? 'A' : null;
  if (!mine) return false;
  return mine === 'A' ? a > b : b > a;
}

/** The key of the human's team for the box score and the claim, or null in hotseat. */
export function humanTeamKey({ mode = 'ai', myTeamKey = null } = {}) {
  return mode === 'pvp' ? myTeamKey : mode === 'ai' ? 'A' : null;
}
