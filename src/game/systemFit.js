// IN SYSTEM (the Climb, 2026-10-20). The fourth skill lever on the user's list
// ("I want to make it so skill improves those odds a ton. When I think of
// skill in that context, I think roster building and deck scaling"): your
// playbook pays the players who fit it, so who you sign matters as much as
// what you draft. Slay the Spire's characters, which the user named as the
// model for the playbooks, each reward their own kind of build.
//
// One rule, read by the engine (climbCheckParts) and by every Climb screen
// that marks a player In System. A player's numbers are as he stands in the
// game: a perk, Pace and Space or Weight Room can carry him over a line.

export const SYSTEM_FIT = Object.freeze({
  speed: Object.freeze({ need: 'Speed 12+', fits: p => (p?.speed ?? 0) >= 12, does: '+1 on his shot checks' }),
  paint: Object.freeze({ need: 'Power 12+', fits: p => (p?.power ?? 0) >= 12, does: '+1 on his shot checks' }),
  defense: Object.freeze({ need: 'Defense +1 or better', fits: p => (p?.defBoost ?? 0) >= 1, does: 'checks against him −1' }),
});

/** Is this player In System for the playbook? */
export const fitsSystem = (playbook, p) => !!SYSTEM_FIT[playbook]?.fits(p);

/** The line a screen prints for a playbook: who is In System and what it does. */
export const systemLine = playbook => {
  const s = SYSTEM_FIT[playbook];
  return s ? `In System: ${s.need}, ${s.does}` : '';
};
