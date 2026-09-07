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
import { currentFranchise, currentFranchiseFor } from '../cards/teams.js';
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
  // `favoriteCore` is the franchise a new player names on the way in — see
  // favoriteCorePicks. Three commons and an uncommon of their team, guaranteed
  // among the twenty, so the first cards anybody owns mean something to them.
  starter:       { name: 'Starter Pack',       players: 20, strats: 30, price: 0,    guaranteedSR: 1, srCap: 2, once: true, favoriteCore: { common: 3, uncommon: 1 }, bonusStrats: ['unethical_hoops'] },
  booster:       { name: 'Booster Pack',        players: 5,  strats: 2,  price: 100, mixesSpecials: true },
  deluxe:        { name: 'Deluxe Booster',      players: 5,  strats: 2,  price: 200,  guaranteedRare: 1, mixesSpecials: true },
  super:         { name: 'Super Booster',       players: 5,  strats: 2,  price: 300,  guaranteedRarePlayer: 1, mixesSpecials: true },
  division:      { name: 'Division Pack',       players: 5,  strats: 2,  price: 100,  themed: 'division' },
  conference:    { name: 'Conference Pack',      players: 5,  strats: 2,  price: 100,  themed: 'conference' },
  conf_super:    { name: 'Conference Super',     players: 5,  strats: 2,  price: 300,  themed: 'conference', guaranteedRarePlayer: 1 },
  rare_deluxe:   { name: 'Rare Deluxe',         players: 3,  strats: 1,  price: 750,  allRarePlus: true, mixesSpecials: true },
  super_deluxe:  { name: 'Super Deluxe',        players: 3,  strats: 1,  price: 1500, guaranteedSR: 1, mixesSpecials: true },
  mega_deluxe:   { name: 'Mega Deluxe',         players: 3,  strats: 1,  price: 3000, allSR: true, rareStrat: true, mixesSpecials: true },
  // The bulk play: 36 boosters at a discount PLUS a bonus Super Booster —
  // volume and a kicker, while Mega Deluxe stays the certainty play.
  booster_box:   { name: 'Booster Box (36 + bonus)', players: 0, strats: 0, price: 3000, box: 36, bonus: 'super' },
  // THE CHASE PACK. Legendary is otherwise reachable only through the 0.3%
  // base odds — about one apex card every 67 boosters, which is a lottery
  // rather than a goal. This is the deliberate path: expensive, and the only
  // pack in the shop whose guarantee reaches the apex band at all.
  legendary_chase: { name: 'Legendary Chase', players: 3, strats: 1, price: 6000, guaranteedLegendary: 1, apexStrat: true, mixesSpecials: true },
  // Set-scoped packs.
  // TEAM PACK — priced at 250 against a booster's 100. The premium buys a ~30x
  // narrower pool, and it has to be a premium: at booster price it would strictly
  // dominate the booster and nothing else in the shop would ever sell.
  team_pack:     { name: 'Team Pack',           players: 5,  strats: 1,  price: 250,  needsTeam: true },
  // LEAGUE PACKS ARE TARGETED PACKS. Same price as the booster, a narrower pool
  // — see LEAGUE_SETS. A scoped pool does not mix the special sets in, which
  // is what "narrower" means here.
  nba_booster:   { name: 'NBA Booster',         players: 5,  strats: 2,  price: 100,  pool: '2026-27' },
  nba_super:     { name: 'NBA Super',           players: 5,  strats: 2,  price: 300,  pool: '2026-27', guaranteedRarePlayer: 1 },
  wnba_booster:  { name: 'WNBA Booster',        players: 5,  strats: 2,  price: 100,  pool: 'wnba' },
  wnba_super:    { name: 'WNBA Super',          players: 5,  strats: 2,  price: 300,  pool: 'wnba', guaranteedRarePlayer: 1 },
  // ── THE SET PACKS EARN THEIR PRICE WITH A GUARANTEE, NOT WITH THEIR POOL ──
  //
  // Super Season is a genuinely elite pool — median salary $840 against the
  // base set's $550, 65% rare-or-better against 30%, 46 legendaries in 215
  // cards against 14 in 348. None of that reached the player, because
  // PACK_WEIGHTS picks the BAND first and rarity IS the salary band: a Super
  // Season rare and a base-set rare are worth the same by definition, so a
  // stronger pool changed WHICH card came out and not how good it was.
  //
  // Measured, the old 500-coin price bought 1,294 expected salary against a
  // booster's 2,102 for 100 — eight times the price per card for the same
  // expected card. It was charging elite-pool prices for band-gated output.
  //
  // The fix is a GUARANTEE, which is how every other premium pack in this shop
  // already shifts band odds — eight of them do. It lifts rare-or-better from
  // 9% to 39% and expected salary to 1,809, and it caps at super-rare like
  // every other guarantee here, so the Legendary Chase stays the only route to
  // the apex band. Price then drops to match what is actually delivered:
  // 0.138 coins per point of salary, between the team pack's 0.107 and the old
  // 0.386, which is the targeting premium and nothing more.
  super_season:  { name: 'Super Season Pack',    players: 3,  strats: 1,  price: 250,  pool: 'super-season', guaranteedRarePlayer: 1 },
  // THE ROOKIE PACK GETS NO GUARANTEE AND STAYS CHEAP, deliberately. Its pool
  // is the weak one — median $400, 13% rare-or-better, three legendaries in 261
  // cards — and at 75 coins it is already the best value in the shop (0.037
  // against a booster's 0.048). That is the on-ramp working as intended: a lot
  // of cards that are not very good, priced accordingly.
  rookie_pack:   { name: 'Rookie Pack',         players: 5,  strats: 2,  price: 75,   pool: 'rookie' },
  // Same treatment and the same reason — 45 cards at a $780 median and 64%
  // rare-or-better, which the band gate was flattening exactly as it flattened
  // Super Season. 0.129 coins per point of salary.
  standouts:     { name: 'Summer Standouts Pack', players: 3, strats: 1,  price: 225,  pool: 'summer-standouts', guaranteedRarePlayer: 1 },
};

