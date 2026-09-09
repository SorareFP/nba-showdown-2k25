/**
 * The strategy-card audit: AI vs AI, full rules, every card counted.
 *
 *   node scripts/analysis/runStratAudit.js [games]
 *
 * runChannelSplit measures the SCORING engine with no cards in it; this
 * drives the whole game the way the AI actually plays it — blind fives,
 * the placement snake, the matchup and scoring card phases through aiTurn,
 * shot-check reactions through aiReactionDecision, conversion spends, and
 * endSection's rotation — and counts what every strategy card actually did:
 * how often it was held, how often the AI chose it, and how the games it was
 * played in came out.
 *
 * TWO GAPS THIS AUDIT EXPOSED BEFORE IT RAN, wired here so the measurement
 * reflects a competent table rather than the current UI's blind spots:
 *   - the AI never spends assists/rebounds in live games (no spendAssist
 *     caller in ai.js) — here both sides spend greedily, as runChannelSplit
 *     established;
 *   - aiReactionDecision has NO caller in any component, so reaction cards
 *     are dead weight in real solo games. Here the shot-check window offers
 *     the defence its reaction, which is the minimum wiring for Close Out
 *     to mean anything.
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import {
  newGame, doRoll, endSection, applyMatchups, spendAssist, spendReboundBonus, STARTERS,
  spendTimeout, endTimeout, searchCrunchCard,
} from '../../src/game/engine.js';
import { execCard, resolvePendingShotCheck, resolveGoUnder } from '../../src/game/execCard.js';
import { STRATS, getStrat, CRUNCH_CARDS } from '../../src/game/strats.js';
import { getStratRarity, STRAT_COPY_CAPS } from '../../src/game/rarity.js';
import {
  aiDraftPick, aiPlacementPick, aiTurn, aiScoringDecision, aiRollDecision, aiReactionDecision,
  aiSpendDecision, aiCrunchDecision, aiCrunchSearch, aiSetMatchups, aiGoUnderChoice,
} from '../../src/game/ai.js';

const GAMES = Number(process.argv[2] ?? 400);
const SHIFT_A = Number((process.argv.find(a => a.startsWith('--shift-a=')) ?? '--shift-a=0').split('=')[1]) || 0;

/**
 * ── ABLATION: --ablate=card_id[,card_id] ────────────────────────────────────
 *
 * The lift column cannot tell a strong CARD from a favourable CONDITION.
 * Desperation Press proves it: its own text is "CRUNCH TIME, and you are
 * trailing", so it is only ever played from behind and reads -60. Every
 * conditional card is contaminated the same way, upward or downward — the
 * column measures how good a card's SITUATION is, not how good the card is.
 *
 * The only clean answer is a paired experiment, and the seeded draft above
 * already makes one possible: this run and a run without the flag deal exactly
 * the same rosters, the same decks and the same hands, because `seed` is fixed
 * and consumed in the same order. Ablating makes the named cards UNPLAYABLE —
 * the holder plays their next-best card instead — so the delta between the two
 * runs is what the card is worth OVER ITS ALTERNATIVE, which is the question
 * rarity is actually asking.
 *
 * `win% when held` is the column to compare; it counts every game a side had
 * the card, played or not, so both arms measure the same population.
 *
 *   node scripts/analysis/runStratAudit.js 1500 --full
 *   node scripts/analysis/runStratAudit.js 1500 --full --ablate=twin_towers
 *
 * ONE CAVEAT THAT CANNOT BE ENGINEERED AWAY: the two runs diverge the moment
 * a different card is played, because the engine draws from the same stream.
 * Pairing controls the setup, not the whole game, so treat a few points as
 * noise and read only the large deltas.
 */
const ABLATE = new Set(
  (process.argv.find(a => a.startsWith('--ablate=')) ?? '').split('=')[1]?.split(',').map(x => x.trim()).filter(Boolean) ?? []
);
const SECTIONS = 12;
const SET = path.join(REPO_ROOT, 'card-data', 'generated', 'cards-2026-27.json');
const CARDS = JSON.parse(fs.readFileSync(SET, 'utf8')).cards;

// Deterministic-ish RNG so runs are comparable.
let seed = 20260901;
const rng = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 2 ** 32;
};

