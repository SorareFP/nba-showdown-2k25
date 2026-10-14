/** A Record Breakers card earned by a feat, never dealt by a pack (docs/plans/2026-10-14-record-breakers-design.md). */
export const isFeatCard = card => card?.set === 'record-breakers' && !!card.earn && card.earn !== 'pack';

/**
 * THE GOAL OPENS WITH THE FEATS (part 2 of the plan). Until a feat can be done,
 * eight of the twelve cards cannot be had, and a goal nobody can finish would
 * sit atop every new player's closest collections and in every friend's needs.
 * Flip this when the feats ship; collections.js reads it, as it reads
 * LIVE_SERIES_ON for the Live Series' goal.
 */
export const RECORD_BREAKERS_GOAL_ON = false;
