// WHAT AN ANNOUNCED SHOT CHECK IS TAKEN AT — one rule for the roll and for
// everything that shows the target before it.
//
// The user, 2026-10-05: "I don't think the contest roll nerfs are showing up
// on shot checks until after they're rolled. I just rolled something that
// said 13+ and then it comped it against a 15 because of the -2 contest."
// The 13+ was right when it was shown. Then the coach answered the check
// (Drop Coverage, a paint check −2) and the die flew at once, so the new
// target was never on screen. The fix is in two halves: the board holds the
// check after the coach answers it (PlayTab), and the banner prints the
// target from HERE — the same terms applyShotCheck rolls with, so the number
// on the banner and the number in the log cannot drift apart again.
//
// The terms, in applyShotCheck's order: the card's bonus (Smothering Defense
// trims it, never below zero), Close Out, a contest an answer wrote on the
// check (Rim Protector, Drop Coverage, Hustle Play), Denial's −3 when the
// shooter's team cannot pay two assists instead, the defender's own contest
// (his Defensive Bonus: matchupContest), and Twin Towers on a paint check.
// shotCheck then adds the player's 3PT or Paint Bonus (a free throw's +10),
// hot and cold markers, and fatigue.
import { getTeam, getOpp, getPS, getFatigue, matchupContest, standingEntry, glassBonus, GLASS_LABEL } from './engine.js';

const other = k => (k === 'A' ? 'B' : 'A');

/**
 * The check's own terms for the shooter in `idx` (default: the one it names —
 * a Blitz asks about the others), as `{ label, n }` parts with no zeros.
 * Pure: Denial's assist cost is paid when the check is rolled, not here.
 */
export function checkTerms(g, psc, idx = psc.playerIdx) {
  const teamKey = psc.teamKey;
  const card = psc.smother ? Math.max(0, (psc.bonus || 0) - psc.smother) : (psc.bonus || 0);
  const parts = [{ label: psc.smother ? 'card, smothered' : 'card', n: card }];
  if (psc.closeOutBonus) parts.push({ label: 'Close Out', n: psc.closeOutBonus });
  if (psc.contest) parts.push({ label: psc.contestBy ?? 'contest', n: psc.contest });
  if (psc.denial && (getTeam(g, teamKey)?.assists ?? 0) < 2) parts.push({ label: 'Denial', n: -3 });
  const contest = matchupContest(g, teamKey, idx, psc.type);
  if (contest) {
    const defIdx = (g.offMatchups?.[teamKey] || [])[idx] ?? idx;
    const defender = getOpp(g, teamKey)?.starters?.[defIdx];
    parts.push({ label: defender ? `contest (${defender.name})` : 'contest', n: -contest });
  }
  if (psc.type === 'paint' && standingEntry(g, other(teamKey), 'twin_towers')) parts.push({ label: 'Twin Towers', n: -2 });
  // The glass lead's +2, on any paint check while it is up (glassBonus).
  parts.push({ label: GLASS_LABEL, n: glassBonus(g, teamKey, psc.type) });
  return parts.filter(p => p.n);
}

/**
 * The least die that converts the check for `idx`, and every term that says
 * why: the check's own (checkTerms) and the shooter's (bonus, markers,
 * fatigue) — exactly the sum shotCheck makes. `{ need, pHit, parts }`.
 */
export function checkNeedFor(g, psc, idx = psc.playerIdx) {
  const player = getTeam(g, psc.teamKey)?.starters?.[idx];
  if (!player) return { need: 21, pHit: 0, parts: [] };
  const ps = getPS(g, psc.teamKey, player.id) || {};
  const parts = [...checkTerms(g, psc, idx)];
  const boost = psc.type === '3pt' ? (player.threePtBoost || 0) : psc.type === 'paint' ? (player.paintBoost || 0) : 0;
  if (boost) parts.push({ label: psc.type === '3pt' ? '3PT' : 'Paint', n: boost });
  if (psc.type === 'ft') parts.push({ label: 'FT', n: 10 });
  const marker = ((ps.hot || 0) - (ps.cold || 0)) * 2;
  if (marker) parts.push({ label: marker > 0 ? '🔥' : '🧊', n: marker });
  const fat = psc.type === 'ft' ? 0 : getFatigue(g, psc.teamKey, idx);
  if (fat) parts.push({ label: 'FAT', n: fat });
  const need = (player.shotLine || 99) - parts.reduce((t, p) => t + p.n, 0);
  return { need, pHit: Math.min(1, Math.max(0, (21 - need) / 20)), parts };
}
