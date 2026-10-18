// THE CLIMB'S MAP AND POT — one act, built from a seed.
//
// The browser draws the map to play it and the server draws the SAME map to
// price it (functions/index.js climbBank): the seed is the server's, so the
// kind and floor of every stop a run clears are the server's own facts, and
// the pot is never the browser's number. Hence this file imports nothing but
// the rung's pay table, and is copied to the Cloud Functions by prepare.mjs.
//
// docs/plans/2026-10-18-the-climb-design.md: seven floors and the boss, three
// lanes, each stop linked to one or two stops above with no crossing paths.
// Floor 1 is all Games, floor 7 all Rest Days. Every path passes a Rivalry and
// a Rest Day on floors 2-6, and no path has two Rest Days in a row — so floor
// 6, under floor 7's Rest Days, is never one.
import { payFactorOf } from '../coinRewards.js';

export const FLOORS = 7;
export const LANES = 3;
/**
 * Floors 2-6 draw their kinds at these weights. Rivalries were a quarter at
 * first, and the repair (every path needs one) took them past a third of the
 * fights; at 0.15 they are about a quarter (runClimbSim.js, 2026-10-18).
 */
export const KIND_WEIGHTS = { game: 0.6, rivalry: 0.15, rest: 0.25 };
/** What each stop adds to the pot, before the rung's pay factor. */
export const POT = { gameBase: 30, gamePerFloor: 5, rivalry: 70, boss: 120 };
/**
 * THE GENERATOR'S VERSION, stamped on every run and ledger (final review,
 * 2026-10-18): the server rebuilds a run's map from its seed, so a change to
 * how maps are drawn would reshape every run in flight. A change bumps this
 * and keeps the old draw for the runs drawn with it.
 */
export const MAP_VERSION = 1;
/** Set on a map that came from the fixed fallback rather than the seed's draw. */
export const FALLBACK_SEED_USE = 'fallback';
const MAX_TRIES = 500;

/** A 32-bit FNV-1a hash of a string. */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * A seeded stream in [0, 1): mulberry32 over the seed and the parts. The same
 * arguments give the same numbers in the browser and on the server, and each
 * purpose ('map', 'offers', a stop id) gets a stream of its own.
 */
