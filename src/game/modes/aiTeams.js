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
import { ROSTER_SIZE } from '../engine.js';

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
export function buildAiRoster(abbr, { cards = CARDS, taken = new Set(), rng = Math.random } = {}) {
  const free = cards.filter(c => !taken.has(c.id));
  const mine = free.filter(c => franchiseOf(c) === abbr);
  const others = free.filter(c => franchiseOf(c) !== abbr);
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
    const spotsAfter = ROSTER_SIZE - roster.length - 1;
    let reserve = 0;
    let counted = 0;
    for (const x of cheap) {
      if (counted >= spotsAfter) break;
      if (ids.has(x.id) || x.id === c.id) continue;
      reserve += x.salary ?? 0;
      counted += 1;
    }
    if (counted < spotsAfter) return false;
    return sal + (c.salary ?? 0) + reserve <= CAP;
  };
  const take = c => { roster.push(c); ids.add(c.id); sal += c.salary ?? 0; };
  for (const c of rank(mine)) {
    if (roster.length >= ROSTER_SIZE) break;
    if (ids.has(c.id) || !fits(c)) continue;
    take(c);
  }
  for (const c of rank(others)) {
    if (roster.length >= ROSTER_SIZE) break;
    if (ids.has(c.id) || !fits(c)) continue;
    take(c);
  }
  // Whatever is left over goes to the cheapest cards that still fit, so the
  // roster is always ten deep.
  for (const c of cheap) {
    if (roster.length >= ROSTER_SIZE) break;
    if (ids.has(c.id) || sal + (c.salary ?? 0) > CAP) continue;
    take(c);
  }
  // Spend up to the floor if the draw came in cheap: swap the smallest salary
  // for the best affordable upgrade until the roster is in the band.
  for (let guard = 0; guard < 40 && roster.length > 0 && sal < RANDOM_MIN_SAL; guard += 1) {
    const worstIdx = roster.reduce((w, c, i) => ((c.salary ?? 0) < (roster[w].salary ?? 0) ? i : w), 0);
    const worst = roster[worstIdx];
    const room = CAP - sal + (worst.salary ?? 0);
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
export function buildAiLeague(count, { cards = CARDS, taken = new Set(), exclude = [], rng = Math.random } = {}) {
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
    const roster = buildAiRoster(f.abbr, { cards, taken: used, rng });
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
