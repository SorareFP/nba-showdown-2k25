// src/game/packEngine.js — Pack generation with all pack types and weighted selection
//
// MULTI-SET (2026-09-03): each pack definition names the card `pool` it draws
// from — a set id from cardSets.js — so NBA, WNBA and special-set packs share
// one engine. Cross-set salaries are priced against the same base field, so
// the salary-derived rarity tiers mean the same thing in every pool.
//
// LEGENDARY is deliberately shut out of every guarantee: `guaranteedSR` and
// `allSR` mean EXACTLY the super-rare band ($900-1,199). The apex cards come
// only from the 0.3% base odds. Dissonance is not sold in any pack — its 13
// strange-jersey stints are reward territory, like the Bam 83-point card.
import { STRATS } from './strats.js';
import { CARD_SETS, BASE_SET, cardKey } from './cardSets.js';
import { getPlayerRarity, getStratRarity, PACK_WEIGHTS, RARITY_ORDER } from './rarity.js';

// NBA divisions and conferences for themed packs
const CONFERENCES = {
  East: ['ATL','BOS','BKN','CHA','CHI','CLE','DET','IND','MIA','MIL','NYK','ORL','PHI','TOR','WAS'],
  West: ['DAL','DEN','GSW','HOU','LAC','LAL','MEM','MIN','NOP','OKC','PHX','POR','SAC','SAS','UTA'],
};
const DIVISIONS = {
  Atlantic: ['BOS','BKN','NYK','PHI','TOR'],
  Central: ['CHI','CLE','DET','IND','MIL'],
  Southeast: ['ATL','CHA','MIA','ORL','WAS'],
  Northwest: ['DEN','MIN','OKC','POR','UTA'],
  Pacific: ['GSW','LAC','LAL','PHX','SAC'],
  Southwest: ['DAL','HOU','MEM','NOP','SAS'],
};

// Pack type definitions. `pool` defaults to the base set.
export const PACK_TYPES = {
  starter:       { name: 'Starter Pack',       players: 20, strats: 30, price: 0,    guaranteedSR: 1, srCap: 2, once: true },
  booster:       { name: 'Booster Pack',        players: 5,  strats: 2,  price: 100 },
  deluxe:        { name: 'Deluxe Booster',      players: 5,  strats: 2,  price: 200,  guaranteedRare: 1 },
  super:         { name: 'Super Booster',       players: 5,  strats: 2,  price: 300,  guaranteedRarePlayer: 1 },
  division:      { name: 'Division Pack',       players: 5,  strats: 2,  price: 100,  themed: 'division' },
  conference:    { name: 'Conference Pack',      players: 5,  strats: 2,  price: 100,  themed: 'conference' },
  conf_super:    { name: 'Conference Super',     players: 5,  strats: 2,  price: 300,  themed: 'conference', guaranteedRarePlayer: 1 },
  rare_deluxe:   { name: 'Rare Deluxe',         players: 3,  strats: 1,  price: 750,  allRarePlus: true },
  super_deluxe:  { name: 'Super Deluxe',        players: 3,  strats: 1,  price: 1500, guaranteedSR: 1 },
  mega_deluxe:   { name: 'Mega Deluxe',         players: 3,  strats: 1,  price: 3000, allSR: true, rareStrat: true },
  // The bulk play: 36 boosters at a discount PLUS a bonus Super Booster —
  // volume and a kicker, while Mega Deluxe stays the certainty play.
  booster_box:   { name: 'Booster Box (36 + bonus)', players: 0, strats: 0, price: 3000, box: 36, bonus: 'super' },
  // THE CHASE PACK. Legendary is otherwise reachable only through the 0.3%
  // base odds — about one apex card every 67 boosters, which is a lottery
  // rather than a goal. This is the deliberate path: expensive, and the only
  // pack in the shop whose guarantee reaches the apex band at all.
  legendary_chase: { name: 'Legendary Chase', players: 3, strats: 1, price: 6000, guaranteedLegendary: 1 },
  // Set-scoped packs.
  wnba_booster:  { name: 'WNBA Booster',        players: 5,  strats: 2,  price: 100,  pool: 'wnba' },
  wnba_super:    { name: 'WNBA Super',          players: 5,  strats: 2,  price: 300,  pool: 'wnba', guaranteedRarePlayer: 1 },
  super_season:  { name: 'Super Season Pack',    players: 3,  strats: 1,  price: 500,  pool: 'super-season' },
  rookie_pack:   { name: 'Rookie Pack',         players: 5,  strats: 2,  price: 75,   pool: 'rookie' },
  standouts:     { name: 'Summer Standouts Pack', players: 3, strats: 1,  price: 250,  pool: 'summer-standouts' },
};

// Weighted random pick — normalized by pool size so pull rates match PACK_WEIGHTS targets.
// Step 1: Pick a rarity tier using PACK_WEIGHTS as flat probabilities.
// Step 2: Pick a random card within that tier.
// This ensures actual pull rates match the targets regardless of pool sizes.
function weightedPick(cards, getRarityFn, excludeRarities) {
  const pool = excludeRarities
    ? cards.filter(c => !excludeRarities.includes(getRarityFn(c)))
    : cards;
  if (pool.length === 0) return cards[Math.floor(Math.random() * cards.length)];

  // Group by rarity
  const buckets = {};
  for (const c of pool) {
    const r = getRarityFn(c);
    if (!buckets[r]) buckets[r] = [];
    buckets[r].push(c);
  }

  // Build tier weights from only tiers present in pool
  const tiers = Object.keys(buckets);
  let totalW = 0;
  const tierWeights = tiers.map(t => {
    const w = PACK_WEIGHTS[t] || PACK_WEIGHTS.common;
    totalW += w;
    return { tier: t, weight: w };
  });

  // Pick a tier
  let roll = Math.random() * totalW;
  let chosen = tiers[0];
  for (const tw of tierWeights) {
    roll -= tw.weight;
    if (roll <= 0) { chosen = tw.tier; break; }
  }

  // Pick random card within tier
  const bucket = buckets[chosen];
  return bucket[Math.floor(Math.random() * bucket.length)];
}