const stats = new Map(STRATS.map(s => [s.id, {
  id: s.id, name: s.name, phase: s.phase, held: 0, plays: 0, winsWhenPlayed: 0, gamesPlayed: 0,
  // THE CONTROL GROUP. "Win% when played" cannot tell a strong CARD from a
  // strong CONDITION: a card that only qualifies on a stacked roster will look
  // brilliant because stacked rosters win. These count the games where a side
  // HELD the card and did not play it — same card, same deck, and for a
  // conditional card usually the same kind of roster that failed the gate. The
  // gap between the two columns is the part that is about the card.
  gamesHeldUnplayed: 0, winsWhenHeldUnplayed: 0, winsWhenHeld: 0,
}]));

/**
 * The placement snake: the five each side picked go down one at a time,
 * A-B-B-A-A-B-B-A-A-B, each pick answering the row — the matchup assignment
 * the live game makes. Mirrors runSnake in src/game/modes/simulate.js.
 */
function runSnake(g) {
  g.draft.aPicks = g.teamA.starters.map(p => p.id);
  g.draft.bPicks = g.teamB.starters.map(p => p.id);
  g.teamA.starters = []; g.teamB.starters = [];
  g.placementStep = 0;
  g.phase = 'matchup_strats';
  const order = g.placementOrder;
  for (let step = 0; step < 10; step += 1) {
    const key = order[step];
    const pick = aiPlacementPick(g, key);
    if (!pick) break;
    const team = key === 'A' ? g.teamA : g.teamB;
    team.starters.push((team.roster || []).find(r => r.id === pick.playerId));
    g.placementStep = step + 1;
  }
  for (const key of ['A', 'B']) {
    const team = key === 'A' ? g.teamA : g.teamB;
    const picks = key === 'A' ? g.draft.aPicks : g.draft.bPicks;
    const down = new Set(team.starters.map(p => p.id));
    for (const id of picks) if (!down.has(id)) team.starters.push((team.roster || []).find(r => r.id === id));
  }
  g.placementStep = 10;
  return g;
}

function draftRoster(taken = new Set()) {
  const pool = CARDS.filter(c => !taken.has(c.id));
  const picks = [];
  while (picks.length < 10 && pool.length) {
    const i = Math.floor(rng() * pool.length);
    picks.push(pool.splice(i, 1)[0]);
  }
  for (const p of picks) taken.add(p.id);
  return picks;
}

/** Count every card id in both hands once per game (held = ever in hand). */
function tallyHands(g, heldThisGame) {
  for (const key of ['A', 'B']) {
    for (const id of (key === 'A' ? g.teamA : g.teamB).hand ?? []) heldThisGame.add(`${key}|${id}`);
  }
}

function safeResolve(g) {
  // The AI occasionally opens a check on a target the engine cannot find
  // (an opts edge the UI's pickers would have prevented). The audit clears
  // it rather than crashing four hundred games on one decision.
  const pend = g.pendingShotCheck;
  if (!pend) return g;
  const target = (pend.teamKey === 'A' ? g.teamA : g.teamB).starters[pend.playerIdx];
  if (!target) { const ng = { ...g, pendingShotCheck: null }; return ng; }
  try { return resolvePendingShotCheck(g); }
  catch { return { ...g, pendingShotCheck: null }; }
}

function tryPlay(g, teamKey, action, playedThisGame) {
  // An ablated card is simply not there to be played. Everything else about
  // the game — the roster, the deck, the hand, the draw order — is identical
  // to the un-ablated run.
  if (ABLATE.has(action.cardId)) return { g, played: false };
  let r;
  try { r = execCard(g, teamKey, action.cardId, action.opts || {}); }
  catch { return { g, played: false }; }
  if (!r.ok) return { g, played: false };
  playedThisGame.add(`${teamKey}|${action.cardId}`);
  let ng = r.game;
  // Go Under: the offence names its shooter, then the check is taken.
  if (ng.pendingChoice?.kind === 'go_under') {
    const off = ng.pendingChoice.teamKey;
    const rr = resolveGoUnder(ng, aiGoUnderChoice(ng, off));
    ng = rr.ok ? rr.game : { ...ng, pendingChoice: null };
  }
  // A card that opens a shot check hands the DEFENCE its reaction window
  // before the die is cast — the wiring live solo games are missing.
  if (ng.pendingShotCheck) {
    const defKey = ng.pendingShotCheck.teamKey === 'A' ? 'B' : 'A';
    const react = aiReactionDecision(ng, defKey, 'shot_check');
    if (react?.type === 'play_card') {
      const rr = execCard(ng, defKey, react.cardId, react.opts || {});
      if (rr.ok) { ng = rr.game; playedThisGame.add(`${defKey}|${react.cardId}`); }
    }
    ng = safeResolve(ng);
  }
  return { g: ng, played: true };
}

