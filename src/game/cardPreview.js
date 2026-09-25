// WHAT A CARD WOULD DO, per choice on its picker (2026-09-25). The user:
// "For a defensive card like Defensive Stopper, the player choice prompt
// should show their matchup's roll bonus and how it would change with playing
// the card", and then: "it's confusing when I play a card for a 3pt shot
// check and it shows the matchup details as if they are relevant to the shot
// check... we need all the *relevant* details on the choice prompt."
//
// So nothing here is generic furniture. The card is PLAYED, on a copy, by the
// engine itself (execCard deep-clones; `previewChecks` makes announceCheck
// and the card-local checks write the check down instead of rolling it), and
// the picker is told only what that play changed:
//
//   checks — each shot check it announces, with the number the die needs,
//            itemised as the check will be (card, bonus, contest, markers,
//            fatigue — applyShotCheck and shotCheck's own terms);
//   points — anything it scores outright (Rimshaker's two, And One's one);
//   rolls  — every scoring roll it moves, on either side, before -> after
//            (scoringRollModifier: matchup, card roll bonuses, fatigue,
//            markers — doRoll's sum).
//
// A card that does none of these gets no line. Because the engine plays it,
// the picker cannot promise a number the card does not deliver, and a card
// whose rule changes needs nothing here.
import { getTeam, getOpp, scoringRollModifier, checkNeed, matchupContest, getFatigue, getPS, standingEntry, deepClone } from './engine.js';
import { execCard } from './execCard.js';

const other = k => (k === 'A' ? 'B' : 'A');

/** The man `idx` of `teamKey` has on the floor against him, or null while the placement snake has not put him there. */
function defenderOf(g, teamKey, idx) {
  const defIdx = (g.offMatchups?.[teamKey] || [])[idx] ?? idx;
  return getOpp(g, teamKey)?.starters?.[defIdx] ?? null;
}

/** Every starter's next-roll modifier on both sides, keyed "A3"; players with no man yet are left out. */
function rollTable(g) {
  const out = {};
  for (const k of ['A', 'B']) {
    (getTeam(g, k)?.starters ?? []).forEach((p, idx) => {
      if (!p || !defenderOf(g, k, idx)) return;
      const m = scoringRollModifier(g, k, idx);
      if (m) out[k + idx] = m.total;
    });
  }
  return out;
}

/**
 * The number a card's check needs on the die, and why — the same arithmetic
 * applyShotCheck + shotCheck will do (a free throw: +10, no contest, no
 * fatigue).
 */
export function checkPreview(g, check) {
  const { teamKey, playerIdx: idx, type } = check;
  const player = getTeam(g, teamKey)?.starters?.[idx];
  if (!player) return null;
  const ps = getPS(g, teamKey, player.id) || {};
  const card = check.bonus || 0;
  const markers = ((ps.hot || 0) - (ps.cold || 0)) * 2;
  if (type === 'ft') {
    const need = (player.shotLine || 99) - (card + 10 + markers);
    return { teamKey, idx, name: player.name, type, need, parts: [{ label: 'FT', n: 10 }, { label: 'card', n: card }, { label: markers > 0 ? '🔥' : '🧊', n: markers }].filter(p => p.n) };
  }
  const towers = type === 'paint' && standingEntry(g, other(teamKey), 'twin_towers') ? -2 : 0;
  const { need } = checkNeed(g, teamKey, idx, type, { extra: card + towers, banked: false });
  const boost = type === '3pt' ? (player.threePtBoost || 0) : (player.paintBoost || 0);
  const contest = -matchupContest(g, teamKey, idx, type);
  const defender = contest ? defenderOf(g, teamKey, idx) : null;
  const parts = [
    { label: 'card', n: card },
    { label: type === '3pt' ? '3PT' : 'Paint', n: boost },
    { label: defender ? `contest (${defender.name})` : 'contest', n: contest },
    { label: 'Twin Towers', n: towers },
    { label: markers > 0 ? '🔥' : '🧊', n: markers },
    { label: 'FAT', n: getFatigue(g, teamKey, idx) },
  ].filter(p => p.n);
  return { teamKey, idx, name: player.name, type, need, parts };
}

/**
 * What playing `cardId` for `teamKey` with `opts` would do: `{ checks,
 * points, rolls }` (see the header), or null when the engine would refuse
 * the play — then there is nothing honest to show.
 */
export function choicePreview(game, teamKey, cardId, opts = {}) {
  const probe = deepClone(game);
  probe.previewChecks = [];
  let res;
  try { res = execCard(probe, teamKey, cardId, opts); } catch { return null; }
  if (!res?.ok || !res.game) return null;
  const after = res.game;
  const checks = (after.previewChecks ?? []).map(c => checkPreview(game, c)).filter(Boolean);
  const points = (getTeam(after, teamKey)?.score ?? 0) - (getTeam(game, teamKey)?.score ?? 0);
  const was = rollTable(game);
  const now = rollTable(after);
  const rolls = [];
  for (const key of Object.keys(was)) {
    if (now[key] == null || now[key] === was[key]) continue;
    const k = key[0];
    const idx = Number(key.slice(1));
    const p = getTeam(game, k).starters[idx];
    rolls.push({ teamKey: k, idx, name: p?.name, vs: defenderOf(game, k, idx)?.name, before: was[key], after: now[key] });
  }
  // SCORING ROLLS THE PLAY TAKES AWAY: a roll-replacer's checks name the roll
  // they spend (replaceRoll), and a shut-out (This Is My House, Hack-A)
  // blocks the other side's.
  const skips = new Map();
  for (const c of after.previewChecks ?? []) {
    if (c.replaceRoll == null) continue;
    skips.set(`${c.teamKey}${c.replaceRoll}`, { teamKey: c.teamKey, idx: c.replaceRoll });
  }
  for (const k of ['A', 'B']) {
    for (const [slot, blocked] of Object.entries(after.blockedRolls?.[k] ?? {})) {
      if (blocked && !game.blockedRolls?.[k]?.[slot]) skips.set(`${k}${slot}`, { teamKey: k, idx: Number(slot) });
    }
  }
  const skipped = [...skips.values()].map(s => ({ ...s, name: getTeam(game, s.teamKey)?.starters?.[s.idx]?.name }));
  return { checks, points, rolls, skips: skipped };
}
