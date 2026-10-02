// WHAT A PACK'S GUARANTEE LEAVES TO CHANCE — by simulation through the engine.
//
//   node scripts/analysis/packOdds.mjs [packs per row]
//
// packValue.mjs answers "what does this pack pay per coin". This answers the
// question a player asks at the shelf (the user, 2026-10-02: "what are the
// odds of getting a second rare+ in Rare Deluxe, a second Super Rare in a
// Super Rare Deluxe, etc?"): how many rare-or-better players, how many super
// rares, and how often a legendary, with the spread and not only the mean.
// Aimed packs are measured once per aim — every division, conference and
// franchise — because their pools are not alike.
import { generatePack, PACK_TYPES, CONFERENCES, DIVISIONS } from '../../src/game/packEngine.js';
import { CARD_SETS, BASE_SET, getCardByKey } from '../../src/game/cardSets.js';
import { getStrat } from '../../src/game/strats.js';
import { getPlayerRarity, getStratRarity, MARKET_PRICES, STRAT_BURN_VALUES, RARITY_ORDER } from '../../src/game/rarity.js';

const N = Number(process.argv[2] ?? 20000);
const STRAT_MULT = 20;
const at = r => RARITY_ORDER.indexOf(r);

export function measure(type, options = {}, n = N) {
  const def = PACK_TYPES[type];
  const rareHist = [0, 0, 0, 0, 0, 0], srHist = [0, 0, 0, 0, 0, 0];
  let value = 0, leg = 0, distinct = 0, players = 0;
  for (let i = 0; i < n; i += 1) {
    const pulls = generatePack(type, options);
    let rare = 0, sr = 0, legHere = 0;
    const ids = new Set();
    for (const p of pulls) {
      if (p.type !== 'player') {
        const s = getStrat(p.id);
        if (s) value += STRAT_MULT * (STRAT_BURN_VALUES[getStratRarity(s)] ?? 0);
        continue;
      }
      const card = getCardByKey(p.id);
      if (!card) continue;
      const r = getPlayerRarity(card);
      value += MARKET_PRICES[r] ?? 0;
      ids.add(p.id);
      players += 1;
      if (at(r) >= at('rare')) rare += 1;
      if (at(r) >= at('super-rare')) sr += 1;
      if (r === 'legendary') legHere += 1;
    }
    rareHist[Math.min(rare, 5)] += 1;
    srHist[Math.min(sr, 5)] += 1;
    if (legHere) leg += 1;
    distinct += ids.size;
  }
  const atLeast = (hist, k) => hist.slice(k).reduce((a, b) => a + b, 0) / n;
  return {
    price: def.price,
    value: value / n,
    perCoin: value / n / def.price,
    rare1: atLeast(rareHist, 1), rare2: atLeast(rareHist, 2), rare3: atLeast(rareHist, 3),
    sr1: atLeast(srHist, 1), sr2: atLeast(srHist, 2), sr3: atLeast(srHist, 3),
    srMean: srHist.reduce((a, b, k) => a + b * k, 0) / n,
    leg: leg / n,
    distinct: distinct / n,
    players: players / n,
  };
}

const pct = x => `${(100 * x).toFixed(x < 0.0995 ? 1 : 0)}%`.padStart(6);
const HEAD = 'pack                             price   rare+: 1+     2+     3+    SR+: 1+     2+     3+   SR/pack  legend  value  /coin';
const line = (label, m) =>
  `${label.padEnd(30)} ${String(m.price).padStart(6)}        ${pct(m.rare1)} ${pct(m.rare2)} ${pct(m.rare3)}        ${pct(m.sr1)} ${pct(m.sr2)} ${pct(m.sr3)}   ${m.srMean.toFixed(2).padStart(6)}  ${pct(m.leg)}  ${m.value.toFixed(0).padStart(5)}  ${m.perCoin.toFixed(2).padStart(5)}`;

if (process.argv[1] && process.argv[1].endsWith('packOdds.mjs')) {
  console.log(`${N} packs a row. "SR+" counts super rares and legendaries; value = players at MARKET_PRICES, strats at ${STRAT_MULT}x burn.\n`);
  console.log('── the shelf as it is ──');
  console.log(HEAD);
  for (const type of ['booster', 'deluxe', 'super', 'rare_deluxe', 'super_deluxe', 'mega_deluxe', 'legendary_chase', 'super_season', 'standouts', 'nba_super', 'wnba_super']) {
    console.log(line(PACK_TYPES[type].name, measure(type)));
  }
  console.log(line('Conference Super (East)', measure('conf_super', { conference: 'East' })));
  console.log(line('Team Pack (BOS)', measure('team_pack', { team: 'BOS' })));

  if (PACK_TYPES.wnba_rare_deluxe) {
    console.log('\n── the aimed Rare Deluxes ──');
    console.log(HEAD);
    console.log(line('WNBA Rare Deluxe', measure('wnba_rare_deluxe')));
    for (const c of Object.keys(CONFERENCES)) console.log(line(`Conference RD: ${c}`, measure('conference_rare_deluxe', { conference: c })));
    for (const d of Object.keys(DIVISIONS)) console.log(line(`Division RD: ${d}`, measure('division_rare_deluxe', { division: d })));
    const teams = [...new Set(CARD_SETS[BASE_SET].map(c => c.team))].sort();
    for (const t of teams) console.log(line(`Team RD: ${t}`, measure('team_rare_deluxe', { team: t }, Math.round(N / 4))));
  }
}
