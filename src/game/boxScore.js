// ONE TEAM'S BOX SCORE for a finished game — the lifetime tracker's input.
//
// Only players who took the floor count: a bench player who never played a
// section did not play the game, and a 0-0-0 line for him would drag every
// average he ever earns. The key is the collection key (cardKey), so a Rookie
// card and a base card of the same player keep separate records — they are
// different cards.
import { cardKey } from './cardSets.js';
import { getTeam } from './engine.js';

export function boxScoreFor(game, teamKey) {
  const t = getTeam(game, teamKey);
  if (!t) return [];
  const byId = new Map((t.stats ?? []).map(s => [s.id, s]));
  return (t.roster ?? [])
    .map(card => ({ card, ps: byId.get(card.id) }))
    .filter(({ ps }) => ps && (ps.totalMinutes || 0) > 0)
    .map(({ card, ps }) => ({
      key: cardKey(card),
      pts: ps.pts || 0,
      reb: ps.reb || 0,
      ast: ps.ast || 0,
      min: ps.totalMinutes || 0,
      tpm: ps.threepm || 0,
      tpa: ps.threepa || 0,
    }));
}
