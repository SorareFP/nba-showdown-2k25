// SINGLE-ELIMINATION BRACKETS — tournaments and season playoffs.
//
// A bracket is a list of matches. Round 1 is dealt from the entrants; every
// later match starts empty and is filled as the feeding matches report. The
// standard seeding puts 1 against the lowest seed, 2 against the next, and so
// on, so the top two can only meet in the final.

// 2 is a straight final — what a four-team season's playoff is. Tournaments
// offer 4 and up (prizes.js), but the bracket itself is happy with a pair.
export const BRACKET_SIZES = [2, 4, 8, 16, 32];

/** Seed order for a power-of-two field: [1,8,4,5,2,7,3,6] for 8, and so on. */
export function seedOrder(size) {
  let order = [1];
  while (order.length < size) {
    const next = [];
    const m = order.length * 2 + 1;
    for (const s of order) next.push(s, m - s);
    order = next;
  }
  return order;
}

/**
 * Deal a bracket. `entrants` are ids in seed order (best first). With
 * `random: true` the order is shuffled first (tournaments); a playoff passes
 * its standings order and keeps it.
 */
export function makeBracket(entrants, { random = false, rng = Math.random } = {}) {
  const size = entrants.length;
  if (!BRACKET_SIZES.includes(size)) throw new Error(`bracket: size ${size} is not one of ${BRACKET_SIZES.join('/')}`);
  const seeds = [...entrants];
  if (random) {
    for (let i = seeds.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [seeds[i], seeds[j]] = [seeds[j], seeds[i]];
    }
  }
  const order = seedOrder(size);
  const matches = [];
  const rounds = Math.log2(size);
  // Round 1 from the seed order, pairs adjacent in `order`.
  for (let i = 0; i < size; i += 2) {
    matches.push({
      id: `r1m${i / 2 + 1}`, round: 1, slot: i / 2,
      a: seeds[order[i] - 1], b: seeds[order[i + 1] - 1],
      seedA: order[i], seedB: order[i + 1],
      winner: null, result: null,
    });
  }
  let inRound = size / 2;
  for (let r = 2; r <= rounds; r += 1) {
    inRound /= 2;
    for (let s = 0; s < inRound; s += 1) {
      matches.push({ id: `r${r}m${s + 1}`, round: r, slot: s, a: null, b: null, seedA: null, seedB: null, winner: null, result: null });
    }
  }
  return { size, rounds, seeds, matches };
}

/** The match a winner of `match` feeds, or null from the final. */
export function feeds(bracket, match) {
  if (match.round >= bracket.rounds) return null;
  return bracket.matches.find(m => m.round === match.round + 1 && m.slot === Math.floor(match.slot / 2)) ?? null;
}

/**
 * Report a match: returns a new bracket with the winner recorded and placed
 * in the next round (side `a` from an even slot, `b` from an odd one).
 * `result` is kept verbatim for the record ({ scoreA, scoreB, ... }).
 */
export function reportMatch(bracket, matchId, winnerId, result = null) {
  const matches = bracket.matches.map(m => ({ ...m }));
  const match = matches.find(m => m.id === matchId);
  if (!match) throw new Error(`bracket: no match ${matchId}`);
  if (match.winner) throw new Error(`bracket: ${matchId} already has a winner`);
  if (match.a == null || match.b == null) throw new Error(`bracket: ${matchId} is not ready`);
  if (winnerId !== match.a && winnerId !== match.b) throw new Error(`bracket: ${winnerId} is not in ${matchId}`);
  match.winner = winnerId;
  match.result = result;
  const next = bracket.matches.find(m => m.round === match.round + 1 && m.slot === Math.floor(match.slot / 2));
  if (next) {
    const target = matches.find(m => m.id === next.id);
    const seed = winnerId === match.a ? match.seedA : match.seedB;
    if (match.slot % 2 === 0) { target.a = winnerId; target.seedA = seed; } else { target.b = winnerId; target.seedB = seed; }
  }
  return { ...bracket, matches };
}

/** Matches that have both sides and no winner yet. */
export function readyMatches(bracket) {
  return bracket.matches.filter(m => m.a != null && m.b != null && !m.winner);
}

/** The lowest round with anything still to play, or null when done. */
export function currentRound(bracket) {
  const open = bracket.matches.filter(m => !m.winner);
  return open.length ? Math.min(...open.map(m => m.round)) : null;
}

/** The champion once the final is decided, else null. */
export function champion(bracket) {
  const final = bracket.matches.find(m => m.round === bracket.rounds);
  return final?.winner ?? null;
}

/** The runner-up once the final is decided, else null. */
export function runnerUp(bracket) {
  const final = bracket.matches.find(m => m.round === bracket.rounds);
  if (!final?.winner) return null;
  return final.winner === final.a ? final.b : final.a;
}

/** The next unplayed match a team is in, if it is still alive. */
export function nextMatchFor(bracket, teamId) {
  return bracket.matches.find(m => !m.winner && (m.a === teamId || m.b === teamId)) ?? null;
}

/** How many matches a team has won in this bracket. */
export function winsFor(bracket, teamId) {
  return bracket.matches.filter(m => m.winner === teamId).length;
}

/** Whether a team has lost, i.e. is out. */
export function eliminated(bracket, teamId) {
  return bracket.matches.some(m => m.winner && m.winner !== teamId && (m.a === teamId || m.b === teamId));
}
