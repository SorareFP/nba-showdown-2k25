// ONE TEAM'S BOX SCORE for a finished game — the lifetime tracker's input,
// and since 2026-09-08 a season's too (seasonCore folds it into the season's
// running totals).
//
// Only players who took the floor count: a bench player who never played a
// section did not play the game, and a 0-0-0 line for him would drag every
// average he ever earns. The key is the collection key (cardKey), so a Rookie
// card and a base card of the same player keep separate records — they are
// different cards.
//
// No engine import on purpose: functions/prepare.mjs copies this file into
// the server bundle, where league.js reads a PvP room's finished game.
import { cardKey } from './cardSets.js';

/** The lines of one team object ({ roster, stats }) — a game's teamA/teamB, or a room's. */
export function boxLinesFor(team) {
  if (!team) return [];
  const byId = new Map((team.stats ?? []).map(s => [s.id, s]));
  return (team.roster ?? [])
    .map(card => ({ card, ps: byId.get(card.id) }))
    .filter(({ card, ps }) => card && ps && (ps.totalMinutes || 0) > 0)
    .map(({ card, ps }) => ({
      key: cardKey(card),
      pts: ps.pts || 0,
      reb: ps.reb || 0,
      ast: ps.ast || 0,
      min: ps.totalMinutes || 0,
      tpm: ps.threepm || 0,
      tpa: ps.threepa || 0,
      // Points allowed to the man he guarded (creditAllowed, engine.js).
      alw: ps.alw || 0,
      // The finer line (engine.js stats init): started, free throws, paint
      // checks, checks against, blocks, on-floor points for and against.
      gs: ps.gs ? 1 : 0,
      fta: ps.fta || 0,
      ftm: ps.ftm || 0,
      pnta: ps.pnta || 0,
      pntm: ps.pntm || 0,
      dca: ps.dca || 0,
      dcm: ps.dcm || 0,
      blk: ps.blk || 0,
      onf: ps.onf || 0,
      ona: ps.ona || 0,
    }));
}

export function boxScoreFor(game, teamKey) {
  if (!game) return [];
  return boxLinesFor(teamKey === 'A' ? game.teamA : game.teamB);
}
