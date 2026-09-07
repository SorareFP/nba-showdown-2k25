// A card may decline its set's badge.
//
// The rule is the user's: "make sure anything with a Super Season badge was
// that player's best season. We can still use non-best seasons, but just lose
// the badge." Seven cards were on defensible seasons that were not the BEST
// one — all of them careers that begin before the cached season tables do, so
// the generator picked the best season it could see and could not see far
// enough. Keeping the card and dropping the claim is the fix; this pins that
// dropping it actually works, in both of the two ways a badge can be carried.
import { describe, it, expect } from 'vitest';
import { CARD_SETS } from '../game/cardSets.js';
import { setBadge } from './sets.js';
import { SUPER_SEASON_BADGE } from './badges.js';

const flagged = Object.entries(CARD_SETS).flatMap(([set, cards]) =>
  cards.filter(c => c.notBestSeason).map(c => ({ set, card: c }))
);

describe('a card that is not a best season', () => {
  it('exists — the flag is in use, not dead code', () => {
    expect(flagged.length).toBeGreaterThan(0);
  });

  it('carries no super-season badge in its own list', () => {
    // The MIGRATED path. A reward card that left Super Season brought the badge
    // with it in `card.badges`, where its new set has no say — so the entry has
    // to be removed rather than suppressed. John Stockton is the live case.
    for (const { set, card } of flagged) {
      expect(card.badges ?? [], `${set} ${card.name}`).not.toContain(SUPER_SEASON_BADGE);
    }
  });

  it('sits in a set that would otherwise have declared the badge for it', () => {
    // The SET path, and the reason the flag has to exist at all: for these
    // cards the badge is not on the record, it is on the set, so there is
    // nothing to delete and the card needs a way to say no.
    const fromSet = flagged.filter(({ set }) => setBadge(set) === SUPER_SEASON_BADGE);
    expect(fromSet.length).toBeGreaterThan(0);
  });

  it('keeps everything else — this drops a claim, not a card', () => {
    for (const { set, card } of flagged) {
      expect(card.salary, `${set} ${card.name} salary`).toBeGreaterThan(0);
      expect(card.speed + card.power, `${set} ${card.name} S+P`).toBeGreaterThan(0);
      expect(card.chart?.length, `${set} ${card.name} chart`).toBeGreaterThan(0);
    }
  });
});
