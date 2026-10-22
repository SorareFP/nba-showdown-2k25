// THE CLIMB'S MAP AND POT — three acts, each built from the seed.
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
import { payFactorOf, climbGamePay } from '../coinRewards.js';

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
 * THREE ACTS (2026-10-20, docs/plans/2026-10-20-the-climb-three-acts.md; the
 * user: "the point of the game is to have 3 acts like Slay the Spire ...
 * 'take what you've earned and quit,' or 'keep going and adding to the pot.'
 * The game gets harder and the rewards get bigger as you go up"). One pot:
 * a loss in any act loses all of it. Act I's ids are the old ones ('1-0',
 * 'boss'), so a run drawn before acts keeps its map; Acts II and III prefix
 * theirs ('a2:1-0', 'a3:boss') and draw from their own stream.
 */
export const ACTS = 3;
/** Each act's stops add this much more to the pot (the rung's pay on top). */
export const ACT_POT = { 1: 1, 2: 1.5, 3: 2 };
/** The packs a boss adds to the pot, by act. */
export const BOSS_PACKS = { 1: ['booster'], 2: ['rare_deluxe'], 3: ['mega_deluxe'] };
const PACK_WORDS = { booster: 'a Booster', rare_deluxe: 'a Rare Deluxe', super_deluxe: 'a Super Deluxe', mega_deluxe: 'a Mega Deluxe' };
/** "a Booster and a Rare Deluxe" — the pot's packs as the screens say them. */
export function packWords(packs) {
  const w = (packs ?? []).map(p => PACK_WORDS[p] ?? p);
  return w.length <= 1 ? (w[0] ?? '') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}
/** The act a stop id belongs to. */
export function actOf(id) {
  const m = /^a([0-9]):/.exec(String(id ?? ''));
  return m ? Number(m[1]) : 1;
}
/** An act's id prefix: none for Act I. */
export const actPrefix = act => (act > 1 ? `a${act}:` : '');
/** The boss's id in an act. */
export const bossIdOf = act => `${actPrefix(act)}boss`;
/** Roman numerals for the screens. */
export const ACT_NAMES = { 1: 'Act I', 2: 'Act II', 3: 'Act III' };
/**
 * THE PERKS THE SERVER KEEPS (2026-10-22; climbPerks.js marks them `ledger`):
 * the ones the pot or the ledger's own rules read, recorded by climbPerk as
 * { id, at } — `at` is how many stops were cleared when it was taken, so the
 * pot knows which wins came after. 'win': taken from a win's reward; 'boss':
 * from a boss's, at the start of the next act.
 */
export const LEDGER_PERK_KINDS = { sponsorship: 'win', travel_day: 'win', second_chance: 'boss', max_contract: 'boss' };
/** Sponsorship: every win after it adds this much more to the pot. */
export const SPONSOR_SHARE = 0.2;
/** Travel Day: how many times a run may go to an unlinked stop on the next floor. */
export const TRAVEL_DAYS = 3;
/** When a ledger perk was taken (stops cleared by then), or null. */
const perkAt = (perks, id) => {
  const p = (perks ?? []).find(x => x?.id === id);
  return p ? (Number.isInteger(p.at) ? p.at : 0) : null;
};
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

/**
 * An act's map for a seed — the same map every time, here and on the server —
 * at a generator version. Act I draws exactly as it always has.
 */
export function generateMap(seed, version = MAP_VERSION, act = 1) {
  if (version !== 1) throw new Error(`No act map version ${version}`);
  const rng = act > 1 ? climbRng(seed, 'map', 'act', act) : climbRng(seed, 'map');
  for (let i = 0; i < MAX_TRIES; i += 1) {
    const m = draw(rng);
    if (m && repair(m, rng) && keepsTheRules(m)) return inAct(m, act);
  }
  return inAct(fallbackMap(), act);
}

/** A drawn map as an act's: its ids prefixed past Act I, and the act stamped. */
function inAct(map, act) {
  if (act <= 1) return map;
  const p = actPrefix(act);
  const stop = s => ({ ...s, id: p + s.id, next: s.next.map(n => p + n) });
  return { ...map, act, floors: map.floors.map(row => row.map(stop)), boss: stop(map.boss) };
}

export function stopById(map, id) {
  // A stop of another act is not on this map.
  if (actOf(id) !== (map?.act ?? 1)) return null;
  const raw = String(id).replace(/^a[0-9]:/, '');
  if (raw === 'boss') return map?.boss ?? null;
  const [f, lane] = raw.split('-').map(Number);
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
  return travelCost(map, fromId, toId) === 0;
}