// Delegates to aiSpendDecision so the sim measures the exact brain the live
// PlayTab driver uses. (The old inline copy passed spendType 'three' — the
// engine only knows '3pt' — so no audit game ever landed a 3PT assist spend.)
function spendAll(g, key) {
  let ng = g;
  for (let guard = 0; guard < 12; guard += 1) {
    const spend = aiSpendDecision(ng, key);
    if (!spend) break;
    const r = spend.type === 'spend_assist'
      ? spendAssist(ng, key, spend.spendType, spend.playerIdx)
      : spendReboundBonus(ng, key, spend.rebType, spend.playerIdx);
    if (!r.ok) break;
    ng = r.game;
  }
  return ng;
}

let simmed = 0;
let aWins = 0;
const margins = [];
const signedMargins = []; // Team A minus Team B, for the --shift-a comparison
for (let n = 0; n < GAMES; n += 1) {
  const taken = new Set();
  // --shift-a=N moves every Team A Shot Line by N (clamped 12-20) AFTER the
  // draft, so a run with the shift drafts exactly the rosters the run without
  // it drafted; the two are then a paired measurement of what a Shot Line step
  // is worth in the full card game (scripts/analysis/shotLineValue.mjs is the
  // model half of that question).
  const rosterA = draftRoster(taken).map(c => SHIFT_A
    ? { ...c, shotLine: Math.max(12, Math.min(20, (c.shotLine ?? 18) + SHIFT_A)) }
    : c);
  const rosterB = draftRoster(taken);
  if (rosterA.length < 10 || rosterB.length < 10) continue;

  // --full deals every card its printed copies instead of the default deck's
  // first-fifty truncation, so the nineteen unreachable cards get to exist.
  const FULL = process.argv.includes('--full');
  // `locked` marks deck-editor staples, not exclusions — every card deals.
  const cfg = FULL ? Object.fromEntries(STRATS.map(s => [s.id, s.copies || 2])) : null;
  let g = newGame(rosterA, rosterB, cfg, cfg);
  const heldThisGame = new Set();
  const playedThisGame = new Set();

  // Blind fives, then the placement snake — the same flow solo now runs.
  for (const key of ['A', 'B']) {
    for (let i = 0; i < 5; i += 1) {
      const a = aiDraftPick(g, key);
      if (!a) break;
      const team = key === 'A' ? g.teamA : g.teamB;
      const pool = key === 'A' ? g.draft.aPool : g.draft.bPool;
      const idx = pool.findIndex(p => p.id === a.playerId);
      if (idx < 0) break;
      team.starters.push(pool[idx]);
      if (key === 'A') g.draft.aPool = pool.filter((_, j) => j !== idx);
      else g.draft.bPool = pool.filter((_, j) => j !== idx);
    }
  }
  runSnake(g);

  for (let s = 0; s < SECTIONS && !g.done; s += 1) {
    tallyHands(g, heldThisGame);

    // endSection clears starters; every section after the first re-picks five
    // by rest-then-salary, exactly as runChannelSplit rotates. Without this,
    // sections two through twelve rolled nobody — the first cut of this
    // harness measured one-section games without noticing.
    if (s > 0) {
      for (const key of ['A', 'B']) {
        const team = key === 'A' ? g.teamA : g.teamB;
        const byId = new Map(team.stats.map(p => [p.id, p]));
        team.starters = team.roster
          .map(c => ({ c, min: byId.get(c.id)?.minutes ?? 0, sal: c.salary ?? 0 }))
          .sort((x, y) => x.min - y.min || y.sal - x.sal)
          .slice(0, STARTERS)
          .map(o => o.c);
      }
      // THE SNAKE EVERY SECTION (2026-09-08). Until now the audit placed the
      // opening five and then paired every later section by rotation order —
      // arbitrary matchups for eleven sections of twelve, so every card
      // gated on an advantage was measured against a random table. The
      // season simulator had the same gap and got the same fix.
      runSnake(g);
    }

    // ── Matchup phase: alternate aiTurn until both pass ──
    // endSection resets the phase to 'draft' for the next lineup pick; the
    // harness re-picks starters itself, so it must restore the phase too —
    // without this, every section after the first had NO matchup phase and
    // the matchup-only cards could exist for one section per game.
    g.phase = 'matchup_strats';
    g.matchupTurn = 'A'; g.matchupPasses = 0;
    for (let guard = 0; guard < 24 && g.matchupPasses < 2; guard += 1) {
      const key = g.matchupTurn;
      const action = aiTurn(g, key);
      if (action?.type === 'set_matchups') {
        g = applyMatchups(g, key, action.matchups);
        continue; // same team keeps its turn after assigning, as the UI allows
      }
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
        if (res.played) { g.matchupPasses = 0; g.matchupTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.matchupPasses += 1;
      g.matchupTurn = key === 'A' ? 'B' : 'A';
    }

    // ── Scoring card phase ──
    g.phase = 'scoring';
    g.rollResults = { A: [], B: [] };
    g.scoringTurn = 'B'; g.scoringPasses = 0;
    for (let guard = 0; guard < 24 && g.scoringPasses < 2; guard += 1) {
      const key = g.scoringTurn;
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
        if (res.played) { g.scoringPasses = 0; g.scoringTurn = key === 'A' ? 'B' : 'A'; continue; }
      }
      g.scoringPasses += 1;
      g.scoringTurn = key === 'A' ? 'B' : 'A';
    }

    // ── Rolls (AI order), then conversions ──
    // Before each roll the rolling team gets a one-card window — this is
    // where mid-roll reactions live (Fast Break off an opponent's zero,
    // a Heat Check the moment the tier hits) instead of arriving after
    // every die is already down.
    for (let r = 0; r < STARTERS * 2; r += 1) {
      const key = r % 2 === 0 ? 'A' : 'B';
      // Crunch Time: the timeout brain fires before the card window —
      // stoppage, defensive re-set, best rider, play on.
      if (aiCrunchDecision(g, key)?.type === 'timeout') {
        const to = spendTimeout(g, key);
        if (to.ok) {
          g = to.game;
          const reset = aiSetMatchups(g, key);
          if (reset?.matchups) g = applyMatchups(g, key, reset.matchups);
          // The timeout search (2026-09-09): one crunch card from the deck.
          const wanted = aiCrunchSearch(g, key);
          if (wanted) {
            const sr = searchCrunchCard(g, key, wanted);
            // A searched card is HELD from here: tally it, or the card shows
            // more plays than holds (ATO Masterpiece read 434% in the first run).
            if (sr.ok) { g = sr.game; heldThisGame.add(`${key}|${wanted}`); }
          }
          // Play every rider the window allows, best first — the live driver
          // loops the same way, one card per tick.
          for (let played = 0; played < 4; played += 1) {
            const rider = aiScoringDecision(g, key);
            if (rider?.type !== 'play_card') break;
            const res = tryPlay(g, key, rider, playedThisGame);
            g = res.g;
            if (!res.played) break;
          }
          g = endTimeout(g);
        }
      }
      const cardAction = aiScoringDecision(g, key);
      if (cardAction?.type === 'play_card') {
        const res = tryPlay(g, key, cardAction, playedThisGame);
        g = res.g;
      }
      const action = aiRollDecision(g, key);
      if (action?.playerIdx != null) {
        g = doRoll(g, key, action.playerIdx, { clutch: action.clutch });
        if (g.pendingShotCheck) g = safeResolve(g);
      }
    }
    // Anyone the alternation missed still rolls.
    for (const key of ['A', 'B']) {
      for (let i = 0; i < STARTERS; i += 1) {
        if ((key === 'A' ? g.rollResults.A : g.rollResults.B)[i] == null && !g.blockedRolls?.[key]?.[i]) {
          g = doRoll(g, key, i);
          if (g.pendingShotCheck) g = safeResolve(g);
        }
      }
    }
    // Post-roll card window — heat checks and momentum plays live here.
    for (const key of ['B', 'A']) {
      const action = aiScoringDecision(g, key);
      if (action?.type === 'play_card') {
        const res = tryPlay(g, key, action, playedThisGame);
        g = res.g;
      }
    }
    for (const key of ['A', 'B']) g = spendAll(g, key);
    g = endSection(g);
    for (const key of ['A', 'B']) g = spendAll(g, key);
  }

  const aWon = g.teamA.score > g.teamB.score;
  if (aWon) aWins += 1;
  margins.push(Math.abs(g.teamA.score - g.teamB.score));
  signedMargins.push(g.teamA.score - g.teamB.score);
  for (const entry of heldThisGame) {
    const [key, id] = entry.split('|');
    const st = stats.get(id);
    if (!st) continue;
    st.held += 1;
    if ((key === 'A') === aWon) st.winsWhenHeld += 1;
    if (playedThisGame.has(entry)) continue;
    st.gamesHeldUnplayed += 1;
    if ((key === 'A') === aWon) st.winsWhenHeldUnplayed += 1;
  }
  for (const entry of playedThisGame) {
    const [key, id] = entry.split('|');
    const st = stats.get(id);
    if (!st) continue;
    st.plays += 1;
    st.gamesPlayed += 1;
    const won = key === 'A' ? aWon : !aWon;
    if (won) st.winsWhenPlayed += 1;
  }
  simmed += 1;
}

