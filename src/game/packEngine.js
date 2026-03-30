// src/game/packEngine.js — Pack generation with all pack types and weighted selection
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';
import { getPlayerRarity, getStratRarity, PACK_WEIGHTS } from './rarity.js';

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

// Pack type definitions
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
  booster_box:   { name: 'Booster Box (36)',     players: 0,  strats: 0,  price: 3000, box: 36 },
};

// Weighted random pick — normalized by pool size so pull rates match PACK_WEIGHTS targets.
// Step 1: Pick a rarity tier using PACK_WEIGHTS as flat probabilities.
// Step 2: Pick a random card within that tier.
// This ensures 65/25/8/2 actual pull rates regardless of pool sizes.
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

// Pick a card of specific rarity or higher
function pickByRarity(cards, getRarityFn, minRarity) {
  const order = ['common', 'uncommon', 'rare', 'super-rare'];
  const minIdx = order.indexOf(minRarity);
  const eligible = cards.filter(c => order.indexOf(getRarityFn(c)) >= minIdx);
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

// Generate a pack
export function generatePack(packType, options = {}) {
  const def = PACK_TYPES[packType];
  if (!def) throw new Error('Unknown pack type: ' + packType);

  // Booster box: generate 36 boosters
  if (def.box) {
    const allCards = [];
    for (let i = 0; i < def.box; i++) {
      allCards.push(...generatePack('booster'));
    }
    return allCards;
  }

  const result = [];
  let playerPool = [...CARDS];
  let stratPool = [...STRATS];

  // Apply team/conference/division filters
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

  // Guaranteed super-rare players
  if (def.guaranteedSR) {
    for (let i = 0; i < def.guaranteedSR; i++) {
      const card = pickByRarity(playerPool, getPlayerRarity, 'super-rare');
      result.push({ id: card.id, type: 'player' });
      srCount++;
    }
  }

  // Guaranteed rare player
  if (def.guaranteedRarePlayer) {
    const card = pickByRarity(playerPool, getPlayerRarity, 'rare');
    result.push({ id: card.id, type: 'player' });
  }

  // Guaranteed rare (player or strat)
  if (def.guaranteedRare) {
    if (Math.random() < 0.5) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'rare').id, type: 'player' });
    } else {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
  }

  // All rare+ packs
  if (def.allRarePlus) {
    for (let i = result.length; i < def.players; i++) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'rare').id, type: 'player' });
    }
    for (let i = 0; i < def.strats; i++) {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
    return result;
  }

  // All super-rare packs
  if (def.allSR) {
    for (let i = result.length; i < def.players; i++) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'super-rare').id, type: 'player' });
    }
    if (def.rareStrat) {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
    return result;
  }

  // Fill remaining player slots with weighted random
  const playersFilled = result.filter(c => c.type === 'player').length;
  for (let i = playersFilled; i < def.players; i++) {
    const card = weightedPick(playerPool, getPlayerRarity);
    if (getPlayerRarity(card) === 'super-rare') {
      if (srCount >= srCap) {
        const fallback = weightedPick(playerPool, getPlayerRarity, ['super-rare']);
        result.push({ id: fallback.id, type: 'player' });
        continue;
      }
      srCount++;
    }
    result.push({ id: card.id, type: 'player' });
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
