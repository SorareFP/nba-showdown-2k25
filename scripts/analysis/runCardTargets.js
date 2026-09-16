/**
 * WHERE TO PLAY A CARD THAT REPLACES A ROLL — the table, player by player.
 *
 *   node scripts/analysis/runCardTargets.js [--card you_stand_over_there] [--top 12]
 *
 * The user, 2026-09-16, after the coach played You Stand Over There on Shai:
 * "I would run an analysis of expected output for playing each card on each
 * player and kind of create an AI database of where to play such cards."
 *
 * This is that table. The database itself is not stored anywhere, because the
 * coach computes it live (ai.js forfeitNet) — the sum is cheap and it needs
 * the moment's bonus, contest and markers, which no table could carry. What
 * this prints is the STANDING picture: every card in the pool, fresh, on a
 * neutral matchup, with no assist banked and no contest — so the numbers are
 * the card's chart and shooting line and nothing else. It is the reading a
 * coach tip gives a person, and the sanity check on the coach.
 *
 * For each of the four forfeit cards (Green Light, You Stand Over There,
 * Five-Out, Cross-Court Dime): the players it pays MOST on, the players it
 * costs most on, and how many of the pool it is a losing play on at all.
 */
import { newGame, STARTERS } from '../../src/game/engine.js';
import { CARDS } from '../../src/game/cards.js';
import { forfeitNet, FORFEIT_CARDS } from '../../src/game/ai.js';
import { getStrat } from '../../src/game/strats.js';

const args = process.argv.slice(2);
const only = args.includes('--card') ? args[args.indexOf('--card') + 1] : null;
const TOP = Number(args.includes('--top') ? args[args.indexOf('--top') + 1] : 10);
// --player Shai   one player's line for every forfeit card, by name (substring)
const WHO = args.includes('--player') ? args[args.indexOf('--player') + 1].toLowerCase() : null;

/**
 * A neutral board: the player in slot 0 against a defender with his own
 * Speed and Power (no matchup advantage either way) and no Defensive Bonus,
 * so the roll bonus is zero and the check is uncontested. Fresh legs.
 */
function neutralBoard(player) {
  const mirror = { ...player, id: `${player.id}__mirror`, defBoost: 0 };
  const filler = CARDS.filter(c => c.id !== player.id).slice(0, 9);
  const g = newGame([player, ...filler], [mirror, ...filler.map(c => ({ ...c, id: `${c.id}__m` }))], null, null);
  g.phase = 'scoring';
  g.teamA.starters = [player, ...filler.slice(0, STARTERS - 1)];
  g.teamB.starters = [mirror, ...filler.slice(0, STARTERS - 1).map(c => ({ ...c, id: `${c.id}__m` }))];
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  return g;
}

const cards = only ? [only] : Object.keys(FORFEIT_CARDS);

if (WHO) {
  // One player, every card: the line a coach tip would show, fresh and uncontested.
  const hits = CARDS.filter(c => c.name.toLowerCase().includes(WHO));
  if (!hits.length) { console.log(`no player matches "${WHO}"`); process.exit(1); }
  for (const player of hits) {
    console.log(`\n${player.name} (${player.team}) — shot line ${player.shotLine}, 3PT ${player.threePtBoost ?? 0}, paint ${player.paintBoost ?? 0}`);
    for (const cardId of cards) {
      const r = forfeitNet(neutralBoard(player), 'A', 0, cardId);
      const name = (getStrat(cardId)?.name ?? cardId).padEnd(22);
      if (!r) { console.log(`  ${name} not legal on him`); continue; }
      console.log(`  ${name} checks ${r.checks.toFixed(2)}  roll ${r.roll.toFixed(2)}  net ${(r.net >= 0 ? '+' : '') + r.net.toFixed(2)}${r.net < 0 ? '   <- gives up more than it makes' : ''}`);
    }
  }
  process.exit(0);
}

for (const cardId of cards) {
  const strat = getStrat(cardId);
  const rows = [];
  for (const player of CARDS) {
    const r = forfeitNet(neutralBoard(player), 'A', 0, cardId);
    if (r) rows.push({ player, ...r });
  }
  rows.sort((a, b) => b.net - a.net);
  const losing = rows.filter(r => r.net <= 0).length;

  console.log(`\n${strat?.name ?? cardId} — ${strat?.desc ?? ''}`);
  console.log(`  legal on ${rows.length} of ${CARDS.length} cards fresh; a LOSING play on ${losing} (${(100 * losing / Math.max(1, rows.length)).toFixed(0)}%)\n`);
  const line = r => `  ${r.player.name.padEnd(24)} ${String(r.player.team).padEnd(5)} line ${String(r.player.shotLine).padStart(2)}  3PT ${String(r.player.threePtBoost ?? 0).padStart(2)}  checks ${r.checks.toFixed(2)}  roll ${r.roll.toFixed(2)}  net ${(r.net >= 0 ? '+' : '') + r.net.toFixed(2)}`;
  console.log('  BEST TARGETS');
  for (const r of rows.slice(0, TOP)) console.log(line(r));
  console.log('  WORST — the Shai plays');
  for (const r of rows.slice(-TOP).reverse()) console.log(line(r));
}