const rows = [...stats.values()].sort((a, b) => b.plays - a.plays);
console.log(`\n${simmed} AI-vs-AI games on the base set (team A wins ${(100 * aWins / simmed).toFixed(1)}%, median margin ${margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)]}, mean A-minus-B ${(signedMargins.reduce((x, y) => x + y, 0) / signedMargins.length).toFixed(2)}${SHIFT_A ? `, Team A shot lines shifted ${SHIFT_A}` : ''})\n`);
if (ABLATE.size) {
  console.log(`  ABLATED (unplayable this run): ${[...ABLATE].join(', ')}`);
  console.log('  Compare the "win% held" column against a run without --ablate; that delta is the card.');
  console.log('');
}
console.log('  card                        phase      held  played  play%   win% held  win% played  win% held-unplayed    lift');
for (const r of rows) {
  const playPct = r.held ? (100 * r.plays / r.held).toFixed(0) : '—';
  const winPct = r.gamesPlayed ? (100 * r.winsWhenPlayed / r.gamesPlayed).toFixed(0) : '—';
  // The number that is actually about the card: played minus held-unplayed.
  const ctrl = r.gamesHeldUnplayed ? (100 * r.winsWhenHeldUnplayed / r.gamesHeldUnplayed) : null;
  const ctrlStr = ctrl === null ? '—' : ctrl.toFixed(0);
  const lift = (ctrl !== null && r.gamesPlayed)
    ? (100 * r.winsWhenPlayed / r.gamesPlayed - ctrl)
    : null;
  const liftStr = lift === null ? '—' : `${lift >= 0 ? '+' : ''}${lift.toFixed(0)}`;
  const heldPct = r.held ? (100 * r.winsWhenHeld / r.held).toFixed(0) : '—';
  console.log(`  ${r.name.padEnd(26)}${r.phase.padEnd(10)}${String(r.held).padStart(5)}${String(r.plays).padStart(7)}${String(playPct).padStart(7)}%${String(heldPct).padStart(10)}%${String(winPct).padStart(12)}%${String(ctrlStr).padStart(14)}%${String(liftStr).padStart(8)}`);
}
const dead = rows.filter(r => r.held > simmed * 0.2 && r.plays === 0);
console.log(`\nDEAD IN AI HANDS (held often, never played): ${dead.map(r => r.id).join(', ') || 'none'}`);