/**
 * Sets that mix into the STANDARD and PREMIUM packs alongside the base set.
 *
 * ── WHY THEY MIX AT ALL ─────────────────────────────────────────────────────
 *
 * Every special-set card was reachable only through its own set-scoped pack,
 * which made three whole sets invisible to anyone buying boosters. A Super
 * Season card is a real card with a real salary and it should be able to turn
 * up in a real pack.
 *
 * TEAM REWARDS AND DISSONANCE ARE NOT HERE, and never can be: rewards are the
 * payoff for finishing a roster and Dissonance is reward territory too. Putting
 * either in a booster would make the ladder decorative — the same reason
 * `NOT_FOR_SALE` keeps them out of the market.
 */
// BOTH LEAGUES' SPECIALS, not just the NBA's (the user, 2026-09-07: "Specials
// should appear in standard packs across both, but just at that reduced amount
// within their rarity bands"). WNBA Super Season and WNBA Rookie — eighty cards
// between them — had NO path into a collection at all: the unscoped packs mixed
// only the three NBA sets, and wnba_booster/wnba_super deal base WNBA alone.
//
// Nothing about the ODDS changes by adding them. SPECIAL_BAND_SHARE still gives
// specials a quarter of whatever band comes out and base three quarters, so
// these dilute the other specials rather than the base pool, which is the
// "reduced amount" the rule already implements.
//
// The reward sets stay out on both sides — team-rewards, set-rewards and their
// WNBA twins are earned, not pulled, and that was already symmetric.
export const SPECIAL_SETS_IN_PACKS = [
  'super-season', 'rookie', 'summer-standouts',
  'wnba-super-season', 'wnba-rookie',
];

