/**
 * Stub — dunksandthrees.com's game-log API isn't available yet (pending
 * access). Same interface as basketballReference.js's fetchGameLog so the
 * orchestrator can swap sources without other code changes once this is
 * real.
 */
export async function fetchGameLog(playerId, season) {
  throw new Error('dunksandthrees.com game-log source not yet available — use sources/basketballReference.js');
}