// --emit-deck: the adaptive default, learned from this run. The user's rule:
// "adapt the more you sim - if something triggers and adds a lot of value,
// increase usage." Every card keeps one copy (nothing is ever unreachable
// again); proven value earns extras; the fill goes to the most-played
// staples. Deterministic from the seeded run.
// THE USER'S STEER (2026-09-05): "the default strategy deck should have WAY
// more switching cards." Decks being switch-heavy is a feature, so the
// switching family gets a FLOOR the learning cannot trim below, and every
// copy count stays under the canon caps (5 common / 3 uncommon / 1 rare —
// Switch Everything is rare, so it stays at one). The room comes from the
// staples the fill used to pile up (Putback Dunk, Rimshaker), not from
// dropping any card to zero: nothing is ever unreachable again.
const DESIGN_FLOORS = {
  high_screen_roll: 4,
  veer_switch: 3,
  burned_switch: 2,
  go_under: 2,
  fight_over: 2,
  overhelp: 2,
  switch_everything: 1, // rare: one is the cap, and it is never dropped
};
const capOf = id => STRAT_COPY_CAPS[getStratRarity(getStrat(id))] ?? 5;
const floorOf = id => Math.min(capOf(id), DESIGN_FLOORS[id] ?? 1);

if (process.argv.includes('--emit-deck')) {
  const copies = Object.fromEntries(rows.map(r => [r.id, floorOf(r.id)]));
  for (const r of rows) {
    const win = r.gamesPlayed ? r.winsWhenPlayed / r.gamesPlayed : 0;
    if (r.plays >= 100 && win >= 0.55) copies[r.id] = Math.min(capOf(r.id), copies[r.id] + 1);
    if (r.plays >= 100 && win >= 0.62) copies[r.id] = Math.min(capOf(r.id), copies[r.id] + 1);
  }
  let total = Object.values(copies).reduce((a, b) => a + b, 0);
  const byPlays = [...rows].sort((a, b) => b.plays - a.plays);
  for (const r of byPlays) {
    if (total >= 50) break;
    if (copies[r.id] >= capOf(r.id)) continue;
    copies[r.id] += 1; total += 1;
  }
  while (total > 50) {
    const trim = [...rows]
      .filter(r => copies[r.id] > floorOf(r.id))
      .sort((a, b) => (a.winsWhenPlayed / (a.gamesPlayed || 1)) - (b.winsWhenPlayed / (b.gamesPlayed || 1)))[0];
    if (!trim) break;
    copies[trim.id] -= 1; total -= 1;
  }
  // FIFTY-ONE CARDS DO NOT FIT IN FIFTY. With the crunch package the card
  // pool outgrew the deck, so "every card keeps a copy" cannot hold any more,
  // floors or no floors. The last resort drops SINGLETONS the AI gets the
  // least out of — fewest plays, then lowest win rate when played — never a
  // floored card and never a crunch rider (those are the crunch package, and
  // they are only ever held until the last section). The dropped list is
  // written into the generated file so it is a decision on the record.
  // From the registry, not a copy — a duplicated list is what let the WNBA
  // specials slip past packSupply.test.js.
  const CRUNCH_RIDERS = CRUNCH_CARDS;
  // Proven value is protected too: a card the AI plays 100+ times and wins
  // 55%+ with is a staple, whatever its raw play count ranks against.
  const winOf = r => (r.gamesPlayed ? r.winsWhenPlayed / r.gamesPlayed : 0);
  const proven = r => r.plays >= 100 && winOf(r) >= 0.55;
  // And so is every REACTION: the user's counter-coverage principle — a
  // reaction card to every playable strategy card — is what a default deck
  // without Close Out would break, whatever the AI's play count says.
  const reaction = r => getStrat(r.id)?.phase === 'reaction';
  // Cards the user asked for by name (2026-09-02: the pressing card and the
  // trap) stay in the default deck whatever the AI makes of them.
  const DESIGN_KEEP = ['pick_up_full_court', 'double_team'];
  const dropped = [];
  while (total > 50) {
    const drop = [...rows]
      .filter(r => copies[r.id] === 1 && !DESIGN_FLOORS[r.id] && !CRUNCH_RIDERS.includes(r.id)
        && !proven(r) && !reaction(r) && !DESIGN_KEEP.includes(r.id))
      .sort((a, b) => a.plays - b.plays
        || (a.winsWhenPlayed / (a.gamesPlayed || 1)) - (b.winsWhenPlayed / (b.gamesPlayed || 1)))[0];
    if (!drop) break;
    delete copies[drop.id]; dropped.push(drop.id); total -= 1;
  }
  const NL = String.fromCharCode(10);
  const genBody = [
    '// GENERATED by scripts/analysis/runStratAudit.js --emit-deck - do not edit.',
    '//',
    '// The default 50-card deck, learned from ' + simmed + ' seeded AI-vs-AI games:',
    '// every card keeps at least one copy, the SWITCHING FAMILY keeps its design',
    '// floor (High Screen & Roll 4, Veer Switch 3, Burned on the Switch 3, Go Under,',
    '// Fight Over, Overhelp 2 - the user\'s steer), proven win rates earn extras',
    '// under the 5/3/1 copy caps, and the fill goes to the most-played staples.',
    '// Regenerate after AI or card changes:',
    '//   dropped to fit fifty (fewest AI plays first): ' + (dropped.join(', ') || 'none'),
    '//   node scripts/analysis/runStratAudit.js 600 --full --emit-deck',
    'export const DEFAULT_DECK_COPIES = ' + JSON.stringify(copies, null, 2) + ';',
    '',
  ].join(NL);
  fs.writeFileSync(path.join(REPO_ROOT, 'src', 'game', 'defaultDeckWeights.js'), genBody);
  console.log('emitted src/game/defaultDeckWeights.js (' + total + ' cards, ' + Object.keys(copies).length + ' distinct)' + (dropped.length ? '; dropped: ' + dropped.join(', ') : ''));
}