/**
 * THE BASE OF AN UNSCOPED PACK IS BOTH LEAGUES.
 *
 * A booster used to draw its base cards from the NBA set alone, with the WNBA
 * reachable only through its own two packs. The user's rule (2026-09-05):
 * "WNBA players should be folded into standard and premium packs with NBA
 * players. (W)NBA-only packs should be part of the targeted packs." So the
 * unscoped packs — everything with no pool, theme or team — treat the two
 * league sets as one base pool, and a league-only booster is a TARGETED pack,
 * priced and grouped as one, alongside division, conference and team.
 *
 * What this does to the odds: a band is picked first, then a card uniformly
 * within it, so WNBA cards take roughly their share of each band — about a
 * quarter, on the current set sizes. Nothing about the special-set share or
 * the rarity ladder moves. Collection difficulty does not move either: it
 * scores every goal by its best TARGETED route, and the league packs are
 * still there.
 */
export const LEAGUE_SETS = [BASE_SET, 'wnba'];

/**
 * WHICH LEAGUE A CARD IS FROM. Seven franchise codes mean a team in BOTH
 * leagues — ATL, CHI, DAL, IND, MIN, PHX and WAS — so a favourite team is only
 * unambiguous with its league attached.
 */
export const leagueOfCard = card => (String(card?.set ?? '').startsWith('wnba') ? 'wnba' : 'nba');

/**
 * A favourite team, as stored: `"nba:MIL"`, `"wnba:LVA"`. A bare code is read
 * as NBA so an older value keeps working.
 */
export function parseFavoriteTeam(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const [a, b] = raw.includes(':') ? raw.split(':') : ['nba', raw];
  const league = a.toLowerCase() === 'wnba' ? 'wnba' : 'nba';
  const abbr = (b ?? '').toUpperCase();
  return abbr ? { league, abbr } : null;
}

