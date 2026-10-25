// THE COACHES' STYLES — every franchise's coach plays one (2026-10-25,
// docs/plans/2026-10-25-the-climb-events-and-styles-draft.md; the user: "Those
// work"). Each is a strength and a hole, never a plain buff (the user, of boss
// abilities: "It's already hard enough, so maybe we can do that if there's a
// tradeoff"). Shown on the map stop and before the game, so a route is a
// choice of who to play, not only where.
//
// A style is a set of effects the game reads (styleFx): stat moves on the
// coach's cards (speed, power, defBoost), and engine effects through
// gameOpts.style (firstRoll, crunchRoll, star, others, minutes, draw, hand,
// fullRest, threes, paint, againstPaint, rebOnMiss).
//
// BALANCED BY THE SIM (2026-10-25, runClimbSim's by-style tally, 400 runs):
// the first cut made Act II's Games 5 points harder, and three styles were
// the reason — Glass Eaters won 63%, Bully Ball 67%, Splash 68%, against 76-83%
// for the rest. A rebound on every roll was too many, and a hole on the check
// a coach seldom takes was no hole: Glass Eaters' board comes on a scoreless
// roll now, and Bully Ball and Splash give up Speed and Power instead. Act I's Games play only
// the hole; a Rivalry, a boss and every game of Acts II and III play both; a
// boss at Full Strength doubles the strength.

export const STYLES = Object.freeze({
  seven_seconds: {
    name: 'Seven Seconds',
    strength: 'their rolls +1 in the first section', hole: 'they tire a minute faster each section',
    fx: { strength: { firstRoll: 1 }, hole: { minutes: 1 } },
  },
  grit_and_grind: {
    name: 'Grit and Grind',
    strength: 'your paint checks −1', hole: 'their 3PT checks −1',
    fx: { strength: { againstPaint: -1 }, hole: { threes: -1 } },
  },
  splash: {
    name: 'Splash',
    strength: 'their 3PT checks +1', hole: 'their whole team −1 Power',
    fx: { strength: { threes: 1 }, hole: { power: -1 } },
  },
  bully_ball: {
    name: 'Bully Ball',
    strength: 'their paint checks +1', hole: 'their whole team −1 Speed',
    fx: { strength: { paint: 1 }, hole: { speed: -1 } },
  },
  heliocentric: {
    name: 'Heliocentric',
    strength: 'their highest-paid player’s rolls +2', hole: 'their other starters’ rolls −1',
    fx: { strength: { star: 2 }, hole: { others: -1 } },
  },
  bench_mob: {
    name: 'Bench Mob',
    strength: 'a player of theirs who sits a section comes back fresh', hole: 'their opening hand is a card short',
    fx: { strength: { fullRest: true }, hole: { hand: -1 } },
  },
  closers: {
    name: 'Closers',
    strength: 'their rolls +1 in Crunch Time', hole: 'their rolls −1 in the first section',
    fx: { strength: { crunchRoll: 1 }, hole: { firstRoll: -1 } },
  },
  glass_eaters: {
    name: 'Glass Eaters',
    strength: '+1 rebound on each of their scoring rolls that scores nothing', hole: 'their whole team −1 Speed',
    fx: { strength: { rebOnMiss: 1 }, hole: { speed: -1 } },
  },
  pace_and_space: {
    name: 'Pace and Space',
    strength: 'their whole team +1 Speed', hole: 'their whole team −1 Power',
    fx: { strength: { speed: 1 }, hole: { power: -1 } },
  },
  process: {
    name: 'Process',
    strength: 'they draw a card more each section', hole: 'their Defensive Bonus −1',
    fx: { strength: { draw: 1 }, hole: { defBoost: -1 } },
  },
});
export const STYLE_IDS = Object.freeze(Object.keys(STYLES));

/** Each franchise's style: three franchises a style. */
export const FRANCHISE_STYLE = Object.freeze({
  PHX: 'seven_seconds', SAC: 'seven_seconds', IND: 'seven_seconds',
  MEM: 'grit_and_grind', MIA: 'grit_and_grind', NYK: 'grit_and_grind',
  GSW: 'splash', BOS: 'splash', ATL: 'splash',
  CLE: 'bully_ball', MIN: 'bully_ball', NOP: 'bully_ball',
  DAL: 'heliocentric', LAL: 'heliocentric', MIL: 'heliocentric',
  TOR: 'bench_mob', SAS: 'bench_mob', UTA: 'bench_mob',
  LAC: 'closers', CHI: 'closers', DEN: 'closers',
  DET: 'glass_eaters', OKC: 'glass_eaters', POR: 'glass_eaters',
  CHA: 'pace_and_space', HOU: 'pace_and_space', ORL: 'pace_and_space',
  PHI: 'process', WAS: 'process', BKN: 'process',
});

/** A franchise's style id, or null. */
export const styleOf = abbr => FRANCHISE_STYLE[abbr] ?? null;

/** The card stats a style moves (on the coach's copies of its cards). */
export const STAT_FX = Object.freeze(['speed', 'power', 'defBoost']);

/**
 * The effects a style plays with at a stop: the hole only for Act I's Games,
 * both halves otherwise; `full` (a boss at Full Strength) doubles the
 * strength's numbers. Returns { id, level, fx } or null.
 */
export function styleAt(abbr, { act = 1, kind = 'game', full = false } = {}) {
  const id = styleOf(abbr);
  if (!id) return null;
  const { strength, hole } = STYLES[id].fx;
  const level = act <= 1 && kind === 'game' ? 'hole' : full ? 'full' : 'both';
  const fx = { ...hole };
  if (level !== 'hole') {
    for (const [k, v] of Object.entries(strength)) {
      const n = typeof v === 'number' ? v * (level === 'full' ? 2 : 1) : v;
      fx[k] = typeof n === 'number' ? (fx[k] ?? 0) + n : n;
    }
  }
  return { id, level, fx };
}

/** The effects the engine reads (gameOpts.style): the style less its stat moves, or null. */
export function engineFx(fx) {
  if (!fx) return null;
  const out = Object.fromEntries(Object.entries(fx).filter(([k]) => !STAT_FX.includes(k)));
  return Object.keys(out).length ? out : null;
}

/** A coach's card with its style's stat moves on it — a copy. */
export function styledCard(card, fx) {
  if (!card || !fx) return card;
  const out = { ...card };
  for (const k of STAT_FX) if (fx[k]) out[k] = Math.max(0, (out[k] ?? 0) + fx[k]);
  return out;
}

/** What the screens say: "Seven Seconds: their rolls +1 in the first section; they tire a minute faster each section". */
export function styleLine(style) {
  if (!style) return '';
  const s = STYLES[style.id];
  if (!s) return '';
  const strength = style.level === 'full' ? `${s.strength} (doubled: Full Strength)` : s.strength;
  return style.level === 'hole' ? `${s.name}, its hole only in Act I's Games: ${s.hole}` : `${s.name}: ${strength}; ${s.hole}`;
}
