// THE CLIENT HALF OF "A GAME IS PAID ONCE" (2026-09-18), as pure functions.
//
// GameOver builds the claim, reads the server's answer and hands the caller a
// stamp; PlayTab writes the stamp into the save; NoGame decides whether the
// coach drew its own team at the rung. All of it lived inline in components,
// where no test reached it — the verifiers found the stamp landing on the
// NEXT game that way (a late answer, after Play Again and a new deal). Here it
// is testable without a DOM.
import { capOf } from './coinRewards.js';

/**
 * DID THE COACH DRAW ITS OWN TEAM AT THE RUNG — per start button on the Play
 * tab. The user, 2026-09-18: "any game where the coach did not draw its own
 * team at the rung pays the fair Prince rate." The coach's TEAM is its roster
 * AND its deck: a Deity coach handed an empty deck the human chose is easier
 * than an honest Prince coach (the verifiers measured 55% wins, 134 coins a
 * game at 1.5x), so a chosen Team B deck counts as a custom game too.
 *
 *   'built'   Team Builder Rosters: the human built the coach's roster
 *   'random'  Team A vs a random opponent: drawn at the rung's cap
 *   'quick'   Quick Match: both drawn at the PLAIN cap, which is the rung's
 *             own cap only at Prince and below
 *
 * Only a game against the coach has a rung; hotseat prices no rung at all.
 */
export function rungDrawFor(button, { opponent = 'ai', aiLevel = null, deckB = 'default' } = {}) {
  if (opponent !== 'ai') return false;
  if (deckB !== 'default') return false;
  if (button === 'random') return true;
  if (button === 'quick') return capOf(aiLevel) === 1;
  return false;
}

/**
 * The claim GameOver sends. `won`, `margin`, milestones and the box are the
 * game's; `aiLevel` and `rungDraw` its saved terms; `claimId` the receipt key;
 * `fixtureFrom` the season (and dynasty or friends league) it came from.
 */
export function buildGameClaim({ won, isPvp = false, margin = null, milestones = {}, box = [], aiLevel = null, rungDraw = false, claimId = null, fixtureFrom = null }) {
  return {
    won: Boolean(won), pvp: Boolean(isPvp), margin, ...milestones,
    box,
    aiLevel: isPvp ? null : aiLevel,
    rungDraw: rungDraw === true,
    ...(claimId ? { gameId: claimId } : {}),
    ...(fixtureFrom ?? {}),
  };
}

const ALREADY = { label: 'Already paid to your account', coins: 0, note: true };

/** What a paid game's results screen shows: its stamp, and no claim. */
export function paidView(paid) {
  return { coins: paid?.coins ?? 0, breakdown: [...(paid?.breakdown ?? []), ALREADY] };
}

/**
 * The server's answer, read. `already: true` is SUCCESS — a reload's first
 * mount, or another device, paid it — so both answers give a stamp.
 *   view    what the screen shows (merged over the preview for a fresh pay)
 *   stamp   what goes into the save: { coins, breakdown }
 *   fresh   true when this call paid it (card stats changed, refresh them)
 */
export function readClaimAnswer(res, preview) {
  if (res?.already) {
    const stamp = { coins: res.coins ?? 0, breakdown: Array.isArray(res.breakdown) ? res.breakdown : [] };
    return { view: paidView(stamp), stamp, fresh: false };
  }
  const breakdown = Array.isArray(res?.breakdown) ? res.breakdown : preview?.breakdown ?? [];
  return {
    view: {
      ...preview,
      breakdown,
      coins: res?.coins ?? 0,
      milestoneCoins: res?.milestoneCoins,
      firstWin: res?.firstWin,
      bamReward: res?.bam,
    },
    stamp: { coins: res?.coins ?? 0, breakdown },
    fresh: true,
  };
}

/**
 * DOES A CLAIM'S ANSWER BELONG TO THE GAME ON THE TABLE NOW. The answer can
 * arrive seconds late (a cold function start) — after Play Again and a Quick
 * Match, or after 'Back to the season' and the next fixture's deal — and
 * stamping whatever game is live then marked the NEW game paid: it was never
 * claimed, and its results screen showed the old game's coins. The stamp is
 * written only when the claim's key is the live game's key; otherwise the
 * server's receipt still guards the old game.
 */
export function stampBelongs(claimKey, liveKey) {
  return Boolean(claimKey) && claimKey === liveKey;
}
