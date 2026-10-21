// THE LEAGUE AROUND YOU — the AI teams a season is played against.
//
// A season opponent should read as a TEAM, not as ten cards drawn from a hat:
// it wears a real franchise's name, city and colours, and its roster prefers
// that franchise's players before filling out from the pool. The Lakers turn
// up with Lakers, and when the Lakers' cards run out (a franchise has three or
// four in a 348-card set) the rest are the best fits left under the cap.
//
// The cap rules are the game's own — ten cards, $5,500, and the same
// $4,800 floor Quick Match draws to (teamRules.js), so an AI team is a legal
// team you could have built yourself.
import { CARDS } from '../cards.js';
import { TEAMS, TEAM_ALIASES } from '../../cards/teams.js';
import { CAP, RANDOM_MIN_SAL } from '../teamRules.js';
// The roster size from teamRules rather than the engine, so a dynasty's AI
// league can be built where the engine is not shipped (the Cloud Functions).
import { MAX as ROSTER_SIZE } from '../teamRules.js';
import { CARD_SETS, DORMANT_KEYS, cardKey } from '../cardSets.js';
import { isFeatCard } from '../recordBreakers.js';

/** The franchise a card plays for, following the three aliases (BRK/CHO/PHO). */
export function franchiseOf(card) {
  const t = String(card?.team ?? '').toUpperCase();
  // Era keys carry the franchise as a prefix: 'LAC16' -> 'LAC', 'TOR96' -> 'TOR'.
  const bare = t.replace(/\d+$/, '');
  return TEAM_ALIASES[bare] ?? bare;
}

/** Every franchise that has at least `min` cards in the pool, best-stocked first. */
export function franchisePool(cards = CARDS, min = 3) {
  const by = new Map();
  for (const c of cards) {
    const f = franchiseOf(c);
    if (!TEAMS[f]) continue;
    if (!by.has(f)) by.set(f, []);
    by.get(f).push(c);
  }
  return [...by.entries()]
    .filter(([, list]) => list.length >= min)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([abbr, list]) => ({ abbr, ...TEAMS[abbr], cards: list }));
}

/**
 * Ten cards for one franchise: its own players first (best first), then the
 * best of the rest, always keeping the roster payable — every pick leaves
 * enough room for the spots still to fill at the pool's cheapest price.
 */
// `cap` is the salary cap this roster is drawn to. Above the fair rung the
// coach's team is simply better (coinRewards.js RUNG_CAP: King and Deity carry
// a cap multiplier), which is the one honest way to make it harder — the
// user, 2026-09-16, on rubber-banding: "What I want when the difficulty goes
// up is for the opposing team to be better/smarter." A person can see the
// cards.
// `size` and `own` (The Climb, 2026-10-18): a run's opponents are sized like
// the run's own team (five at the first floor), and `own` replaces "this
// franchise's cards" as the first tier — the classic boss's core leftovers.
export function buildAiRoster(abbr, { cards = CARDS, taken = new Set(), rng = Math.random, cap = CAP, size = ROSTER_SIZE, own = null } = {}) {
  const free = cards.filter(c => !taken.has(c.id));
  const ownKeys = own ? new Set(own.map(cardKey)) : null;
  const isMine = c => (ownKeys ? ownKeys.has(cardKey(c)) : franchiseOf(c) === abbr);
  const mine = free.filter(isMine);
  const others = free.filter(c => !isMine(c));
  // A little noise so two seasons with the same franchise are not the same
  // team: rank by salary, jittered.
  const rank = list => [...list].sort((a, b) => (b.salary ?? 0) * (0.85 + rng() * 0.3) - (a.salary ?? 0) * (0.85 + rng() * 0.3));
  const cheap = [...free].sort((a, b) => (a.salary ?? 0) - (b.salary ?? 0));

  const roster = [];
  const ids = new Set();
  let sal = 0;
  /**
   * Room for THIS card and the cheapest cards still available for the spots
   * after it. Priced off the real remaining pool rather than a constant: a
   * fixed floor let an expensive front-loaded roster strand itself at nine.
   */
  const fits = c => {
    const spotsAfter = size - roster.length - 1;
    let reserve = 0;
    let counted = 0;
    for (const x of cheap) {
      if (counted >= spotsAfter) break;
      if (ids.has(x.id) || x.id === c.id) continue;
      reserve += x.salary ?? 0;
      counted += 1;
    }
    if (counted < spotsAfter) return false;
    return sal + (c.salary ?? 0) + reserve <= cap;
  };
  const take = c => { roster.push(c); ids.add(c.id); sal += c.salary ?? 0; };
  for (const c of rank(mine)) {
    if (roster.length >= size) break;
    if (ids.has(c.id) || !fits(c)) continue;
    take(c);
  }
  for (const c of rank(others)) {
    if (roster.length >= size) break;
    if (ids.has(c.id) || !fits(c)) continue;
    take(c);
  }
  // Whatever is left over goes to the cheapest cards that still fit, so the
  // roster is always full (ten deep, unless a size was asked for).
  for (const c of cheap) {
    if (roster.length >= size) break;
    if (ids.has(c.id) || sal + (c.salary ?? 0) > cap) continue;
    take(c);
  }
  // Spend up to the floor if the draw came in cheap: swap the smallest salary
  // for the best affordable upgrade until the roster is in the band.
  for (let guard = 0; guard < 40 && roster.length > 0 && sal < RANDOM_MIN_SAL; guard += 1) {
    const worstIdx = roster.reduce((w, c, i) => ((c.salary ?? 0) < (roster[w].salary ?? 0) ? i : w), 0);
    const worst = roster[worstIdx];
    const room = cap - sal + (worst.salary ?? 0);
    const upgrade = free
      .filter(c => !ids.has(c.id) && (c.salary ?? 0) <= room && (c.salary ?? 0) > (worst.salary ?? 0))
      .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0))[0];
    if (!upgrade) break;
    sal += (upgrade.salary ?? 0) - (worst.salary ?? 0);
    ids.delete(worst.id);
    ids.add(upgrade.id);
    roster[worstIdx] = upgrade;
  }
  return roster;
}