export function climbRng(seed, ...parts) {
  let a = hash([seed, ...parts].join('|'));
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const stopId = (floor, lane) => `${floor}-${lane}`;

function pickKind(rng, allowRest) {
  const w = allowRest ? KIND_WEIGHTS : { game: KIND_WEIGHTS.game, rivalry: KIND_WEIGHTS.rivalry };
  const total = Object.values(w).reduce((t, x) => t + x, 0);
  let r = rng() * total;
  for (const [kind, x] of Object.entries(w)) { r -= x; if (r < 0) return kind; }
  return 'game';
}

/**
 * EVERY WAY ONE FLOOR CAN LINK TO THE NEXT, listed once: each lane to one or
 * two neighbouring lanes (side by side), no two links crossing (a lower lane
 * never reaches past where a higher one starts), and every stop above with a
 * way in. A floor's links are one of these, picked by the stream. Drawing
 * lane by lane and throwing out the misses left a stop unreachable on 65% of
 * floors, so nearly every act fell back to the fixed one (2026-10-18).
 */
const LINK_PATTERNS = (() => {
  const choices = lane => {
    const near = [lane - 1, lane, lane + 1].filter(l => l >= 0 && l < LANES);
    const out = near.map(l => [l]);
    for (const l of near) if (near.includes(l + 1)) out.push([l, l + 1]);
    return out;
  };
  let sets = [[]];
  for (let lane = 0; lane < LANES; lane += 1) {
    sets = sets.flatMap(prev => choices(lane).map(t => [...prev, t]));
  }
  return sets.filter(set => {
    for (let a = 0; a < set.length; a += 1) {
      for (let c = a + 1; c < set.length; c += 1) {
        if (Math.max(...set[a]) > Math.min(...set[c])) return false;
      }
    }
    const hit = new Set(set.flat());
    return Array.from({ length: LANES }, (_, l) => l).every(l => hit.has(l));
  });
})();

function drawLinks(rng) {
  return LINK_PATTERNS[Math.floor(rng() * LINK_PATTERNS.length)];
}

function draw(rng) {
  const floors = [];
  for (let f = 1; f <= FLOORS; f += 1) {
    const row = [];
    for (let lane = 0; lane < LANES; lane += 1) {
      const kind = f === 1 ? 'game' : f === FLOORS ? 'rest' : pickKind(rng, f !== FLOORS - 1);
      row.push({ id: stopId(f, lane), floor: f, lane, kind, next: [] });
    }
    floors.push(row);
  }
  for (let f = 1; f < FLOORS; f += 1) {
    const links = drawLinks(rng);
    floors[f - 1].forEach((s, lane) => { s.next = links[lane].map(l => stopId(f + 1, l)); });
  }
  for (const s of floors[FLOORS - 1]) s.next = ['boss'];
  return { floors, boss: { id: 'boss', floor: FLOORS + 1, lane: 1, kind: 'boss', next: [] } };
}

/** Every path from floor 1 to the boss, as lists of stops. */
function allPaths(map) {
  const out = [];
  const walk = (stop, acc) => {
    const next = [...acc, stop];
    if (stop.kind === 'boss') { out.push(next); return; }
    for (const id of stop.next) walk(stopById(map, id), next);
  };
  for (const s of map.floors[0]) walk(s, []);
  return out;
}

/** The stops linked to this one, below and above. */
function neighbours(map, stop) {
  const below = stop.floor > 1 ? map.floors[stop.floor - 2].filter(s => s.next.includes(stop.id)) : [];
  return [...below, ...stop.next.map(id => stopById(map, id))];
}

/**
 * THE REPAIR. A free draw almost never puts a Rest Day AND a Rivalry on every
 * one of the act's ~40 paths (195 of 200 seeds missed, 2026-10-18), so the
 * draw is mended: a path with no Rest Day gets one of its Games on floors 2-5
 * turned into a Rest Day (one with no Rest Day linked to it), then a path with
 * no Rivalry gets one of its Games on floors 2-6 turned into a Rivalry. The
 * stream picks which, so the mend is as seeded as the draw.
 */
function repair(map, rng) {
  const pick = list => list[Math.floor(rng() * list.length)];
  const mid = (p, top) => p.filter(s => s.floor >= 2 && s.floor <= top);
  for (let guard = 0; guard < 40; guard += 1) {
    const p = allPaths(map).find(x => !mid(x, FLOORS - 1).some(s => s.kind === 'rest'));
    if (!p) break;
    const can = mid(p, FLOORS - 2).filter(s => s.kind === 'game' && !neighbours(map, s).some(n => n.kind === 'rest'));
    if (!can.length) return false;
    pick(can).kind = 'rest';
  }
  for (let guard = 0; guard < 40; guard += 1) {
    const p = allPaths(map).find(x => !mid(x, FLOORS - 1).some(s => s.kind === 'rivalry'));
    if (!p) break;
    const can = mid(p, FLOORS - 1).filter(s => s.kind === 'game');
    if (!can.length) return false;
    pick(can).kind = 'rivalry';
  }
  return true;
}

/** True when every path keeps the act's rules. */
function keepsTheRules(map) {
  let ok = true;
  const walk = (stop, sawRivalry, sawRest, prevRest) => {
    if (!ok) return;
    if (stop.kind === 'boss') { if (!sawRivalry || !sawRest) ok = false; return; }
    const rest = stop.kind === 'rest';
    if (rest && prevRest) { ok = false; return; }
    const mid = stop.floor >= 2 && stop.floor <= FLOORS - 1;
    for (const id of stop.next) {
      walk(stopById(map, id), sawRivalry || (mid && stop.kind === 'rivalry'), sawRest || (mid && rest), rest);
    }
  };
  for (const s of map.floors[0]) walk(s, false, false, false);
  return ok;
}

/** The fixed act every rule holds for, should 500 draws all miss. */
function fallbackMap() {
  const kinds = { 2: 'game', 3: 'rivalry', 4: 'rest', 5: 'game', 6: 'rivalry' };
  const floors = [];
  for (let f = 1; f <= FLOORS; f += 1) {
    floors.push([0, 1, 2].map(lane => ({
      id: stopId(f, lane), floor: f, lane,
      kind: f === 1 ? 'game' : f === FLOORS ? 'rest' : kinds[f],
      next: f === FLOORS ? ['boss'] : [stopId(f + 1, lane)],
    })));
  }
  return { floors, boss: { id: 'boss', floor: FLOORS + 1, lane: 1, kind: 'boss', next: [] }, [FALLBACK_SEED_USE]: true };
}

/** The act for a seed — the same map every time, here and on the server — at a generator version. */
export function generateMap(seed, version = MAP_VERSION) {
  if (version !== 1) throw new Error(`No act map version ${version}`);
  const rng = climbRng(seed, 'map');
  for (let i = 0; i < MAX_TRIES; i += 1) {
    const m = draw(rng);
    if (m && repair(m, rng) && keepsTheRules(m)) return m;
  }
  return fallbackMap();
}

export function stopById(map, id) {
  if (id === 'boss') return map?.boss ?? null;
  const [f, lane] = String(id).split('-').map(Number);
  return map?.floors?.[f - 1]?.[lane] ?? null;
}

/** Where a run can go next: floor 1 from the start (null), else the stop's links. */
export function nextStops(map, fromId) {
  if (fromId == null) return [...map.floors[0]];
  const s = stopById(map, fromId);
  return (s?.next ?? []).map(id => stopById(map, id)).filter(Boolean);
}

/**
 * Can a run that last played `fromId` (null: nothing yet) start a game at
 * `toId`? Yes when `toId` is a fight reached through Rest Days only — the
 * server never hears about a Rest Day, so this is its legality test.
 */
export function reachableGame(map, fromId, toId) {
  const target = stopById(map, toId);
  if (!target || target.kind === 'rest') return false;
  const queue = nextStops(map, fromId);
  const seen = new Set();
  while (queue.length) {
    const s = queue.shift();
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    if (s.id === toId) return true;
    if (s.kind === 'rest') queue.push(...nextStops(map, s.id));
  }
  return false;
}

/** What one cleared stop adds to the pot, before the rung. */
export function stopPot(stop) {
  switch (stop?.kind) {
    case 'game': return POT.gameBase + POT.gamePerFloor * ((stop.floor ?? 1) - 1);
    case 'rivalry': return POT.rivalry;
    case 'boss': return POT.boss;
    default: return 0;
  }
}

/** The pot of a run that cleared these stops at this rung: coins, and a Booster for the boss. */
export function potOf(map, clearedIds, rung) {
  const ids = [...new Set(clearedIds ?? [])];
  const sum = ids.reduce((t, id) => t + stopPot(stopById(map, id)), 0);
  return { coins: Math.round(sum * payFactorOf(rung)), booster: ids.includes('boss') && Boolean(map?.boss) };
}

/** The results screen's line for a run game: it pays nothing now, it adds to the pot. */
export function runClaimPreview(stop, rung, won) {
  if (!won) return { coins: 0, breakdown: [{ label: 'The run is over and the pot is lost', coins: 0 }] };
  const n = Math.round(stopPot(stop) * payFactorOf(rung));
  const label = stop?.kind === 'boss' ? `Into the pot: +${n} and a Booster` : `Into the pot: +${n}`;
  return { coins: 0, breakdown: [{ label, coins: 0 }] };
}
