// THE AIMED RARE DELUXE NEVER MOVES A RARITY TO AVOID A REPEAT (2026-10-24),
// on the pools as they were before the Live Series. With it on (2026-10-28)
// every team holds three rare cards or more, so no team pack has to repeat a
// rare — and the case this pins (fewer rares than rare slots) cannot be
// reached. Off here, the Mavericks hold their two again.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../cards/liveSeries.js', () => ({ LIVE_SET: 'live', LIVE_SERIES_ON: false }));

const { generatePack, SPECIAL_SETS_IN_PACKS, leagueOfCard } = await import('./packEngine.js');
const { CARD_MAP } = await import('./cards.js');
const { ALL_CARDS, BASE_SET } = await import('./cardSets.js');
const { currentFranchise } = await import('../cards/teams.js');
const { getPlayerRarity } = await import('./rarity.js');

const players = cards => cards.filter(c => c.type === 'player');
const rarityOf = pull => getPlayerRarity(CARD_MAP[pull.id]);
const franchisePool = team => ALL_CARDS.filter(c => (c.set === BASE_SET && c.team === team)
  || (SPECIAL_SETS_IN_PACKS.includes(c.set) && leagueOfCard(c) === 'nba' && currentFranchise(c.team) === team));

describe('the aimed Rare Deluxes', () => {
  it('never moves the rarity to avoid a repeat: a pool with two rare cards deals rares as often as any other', () => {
    // The user: "Isn't that going to artificially pump up certain rarity
    // outputs?" It did, here. The Mavericks hold two rare cards; a third rare
    // slot used to become a super rare (1.33 a pack against everyone's 1.07).
    // It is a repeat now, and the rarity is what was rolled.
    const team = 'DAL';
    expect(franchisePool(team).filter(c => getPlayerRarity(c) === 'rare')).toHaveLength(2);
    const N = 1500;
    let slots = 0, srs = 0, tripleRare = 0;
    for (let i = 0; i < N; i += 1) {
      const rs = players(generatePack('team_rare_deluxe', { team })).map(rarityOf);
      if (rs.every(r => r === 'rare')) tripleRare += 1;
      for (const r of rs) {
        if (r === 'legendary') continue;
        slots += 1;
        if (r === 'super-rare') srs += 1;
      }
    }
    expect(srs / slots).toBeGreaterThan(0.29);
    expect(srs / slots).toBeLessThan(0.38);
    // Three rares come up about (2/3)^3 of the packs with no legendary: 26%.
    expect(tripleRare / N).toBeGreaterThan(0.2);
    expect(tripleRare / N).toBeLessThan(0.32);
  });

});