/** Every stop on the floor above `fromId`'s (Travel Day's reach), or [] at the top. */
export function nextFloorStops(map, fromId) {
  const s = fromId == null ? null : stopById(map, fromId);
  if (!s) return [];
  if (s.floor >= FLOORS) return map.boss ? [map.boss] : [];
  return [...(map.floors[s.floor] ?? [])];
}

/**
 * THE TRAVEL DAYS A WAY TO `toId` NEEDS (2026-10-22, the Travel Day perk:
 * "go to any stop on the next floor, linked or not"): the fewest jumps to an
 * unlinked stop on the next floor, along a way through Rest Days only;
 * Infinity when there is none or `toId` is a Rest Day. 0 is reachableGame.
 */
export function travelCost(map, fromId, toId) {
  const target = stopById(map, toId);
  if (!target || target.kind === 'rest') return Infinity;
  const best = new Map();
  // Linked steps cost nothing; a jump to the next floor costs one.
  const steps = id => [
    ...nextStops(map, id).map(s => [s, 0]),
    ...nextFloorStops(map, id).map(s => [s, 1]),
  ];
  const queue = nextStops(map, fromId).map(s => [s, 0]);
  if (fromId != null) queue.push(...nextFloorStops(map, fromId).map(s => [s, 1]));
  while (queue.length) {
    queue.sort((a, b) => a[1] - b[1]);
    const [s, cost] = queue.shift();
    if ((best.get(s.id) ?? Infinity) <= cost) continue;
    best.set(s.id, cost);
    if (s.id === toId) return cost;
    if (s.kind === 'rest') for (const [n, c] of steps(s.id)) queue.push([n, cost + c]);
  }
  return Infinity;
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

/**
 * THE WHOLE POT, every act's (2026-10-20): each act's stops priced on that
 * act's map at its ACT_POT, the rung's pay on top, and every beaten boss's
 * packs. `booster` stays for the screens and saves that read it.
 */
// THE POT'S PERKS (2026-10-22): Sponsorship adds SPONSOR_SHARE to every win
// after it; Max Contract's Games add nothing after it. `perks` is the
// ledger's (or the run's) list of { id, at }.
export function potOfRun({ seed, mapVersion = MAP_VERSION, cleared = [], rung, perks = [] }) {
  const ids = [...new Set(cleared ?? [])];
  const maps = {};
  const mapOf = act => (maps[act] ??= generateMap(seed, mapVersion, act));
  const sponsorAt = perkAt(perks, 'sponsorship');
  const maxAt = perkAt(perks, 'max_contract');
  let sum = 0;
  const packs = [];
  ids.forEach((id, i) => {
    const act = actOf(id);
    if (act < 1 || act > ACTS) return;
    const stop = stopById(mapOf(act), id);
    let add = stopPot(stop) * (ACT_POT[act] ?? 1);
    if (stop?.kind === 'game' && maxAt != null && i >= maxAt) add = 0;
    if (sponsorAt != null && i >= sponsorAt) add *= 1 + SPONSOR_SHARE;
    sum += add;
    if (stop?.kind === 'boss') packs.push(...(BOSS_PACKS[act] ?? []));
  });
  return { coins: Math.round(sum * payFactorOf(rung)), booster: packs.includes('booster'), packs };
}

/** The results screen's line for a run game: it pays nothing now, it adds to the pot. */
// Since 2026-10-19 a run game also PAYS, a quarter of a game (climbGamePay);
// `margin` is the game's (the claim's, sanitized there). The pot line follows.
// `potAdd`: what the win adds with the run's perks on (potOfRun after less
// before); `replay`: a loss Second Chance replays (2026-10-22).
export function runClaimPreview(stop, rung, won, margin = null, { potAdd = null, replay = false } = {}) {
  const pay = climbGamePay({ won, margin, aiLevel: rung });
  if (!won && replay) return { coins: pay.coins, breakdown: [...pay.breakdown, { label: 'Second Chance: this game is replayed, and the pot stays', coins: 0 }] };
  if (!won) return { coins: pay.coins, breakdown: [...pay.breakdown, { label: 'The run is over and the pot is lost', coins: 0 }] };
  const act = actOf(stop?.id);
  const n = Number.isFinite(potAdd) ? potAdd : Math.round(stopPot(stop) * (ACT_POT[act] ?? 1) * payFactorOf(rung));
  const label = stop?.kind === 'boss' ? `Into the pot: +${n} and ${packWords(BOSS_PACKS[act])}` : `Into the pot: +${n}`;
  return { coins: pay.coins, breakdown: [...pay.breakdown, { label, coins: 0 }] };
}