/**
 * A league of AI teams. Returns `[{ id, abbr, name, city, primary, secondary,
 * logo, roster }]`, each roster distinct from the others and from `taken`
 * (the cards a human entrant brought, which a dynasty removes from the pool).
 */
// `capMult` is the rung's cap multiplier (coinRewards.js capOf): 1 up to
// Prince, more above it. Every team in the league draws to the same cap.
export function buildAiLeague(count, { cards = CARDS, taken = new Set(), exclude = [], rng = Math.random, capMult = 1 } = {}) {
  const cap = Math.round(CAP * capMult);
  const skip = new Set(exclude.map(a => String(a).toUpperCase()));
  const pool = franchisePool(cards).filter(f => !skip.has(f.abbr));
  // Shuffle so the same league size does not always field the same franchises.
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const used = new Set(taken);
  const out = [];
  for (const f of pool.slice(0, count)) {
    const roster = buildAiRoster(f.abbr, { cards, taken: used, rng, cap });
    for (const c of roster) used.add(c.id);
    out.push({
      id: `ai:${f.abbr}`,
      abbr: f.abbr,
      name: `${f.city} ${f.name}`,
      city: f.city,
      primary: f.primary,
      secondary: f.secondary,
      logo: f.logo,
      human: false,
      roster,
    });
  }
  return out;
}

// ── THE CLASSIC BOSS (The Climb, 2026-10-18) ─────────────────────────────────
// The act's last stop is one franchise built from its own past: its Super
// Seasons, Throwbacks and reward cards (docs/plans/2026-10-18-the-climb-design.md).
// Those cards cost $900-1,400 apiece, so at the boss's cap a greedy draft
// that takes the stars first runs out of room by its third card; the core is
// picked with the rest of the roster's cost in view, then the usual draft
// fills it.
export const CLASSIC_SETS = ['super-season', 'throwbacks', 'set-rewards', 'team-rewards'];

/** A franchise's live classic cards, one per player (his priciest). */
export function classicCards(abbr) {
  const best = new Map();
  for (const set of CLASSIC_SETS) {
    for (const c of CARD_SETS[set] ?? []) {
      if (franchiseOf(c) !== abbr || DORMANT_KEYS.has(cardKey(c)) || isFeatCard(c)) continue;
      const had = best.get(c.id);
      if (!had || (c.salary ?? 0) > (had.salary ?? 0)) best.set(c.id, c);
    }
  }
  return [...best.values()];
}

const salaryOf = c => c.salary ?? 0;
const cheapest = (list, n) => list.map(salaryOf).sort((a, b) => a - b).slice(0, Math.max(0, n)).reduce((t, x) => t + x, 0);
const coreSize = size => Math.ceil(size / 2);
/** The other players a classic roster fills out with: the pool, less anyone it already has. */
const fillPool = (classic, cards) => {
  const ids = new Set(classic.map(c => c.id));
  return cards.filter(c => !ids.has(c.id));
};

/** The franchises that can field half a classic roster of `size` under `cap`, A-Z. */
export function classicFranchises({ cap = CAP, size = ROSTER_SIZE, cards = CARDS } = {}) {
  const abbrs = new Set();
  for (const set of CLASSIC_SETS) for (const c of CARD_SETS[set] ?? []) if (TEAMS[franchiseOf(c)]) abbrs.add(franchiseOf(c));
  const k = coreSize(size);
  return [...abbrs].sort().filter(abbr => {
    const classic = classicCards(abbr);
    return classic.length >= k && cheapest(classic, k) + cheapest(fillPool(classic, cards), size - k) <= cap;
  });
}

/**
 * A classic team of `size` under `cap`: at least half of it the franchise's
 * classic cards (chosen priciest-first, jittered, never leaving too little
 * for the rest), the rest drafted as any coach team is, its remaining classic
 * cards first.
 */
export function buildClassicRoster(abbr, { cap = CAP, size = ROSTER_SIZE, rng = Math.random, cards = CARDS } = {}) {
  const classic = classicCards(abbr);
  const fill = fillPool(classic, cards);
  const k = coreSize(size);
  const ranked = [...classic].sort((a, b) => salaryOf(b) * (0.85 + rng() * 0.3) - salaryOf(a) * (0.85 + rng() * 0.3));
  const core = [];
  let sal = 0;
  for (const c of ranked) {
    if (core.length >= k) break;
    // ONE CARD A PLAYER (2026-10-20): a franchise with two seasons of one star
    // (two LeBrons on Cleveland's Act II boss) fields him once.
    if (core.some(x => x.id === c.id)) continue;
    const others = classic.filter(x => x !== c && x.id !== c.id && !core.some(y => y.id === x.id));
    if (sal + salaryOf(c) + cheapest(others, k - core.length - 1) + cheapest(fill, size - k) > cap) continue;
    core.push(c);
    sal += salaryOf(c);
  }
  const left = classic.filter(c => !core.includes(c));
  const rest = buildAiRoster(abbr, {
    own: left, cards: [...left, ...fill], cap: cap - sal, size: size - core.length, rng,
    taken: new Set(core.map(c => c.id)),
  });
  return [...core, ...rest];
}