/** Every team a player may name, league-qualified, derived from the cards. */
export function favoriteTeamOptions() {
  const seen = new Map();
  for (const c of leagueBases()) {
    // PER LEAGUE, or the Mercury are the Suns and the Storm are the Thunder —
    // see currentFranchiseFor.
    const league = leagueOfCard(c);
    const abbr = currentFranchiseFor(c.team, { league: league === 'wnba' ? 'WNBA' : 'NBA' });
    if (!abbr) continue;
    const key = `${league}:${abbr}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()]
    .filter(([, n]) => n >= 3)
    .map(([key]) => key)
    .sort();
}
export const leagueBases = () => LEAGUE_SETS.flatMap(id => CARD_SETS[id] ?? []);

/**
 * What share of each rarity band the special sets take.
 *
 * ── A SHARE, NOT A PER-CARD WEIGHT, AND THE DIFFERENCE IS THE WHOLE POINT ───
 *
 * The user's call: "we just need pack weights to make special cards a specific
 * amount more rare in those packs" — a quarter — "per band share was my intent".
 *
 * The per-CARD reading was tried and measured first, and it fails for a reason
 * worth writing down: THE SPECIAL POOL IS BIGGER THAN THE BASE SET. 521 cards
 * against 348, and lopsided by band — 52 special legendaries against 14 base
 * ones. At a quarter weight per card, specials still took 27% of every pull and
 * 48% of the legendary band, because a quarter of a much larger number is not
 * a small number. Worse, the outcome moved every time a set grew: adding cards
 * to Super Season would have quietly diluted the base set, which is the kind of
 * drift that surfaces months later as "why is the booster full of rookies".
 *
 * A SHARE is invariant to that. Whatever the pools do, a quarter of what comes
 * out of a band is a special card and three quarters is a base card. Within
 * each side the choice stays uniform, so no card is favoured over its peers.
 *
 * PACK_WEIGHTS is untouched and still decides which BAND comes out, so mixing
 * three sets into the booster pool cannot change how often a booster produces a
 * legendary at all — only which legendary it is.
 */
export const SPECIAL_BAND_SHARE = 0.25;

/**
 * The strategy cards a PACK may deal. A `promo` card — today only the sign-up
 * gift, Unethical Hoops — is in the registry so it can be owned, shown and
 * played, and in no pool so it cannot be pulled, burned for its band value
 * over and over, or land in a paying pack. It reaches a collection one way:
 * the starter's bonusStrats.
 */
function packableStrats() {
  return STRATS.filter(s => !s.promo);
}

/**
 * HOW FAST A CARD GETS SCARCE AS COPIES ENTER THE WORLD.
 *
 * The band a pull lands in is untouched — PACK_WEIGHTS still decides whether
 * you get a common or a legendary, so the rate the whole economy is balanced on
 * does not move. What changes is WHICH card comes out of that band:
 *
 *     weight(card) = baseShare(card) x decay(circulating[cardKey])
 *     decay(n)     = 1 / (1 + n / SUPPLY_DECAY_SCALE)
 *
 * The `/ 5` is the user's pick over a sharper `1 / (1 + n)`: a card should get
 * scarce over a SEASON, not within one session.
 *
 * ── THERE IS NO FLOOR, AND THAT IS THE POINT ──────────────────────────────
 *
 * The instinct is a minimum share so nothing becomes unobtainable. It is wrong,
 * and the user said so directly: a saturated card SHOULD effectively stop
 * appearing, "until other cards start to catch up to it or the distribution
 * becomes more even."
 *
 * Normalisation already does exactly that, because a share is relative. On the
 * fourteen base-set legendaries, one card minted 50 times while the rest sit at
 * zero falls to 0.69% against their 7.64%; when they catch up it returns to an
 * even 7.14% with nothing reset; when they pass it, it becomes the scarce one
 * and rises above them. A floor would prop up the over-minted card and flatten
 * all of that into noise.
 *
 * `1 / (1 + n/5)` is never zero, so no card is ever truly unobtainable — just
 * very unlikely while it is saturated, which is the intended feeling.
 *
 * ── circulating IS MINTS MINUS BURNS ──────────────────────────────────────
 *
 * Not lifetime mints. A burned card really is gone and the pool should feel it,
 * which is what makes burning a sink rather than a shrug. The count comes from
 * readSupply() in src/firebase/collection.js; this module only reads the map it
 * is handed and never fetches.
 */
export const SUPPLY_DECAY_SCALE = 5;

/** A card's weight within its band, given how many copies are circulating. */
export function decay(circulating) {
  return 1 / (1 + Math.max(0, circulating || 0) / SUPPLY_DECAY_SCALE);
}

/**
 * Frozen so a caller cannot accidentally mutate the default into a shared
 * mutable — the empty map is passed to every uncounted pick in the engine.
 */
const NO_SUPPLY = Object.freeze({});

/** The pool a pack draws from, before any team/conference/division filter. */
export function poolFor(def) {
  // Scoped packs name their pool; themed and team packs are NBA structures
  // (divisions, conferences, franchises); everything else is both leagues.
  const scoped = def.pool || def.themed || def.needsTeam;
  const own = scoped ? (CARD_SETS[def.pool ?? BASE_SET] ?? CARD_SETS[BASE_SET]) : leagueBases();
  // A pack that names its own pool is already scoped; only the unscoped
  // standard and premium packs mix.
  //
  // A TEAM PACK MIXES TOO, BUT ONLY ITS OWN FRANCHISE'S SPECIALS. The user's
  // rule: "I think we can put players for the corresponding teams in those
  // packs (Kawhi summer card goes in the Toronto pack). We just can't make it
  // infinitely easier to get that card in one pack vs another." So a Toronto
  // pack reaches Kawhi's Raptors Summer Standouts card and a Clippers pack does
  // not — the filter is the card's own ERA FRANCHISE, which is why it needs
  // `currentFranchise` rather than a string compare: the card says TOR09.
  //
  // The "not infinitely easier" half is already handled and is not re-solved
  // here. SPECIAL_BAND_SHARE caps specials at a quarter of whatever band comes
  // out, in a team pack exactly as in a booster, so a small franchise-specific
  // special pool concentrates within that quarter and never beyond it.
  //
  // Conference and division packs are NOT included. They are broad enough that
  // "this conference's specials" is most of the special sets, which is the
  // booster's job at the booster's price.
  if (def.needsTeam) return own;
  if (def.pool || def.themed || !def.mixesSpecials) return own;
  return [...own, ...SPECIAL_SETS_IN_PACKS.flatMap(id => CARD_SETS[id] ?? [])];
}

const isSpecial = card => SPECIAL_SETS_IN_PACKS.includes(card.set);
const uniform = list => list[Math.floor(Math.random() * list.length)];

/**
 * One card from a list, weighted by how scarce each already is.
 *
 * WITH AN EMPTY SUPPLY THIS IS EXACTLY `uniform`, because decay(0) is 1 for
 * every card and a roulette over equal weights is a uniform draw. That is not a
 * coincidence to be grateful for — it is the property that lets this ship
 * behind a caller that does not pass supply yet, and it is what every existing
 * pack test is still asserting against.
 */
function pickBySupply(list, supply) {
  if (list.length <= 1) return list[0];
  const weights = new Array(list.length);
  let total = 0;
  for (let i = 0; i < list.length; i += 1) {
    const w = decay(supply[cardKey(list[i])]);
    weights[i] = w;
    total += w;
  }
  // decay() is strictly positive, so this can only fail on a corrupt supply
  // map. Falling back to uniform keeps a pack openable rather than throwing at
  // the worst possible moment.
  if (!(total > 0)) return uniform(list);
  let roll = Math.random() * total;
  for (let i = 0; i < list.length; i += 1) {
    roll -= weights[i];
    if (roll <= 0) return list[i];
  }
  // Floating-point drift only.
  return list[list.length - 1];
}

/**
 * One card from an already-band-filtered list, at the declared special share.
 *
 * Degrades to uniform when the list is all one kind, which is what keeps every
 * set-scoped and targeted pack behaving exactly as it did before this existed.
 */
function pickWeighted(list, supply = NO_SUPPLY) {
  const specials = list.filter(isSpecial);
  if (specials.length === 0) return pickBySupply(list, supply);
  const bases = list.filter(c => !isSpecial(c));
  if (bases.length === 0) return pickBySupply(specials, supply);
  // The SHARE is chosen first and decay applies WITHIN the side. Letting supply
  // move the share instead would mean a run of Super Season pulls quietly
  // changing how often specials appear at all, which is the one number this
  // split exists to hold still.
  return Math.random() < SPECIAL_BAND_SHARE
    ? pickBySupply(specials, supply)
    : pickBySupply(bases, supply);
}

// Weighted random pick — normalized by pool size so pull rates match PACK_WEIGHTS targets.
// Step 1: Pick a rarity tier using PACK_WEIGHTS as flat probabilities.
// Step 2: Pick a random card within that tier.
// This ensures actual pull rates match the targets regardless of pool sizes.
function weightedPick(cards, getRarityFn, excludeRarities, supply = NO_SUPPLY) {
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

  // Pick a card within the tier, specials taking SPECIAL_BAND_SHARE of it.
  return pickWeighted(buckets[chosen], supply);
}

// Pick a card inside a rarity BAND — min up to max inclusive. Guarantees use
// a capped band so "guaranteed super-rare" can never launder out a legendary.
function pickInBand(cards, getRarityFn, minRarity, maxRarity = 'super-rare', supply = NO_SUPPLY) {
  const minIdx = RARITY_ORDER.indexOf(minRarity);
  const maxIdx = RARITY_ORDER.indexOf(maxRarity);
  const eligible = cards.filter(c => {
    const i = RARITY_ORDER.indexOf(getRarityFn(c));
    return i >= minIdx && i <= maxIdx;
  });
  if (eligible.length === 0) return cards[Math.floor(Math.random() * cards.length)];
  // Guarantees respect the same within-band weighting, so a guaranteed rare is
  // not a back door into the special sets at four times their pack rate.
  return pickWeighted(eligible, supply);
}

// Pick N random strats with phase balance for starter pack
function pickPhaseBalancedStrats(count) {
  const phases = ['matchup', 'scoring', 'reaction', 'pre_roll', 'post_roll'];
  const result = [];
  const perPhase = Math.floor(count / phases.length);
  phases.forEach(phase => {
    const pool = packableStrats().filter(s => s.phase === phase);
    for (let i = 0; i < perPhase && result.length < count; i++) {
      result.push(weightedPick(pool, getStratRarity));
    }
  });
  while (result.length < count) {
    result.push(weightedPick(packableStrats(), getStratRarity));
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
  // A BOX IS ITS PACKS, and every card says which one it came from. The reveal
  // used to receive the box as one flat list and sort the whole thing strats-
  // first, so a 36-pack box opened as fifty strategy cards in a row. Tagged,
  // the reveal can open it pack by pack in the normal cadence, and can put the
  // unopened remainder down and come back to it. The tag is extra fields on
  // the pull; the ledger reads only `id` and `type` and does not care.
  if (def.box) {
    const allCards = [];
    for (let i = 0; i < def.box; i++) {
      for (const c of generatePack('booster', options)) allCards.push({ ...c, packIndex: i, packType: 'booster' });
    }
    if (def.bonus) {
      for (const c of generatePack(def.bonus, options)) allCards.push({ ...c, packIndex: def.box, packType: def.bonus });
    }
    return allCards;
  }

  const result = [];
  // WHAT IS ALREADY OUT THERE. `{}` — the default — makes every pick uniform
  // and reproduces this engine's behaviour before supply existed, which is what
  // keeps the whole feature shippable behind a caller that has not wired
  // readSupply() yet. STRAT picks deliberately do not get it: the strategy deck
  // is a fixed 51 cards that no one is chasing, so decaying it would add a
  // moving part to solve a problem that is not there.
  const supply = options.supply ?? NO_SUPPLY;
  let playerPool = poolFor(def);
  let stratPool = packableStrats();

  // Apply team/conference/division filters (meaningful for NBA pools only).
  if (options.conference) {
    const teams = CONFERENCES[options.conference] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }
  if (options.division) {
    const teams = DIVISIONS[options.division] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }
  // ONE FRANCHISE. The narrowest filter and the reason team packs exist: the
  // base pool is 348 cards, so a specific card is a lottery you can lose for a
  // very long time (a named legendary averages ~933 boosters). Restricted to a
  // roster of nine to sixteen, the same pull is roughly thirty times likelier,
  // which is what makes completing a team a plan rather than a hope.
  //
  // An unknown team code would silently empty the pool and hand back a pack of
  // nothing, so it throws instead — a pack someone paid for must never open
  // empty.
  if (options.team) {
    const before = playerPool.length;
    // THE BASE ROSTER, matched exactly — a current card's team IS the franchise.
    const roster = playerPool.filter(c => c.team === options.team);
    // PLUS this franchise's special-set cards, whatever era they print. See the
    // note in poolFor: a Toronto pack should reach Kawhi's Raptors card, and
    // the card says TOR09, so the match has to go through the era table.
    const specials = SPECIAL_SETS_IN_PACKS
      .flatMap(id => CARD_SETS[id] ?? [])
      .filter(c => currentFranchise(c.team) === options.team);
    playerPool = [...roster, ...specials];
    if (roster.length === 0) {
      throw new Error(
        `Team pack: no cards for team ${JSON.stringify(options.team)} in pool of ${before}`
      );
    }
  }

  // Player cards
  // ── THE FAVOURITE TEAM'S CORE ────────────────────────────────────────────
  //
  // The user, 2026-09-07: "I just want players to be able to pick their
  // favorite team, either NBA or WNBA, and get two-to-three commons plus an
  // uncommon from that team." Guaranteed INSIDE the twenty rather than instead
  // of them: a roster needs ten cards to take the floor, so a four-card
  // starter would leave a new player unable to play.
  //
  // The starter's pool already spans both leagues (see poolFor), so a WNBA
  // franchise needs nothing special. A team too thin to fill the core gives
  // what it has and the rest of the pack fills normally — never an error on
  // somebody's first action in the game.
  const favoriteCore = [];
  if (def.favoriteCore && options.favoriteTeam) {
    const want = parseFavoriteTeam(options.favoriteTeam);
    const mine = want
      ? playerPool.filter(c => leagueOfCard(c) === want.league
        && currentFranchiseFor(c.team, { league: want.league === 'wnba' ? 'WNBA' : 'NBA' }) === want.abbr)
      : [];
    const taken = new Set();
    const takeFrom = (band, n) => {
      for (let i = 0; i < n; i += 1) {
        const pool = mine.filter(c => !taken.has(cardKey(c)) && getPlayerRarity(c) === band);
        if (!pool.length) return;
        const card = weightedPick(pool, getPlayerRarity);
        taken.add(cardKey(card));
        favoriteCore.push(card);
      }
    };
    takeFrom('common', def.favoriteCore.common ?? 0);
    takeFrom('uncommon', def.favoriteCore.uncommon ?? 0);
    for (const card of favoriteCore) result.push(pulled(card));
  }

  let srCount = 0;
  const srCap = def.srCap || 999;

  // Guaranteed LEGENDARY — the one guarantee that reaches the apex band, and
  // the only reason legendary_chase exists. Counts toward srCount so it can
  // never stack with a second apex pull in the same pack.
  if (def.guaranteedLegendary) {
    for (let i = 0; i < def.guaranteedLegendary; i += 1) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'legendary', 'legendary', supply)));
      srCount += 1;
    }
  }

  // Guaranteed super-rare players — the band, never legendary.
  if (def.guaranteedSR) {
    for (let i = 0; i < def.guaranteedSR; i++) {
      const card = pickInBand(playerPool, getPlayerRarity, 'super-rare', 'super-rare', supply);
      result.push(pulled(card));
      srCount++;
    }
  }

  // Guaranteed rare player (rare or super-rare, never legendary)
  if (def.guaranteedRarePlayer) {
    result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare', 'super-rare', supply)));
  }

  // Guaranteed rare (player or strat)
  if (def.guaranteedRare) {
    if (Math.random() < 0.5) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare', 'super-rare', supply)));
    } else {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
  }

  // All rare+ packs (rare and super-rare band)
  if (def.allRarePlus) {
    for (let i = result.length; i < def.players; i++) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'rare', 'super-rare', supply)));
    }
    for (let i = 0; i < def.strats; i++) {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
    return result;
  }

  // THE ONE PATH TO AN APEX STRATEGY CARD.
  //
  // The 2026-09-07 reband gave four cards the legendary band, and the three
  // guaranteed-strat slots below are all bounded 'rare','rare' — each mirrors
  // its own pack's PLAYER band, and Deluxe and Rare Deluxe cap players at
  // super-rare, so widening them would have made an apex strat cheaper than an
  // apex player. That left the four reachable only through the 0.3% base odds:
  // about one every 667 boosters, a lottery rather than a goal.
  //
  // So the pack that exists to reach the apex reaches it for strats too, which
  // is the reasoning already written above legendary_chase, applied twice.
  if (def.apexStrat) {
    for (let i = 0; i < def.strats; i += 1) {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'legendary').id, type: 'strat' });
    }
  }

  // All super-rare packs — the band exactly.
  if (def.allSR) {
    for (let i = result.length; i < def.players; i++) {
      result.push(pulled(pickInBand(playerPool, getPlayerRarity, 'super-rare', 'super-rare', supply)));
    }
    if (def.rareStrat) {
      result.push({ id: pickInBand(stratPool, getStratRarity, 'rare', 'rare').id, type: 'strat' });
    }
    return result;
  }

  // Fill remaining player slots with weighted random. Legendaries count
  // toward the srCap so a starter can never open two apex cards.
  //
  // ── DUPLICATES ARE ALLOWED, UP TO TWO PER PACK ──────────────────────────────
  //
  // Duplicates are the burn mechanic's supply and burning funds the card
  // market, so a pack that cannot repeat itself quietly starves the loop the
  // economy runs on. They stay.
  //
  // What does not stay is the degenerate case the narrow packs produce. A
  // five-card team pack drawn from a ten-man roster returned only 2.54 distinct
  // cards on average — for 250 coins, against a 100-coin booster's 4.96 — and
  // the repeats burned back about 7 coins, so they were not even paying for
  // themselves as faucet. Capping repeats at two per pack keeps dupes common
  // and stops a pack being mostly one player.
  //
  // The cap counts REPEAT SLOTS, not distinct cards, so it means the same thing
  // in a three-card pack as in a twenty-card starter: at most two of the cards
  // you open are ones you already opened in that pack.
  const playersFilled = result.filter(c => c.type === 'player').length;
  const seenInPack = new Set(result.filter(c => c.type === 'player').map(c => c.id));
  let dupes = 0;
  for (let i = playersFilled; i < def.players; i++) {
    // Once the cap is spent, draw from what has not appeared yet. Falling back
    // to the whole pool when nothing new remains keeps a roster smaller than the
    // pack filling every slot rather than looping.
    let source = playerPool;
    if (dupes >= MAX_DUPES_PER_PACK) {
      const unseen = playerPool.filter(c => !seenInPack.has(cardKey(c)));
      if (unseen.length > 0) source = unseen;
    }
    const card = weightedPick(source, getPlayerRarity, undefined, supply);
    const tier = getPlayerRarity(card);
    if (tier === 'super-rare' || tier === 'legendary') {
      if (srCount >= srCap) {
        const fallback = weightedPick(source, getPlayerRarity, ['super-rare', 'legendary'], supply);
        if (seenInPack.has(cardKey(fallback))) dupes += 1;
        seenInPack.add(cardKey(fallback));
        result.push(pulled(fallback));
        continue;
      }
      srCount++;
    }
    if (seenInPack.has(cardKey(card))) dupes += 1;
    seenInPack.add(cardKey(card));
    result.push(pulled(card));
  }

  // Fill strat slots
  if (packType === 'starter') {
    const strats = pickPhaseBalancedStrats(def.strats);
    strats.forEach(s => result.push({ id: s.id, type: 'strat' }));
    // THE SIGN-UP GIFT, on top of the thirty rather than instead of one of
    // them. A promo card is reachable only here — see packableStrats.
    for (const id of def.bonusStrats ?? []) result.push({ id, type: 'strat' });
  } else {
    const stratsFilled = result.filter(c => c.type === 'strat').length;
    for (let i = stratsFilled; i < def.strats; i++) {
      result.push({ id: weightedPick(stratPool, getStratRarity).id, type: 'strat' });
    }
  }

  return result;
}

/**
 * Repeat slots allowed in one pack.
 *
 * Module scope and exported because it is a RULE, not a local: the tests assert
 * it, and a number defined inside the function it constrains is one a test can
 * only restate rather than check. See the DUPLICATES note in generatePack for
 * why the cap is two and why it counts repeat slots.
 */
export const MAX_DUPES_PER_PACK = 2;

export { CONFERENCES, DIVISIONS };
