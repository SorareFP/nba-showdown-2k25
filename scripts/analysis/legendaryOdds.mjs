// HOW LONG THE LEGENDARY ODDS ARE, per pack type, through the real engine.
//
//   node scripts/analysis/legendaryOdds.mjs [packs per type, default 20000]
//
// The user, 2026-09-23: "no one has packed a Legendary player yet. How long
// are those odds currently?" PACK_WEIGHTS says 0.3% a player slot; this
// opens every buyable pack many times and counts what actually comes out,
// guarantees and supply decay included, so the answer is what a player sees
// rather than what a constant implies.
import { generatePack, PACK_TYPES } from '../../src/game/packEngine.js';
import { getCardByKey } from '../../src/game/cardSets.js';
import { getPlayerRarity, PACK_WEIGHTS } from '../../src/game/rarity.js';

const N = Number(process.argv[2] ?? 20000);
const rarityOf = pull => {
  if (pull.type !== 'player') return null;
  const card = getCardByKey(pull.id);
  return card ? getPlayerRarity(card) : null;
};
const optionsFor = def =>
  def.needsTeam ? { team: def.pool === 'wnba' ? 'LVA' : 'BOS' }
    : def.themed === 'conference' ? { conference: 'East' }
      : def.themed === 'division' ? { division: 'Atlantic' }
        : {};

console.log(`PACK_WEIGHTS legendary ${PACK_WEIGHTS.legendary}, super-rare ${PACK_WEIGHTS['super-rare']}; ${N} packs a type`);
console.log('pack type            price  P(>=1 legendary)  packs/legendary  coins/legendary  SR a pack  legendary a pack');
for (const [type, def] of Object.entries(PACK_TYPES)) {
  if (def.box || def.once) continue;
  let packsWith = 0;
  let legendaries = 0;
  let srs = 0;
  let ok = 0;
  for (let i = 0; i < N; i += 1) {
    let pulls;
    try {
      pulls = generatePack(type, optionsFor(def));
    } catch (e) {
      console.log(`${type}: ${e.message}`);
      break;
    }
    ok += 1;
    const rarities = pulls.map(rarityOf);
    const legs = rarities.filter(r => r === 'legendary').length;
    srs += rarities.filter(r => r === 'super-rare').length;
    legendaries += legs;
    if (legs > 0) packsWith += 1;
  }
  if (!ok) continue;
  const p = packsWith / ok;
  const per = p > 0 ? 1 / p : Infinity;
  console.log(
    `${type.padEnd(20)} ${String(def.price).padStart(5)}  ${(p * 100).toFixed(2).padStart(15)}%  ${per.toFixed(0).padStart(15)}  ${(per * def.price).toFixed(0).padStart(15)}  ${(srs / ok).toFixed(3).padStart(9)}  ${(legendaries / ok).toFixed(4).padStart(16)}`
  );
}