// Pick a card inside a rarity BAND — min up to max inclusive. Guarantees use
// a capped band so "guaranteed super-rare" can never launder out a legendary.
function pickInBand(cards, getRarityFn, minRarity, maxRarity = 'super-rare') {
  const minIdx = RARITY_ORDER.indexOf(minRarity);
  const maxIdx = RARITY_ORDER.indexOf(maxRarity);
  const eligible = cards.filter(c => {
    const i = RARITY_ORDER.indexOf(getRarityFn(c));
    return i >= minIdx && i <= maxIdx;
  });
  if (eligible.length === 0) return cards[Math.floor(Math.random() * cards.length)];
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// Pick N random strats with phase balance for starter pack
function pickPhaseBalancedStrats(count) {
  const phases = ['matchup', 'scoring', 'reaction', 'pre_roll', 'post_roll'];
  const result = [];
  const perPhase = Math.floor(count / phases.length);
  phases.forEach(phase => {
    const pool = STRATS.filter(s => s.phase === phase);
    for (let i = 0; i < perPhase && result.length < count; i++) {
      result.push(weightedPick(pool, getStratRarity));
    }
  });
  while (result.length < count) {
    result.push(weightedPick(STRATS, getStratRarity));
  }
  return result;
}

// A pulled player, keyed for the collection (bare id for base, set:id else).
function pulled(card) {
  return { id: cardKey(card), type: 'player', set: card.set };
}

// Generate a pack
export function generatePack(packType, options = {}) {
  const def = PACK_TYPES[packType];
  if (!def) throw new Error('Unknown pack type: ' + packType);

  // Booster box: 36 boosters plus the bonus pack.
  if (def.box) {
    const allCards = [];
    for (let i = 0; i < def.box; i++) {
      allCards.push(...generatePack('booster'));
    }
    if (def.bonus) allCards.push(...generatePack(def.bonus));
    return allCards;
  }

  const result = [];
  let playerPool = CARD_SETS[def.pool ?? BASE_SET] ?? CARD_SETS[BASE_SET];
  let stratPool = [...STRATS];

  // Apply team/conference/division filters (meaningful for NBA pools only).
  if (options.conference) {
    const teams = CONFERENCES[options.conference] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }
  if (options.division) {
    const teams = DIVISIONS[options.division] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }

  // Player cards
  let srCount = 0;
  const srCap = def.srCap || 999;

  // Guaranteed LEGENDARY — the one guarantee that reaches the apex band, and
  // the only reason legendary_chase exists. Counts toward srCount so it can
  // never stack with a second apex pull in the same pack.
  if (def.guaranteedLegendary) {
    for (let i = 0; i < def.guaranteedLegendary; i += 1) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'legendary', 'legendary')));
      srCount += 1;
    }
  }

  // Guaranteed super-rare players — the band, never legendary.
  if (def.guaranteedSR) {
    for (let i = 0; i < def.guaranteedSR; i++) {
      const card = pickInBand(playerPool, getPlayerRarity, 'super-rare');
      result.push(pulled(card));
      srCount++;
    }
  }

  // Guaranteed rare player (rare or super-rare, never legendary)
  if (def.guaranteedRarePlayer) {
    result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare')));
  }

  // Guaranteed rare (player or strat)
  if (def.guaranteedRare) {
    if (Math.random() < 0.5) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare')));
    } else {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
  }

  // All rare+ packs (rare and super-rare band)
  if (def.allRarePlus) {
    for (let i = result.length; i < def.players; i++) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare')));
    }
    for (let i = 0; i < def.strats; i++) {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
    return result;
  }

  // All super-rare packs — the band exactly.
  if (def.allSR) {
    for (let i = result.length; i < def.players; i++) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'super-rare')));
    }
    if (def.rareStrat) {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
    return result;
  }

  // Fill remaining player slots with weighted random. Legendaries count
  // toward the srCap so a starter can never open two apex cards.
  const playersFilled = result.filter(c => c.type === 'player').length;
  for (let i = playersFilled; i < def.players; i++) {
    const card = weightedPick(playerPool, getPlayerRarity);
    const tier = getPlayerRarity(card);
    if (tier === 'super-rare' || tier === 'legendary') {
      if (srCount >= srCap) {
        const fallback = weightedPick(playerPool, getPlayerRarity, ['super-rare', 'legendary']);
        result.push(pulled(fallback));
        continue;
      }
      srCount++;
    }
    result.push(pulled(card));
  }

  // Fill strat slots
  if (packType === 'starter') {
    const strats = pickPhaseBalancedStrats(def.strats);
    strats.forEach(s => result.push({ id: s.id, type: 'strat' }));
  } else {
    const stratsFilled = result.filter(c => c.type === 'strat').length;
    for (let i = stratsFilled; i < def.strats; i++) {
      result.push({ id: weightedPick(stratPool, getStratRarity).id, type: 'strat' });
    }
  }

  return result;
}

export { CONFERENCES, DIVISIONS };
