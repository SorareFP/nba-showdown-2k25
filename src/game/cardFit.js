// WHO ON YOUR TEAM A CARD IS FOR. The user (2026-10-19), on the Climb's
// rewards: "Maybe we highlight card rewards if a player on your team matches.
// Like Delayed Slip where you need Speed 12+ and Power 10+, it could glow a
// little and say 'matches (player)'".
//
// Only the FIXED part of a card's condition is here: what a player is
// (Speed 12+, a 3PT Bonus, a salary under $350), not what the board does
// (a Speed advantage, a hot marker, a rebound lead), which only a game can
// say. `nums` are the numbers the card's text prints; a test holds them to it,
// so the table cannot drift from the cards. `count` is how many players the
// card needs (Energy Injection's two, Three-Point Barrage's three).

const has3 = p => (p.threePtBoost ?? 0) > 0;

export const CARD_FIT = Object.freeze({
  delayed_slip: { nums: [12, 10], fits: p => p.speed >= 12 && p.power >= 10 },
  ghost_screen: { nums: [12], fits: p => p.speed >= 12 },
  catch_and_shoot: { nums: [12], fits: p => p.speed >= 12 },
  blow_by: { nums: [13], fits: p => p.speed >= 13 },
  pick_and_roll_maestro: { nums: [14], fits: p => p.speed >= 14 },
  short_roll_playmaker: { nums: [8, 8], fits: p => p.speed >= 8 && p.power >= 8 },
  lob_city: { nums: [15], fits: p => p.speed >= 15 || p.power >= 15 },
  back_to_basket: { nums: [13], fits: p => p.power >= 13 && (p.paintBoost ?? 0) > 0 },
  rimshaker: { nums: [13], fits: p => p.power >= 13 },
  putback_dunk: { nums: [14], fits: p => p.power >= 14 },
  rim_protector: { nums: [15], fits: p => (p.power ?? 0) + (p.defBoost ?? 0) >= 15 },
  chip_on_shoulder: { nums: [250], fits: p => (p.salary ?? 0) <= 250 },
  crowd_favorite: { nums: [350], fits: p => (p.salary ?? 0) <= 350 },
  energy_injection: { nums: [400], fits: p => (p.salary ?? 0) < 400, count: 2 },
  elevator_doors: { nums: [], fits: has3 },
  rebound_tap_out: { nums: [], fits: has3 },
  five_out: { nums: [], fits: has3 },
  pick_and_pop: { nums: [], fits: has3 },
  kick_out_three: { nums: [1], fits: p => (p.threePtBoost ?? 0) >= 1 },
  hammer_set: { nums: [], fits: p => !has3(p) },
  three_point_barrage: { nums: [], fits: has3, count: 3 },
  // A build-around (2026-10-19): it pays off a team that takes threes.
  splash: { nums: [], fits: has3, count: 3 },
  // One player at Speed 13+ AND a different one with a 3PT Bonus.
  stagger_action: {
    nums: [13], fits: p => p.speed >= 13 || has3(p),
    team: ps => ps.some((p, i) => p.speed >= 13 && ps.some((q, j) => j !== i && has3(q))),
  },
});

/**
 * How `cardId` fits these players: null when the card asks nothing fixed of
 * a player; otherwise { matches: [players who qualify], ok: enough of them }.
 */
export function cardFit(cardId, players) {
  const f = CARD_FIT[cardId];
  if (!f) return null;
  const all = (players ?? []).filter(Boolean);
  const matches = all.filter(p => f.fits(p));
  return { matches, ok: f.team ? f.team(all) : matches.length >= (f.count ?? 1) };
}
