// CAPSTONE CANDIDATES for the special-set completion goals.
//
//   node scripts/analysis/capstoneCandidates.mjs
//
// The user's rule (2026-09-06): the reward for completing a special set is a
// NEW card, and its player-and-team pairing should preferably (A) have no card
// in any set, or failing that (B) have no card in the BASE set. This lists,
// per set, the strongest seasons that satisfy the rule — A first — so the
// pick is a choice among real options rather than a guess. Pricing happens at
// build time (the generator, with real logs); the numbers here are quality
// signals, not salaries.
//
// Sources: the cached full-league Basketball-Reference advanced tables
// (1976-77, 1984-85 onward for the NBA; 1997 onward for the WNBA) — the pool
// archive only holds carded players, which is exactly the wrong place to look
// for an uncarded pairing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SETS, BASE_SET } from '../../src/game/cardSets.js';
import { currentFranchise, canonicalTeam, wnbaFranchiseForSeason } from '../../src/cards/teams.js';
import { readCache } from '../cardgen/cache.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const franchise = code => { try { return currentFranchise(canonicalTeam(code)) ?? code; } catch { return code; } };
const wfranchise = (code, season) => { try { return wnbaFranchiseForSeason(code, season) ?? code; } catch { return code; } };

// ── carded pairings ─────────────────────────────────────────────────────────
const nbaAny = new Set(), nbaBase = new Set(), wAny = new Set(), wBase = new Set();
for (const [set, cards] of Object.entries(CARD_SETS)) {
  const wnba = set.startsWith('wnba');
  for (const c of cards) {
    const k = wnba ? norm(c.name) + '|' + wfranchise(c.team, c.season) : norm(c.name) + '|' + franchise(c.team);
    (wnba ? wAny : nbaAny).add(k);
    if (set === BASE_SET) nbaBase.add(k);
    if (set === 'wnba') wBase.add(k);
  }
}
const rule = (name, fr, any, base) => {
  const k = norm(name) + '|' + fr;
  return !any.has(k) ? 'A' : !base.has(k) ? 'B' : null;
};

function show(title, rows, quality) {
  console.log('\n' + title);
  rows
    .sort((a, b) => (a.rule > b.rule) - (a.rule < b.rule) || quality(b) - quality(a))
    .slice(0, 10)
    .forEach(r => console.log(`   ${r.rule}  ${String(r.name).padEnd(24)} ${r.label.padEnd(8)} ${String(r.team).padEnd(4)} ${r.q}`));
}

// ── NBA ─────────────────────────────────────────────────────────────────────
const seasons = fs.readdirSync(path.join(ROOT, 'card-data', 'cache'))
  .filter(f => /^bbref-\d{4}-advanced-full\.json$/.test(f)).map(f => +f.slice(6, 10)).sort();
const byPlayer = new Map();
for (const y of seasons) {
  for (const r of readCache(`bbref-${y}-advanced-full`) ?? []) {
    if (!r.playerId || !r.team || r.team === 'TOT') continue;
    const list = byPlayer.get(r.playerId) ?? []; list.push({ ...r, season: y }); byPlayer.set(r.playerId, list);
  }
}
const label = y => `${y - 1}-${String(y).slice(2)}`;
const best = [], rookies = [];
for (const list of byPlayer.values()) {
  list.sort((a, b) => a.season - b.season);
  const top = [...list].filter(r => (r.minutes || 0) >= 1500).sort((a, b) => (b.bpm + b.vorp) - (a.bpm + a.vorp))[0];
  if (top) { const t = rule(top.name, franchise(top.team), nbaAny, nbaBase); if (t) best.push({ ...top, rule: t, label: label(top.season), q: `BPM ${top.bpm} VORP ${top.vorp} min ${top.minutes}` }); }
  // A rookie season is the FIRST appearance inside the contiguous 1985-2026 span
  // (1985 itself is excluded: a player seen there may have debuted earlier).
  const first = list[0];
  if (first.season >= 1986 && (first.minutes || 0) >= 1000 && (first.age ?? 30) <= 24) {
    const t = rule(first.name, franchise(first.team), nbaAny, nbaBase);
    if (t) rookies.push({ ...first, rule: t, label: label(first.season), q: `BPM ${first.bpm} VORP ${first.vorp} min ${first.minutes} age ${first.age}` });
  }
}
show('SUPER SEASON capstone — best season of an uncarded pairing (A = no card anywhere on that team, B = no base card):', best, r => r.bpm + r.vorp);
show('ROOKIE capstone — rookie season of an uncarded pairing:', rookies, r => r.bpm + r.vorp);

// ── Dissonance: the traded-candidates list minus what the set already holds ──
try {
  const traded = JSON.parse(fs.readFileSync(path.join(ROOT, 'card-data', 'analysis', 'traded-candidates.json'), 'utf8'));
  const rows = (Array.isArray(traded) ? traded : traded.candidates ?? traded.rows ?? []).map(r => ({ ...r }));
  const inSet = new Set((CARD_SETS.dissonance ?? []).map(c => norm(c.name) + '|' + c.season));
  const out = [];
  for (const r of rows) {
    const name = r.name ?? r.player; const season = r.season ?? r.year; const team = r.team ?? r.stintTeam;
    if (!name || !team) continue;
    if (inSet.has(norm(name) + '|' + season)) continue;
    const t = rule(name, franchise(team), nbaAny, nbaBase);
    if (!t) continue;
    out.push({ name, team, rule: t, label: season ? label(+season) : '', bpm: r.bpm ?? 0, vorp: r.vorp ?? 0, q: `BPM ${r.bpm ?? '?'} VORP ${r.vorp ?? '?'} min ${r.minutes ?? '?'}` });
  }
  console.log(`\n(traded-candidates.json: ${rows.length} rows; keys ${Object.keys(rows[0] ?? {}).join(', ')})`);
  show('DISSONANCE capstone — wrong-jersey seasons not in the set, uncarded pairing:', out, r => (r.bpm || 0) + (r.vorp || 0));
} catch (e) { console.log('\nDissonance: traded-candidates.json unreadable —', e.message); }

// ── WNBA ────────────────────────────────────────────────────────────────────
const wseasons = fs.readdirSync(path.join(ROOT, 'card-data', 'cache'))
  .filter(f => /^wnba-\d{4}-advanced\.json$/.test(f)).map(f => +f.slice(5, 9)).sort();
const wByPlayer = new Map();
for (const y of wseasons) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'card-data', 'cache', `wnba-${y}-advanced.json`), 'utf8'));
  for (const r of raw.data ?? raw) {
    if (!r.playerId || !r.team || r.team === 'TOT') continue;
    const list = wByPlayer.get(r.playerId) ?? []; list.push({ ...r, season: y }); wByPlayer.set(r.playerId, list);
  }
}
const wBest = [], wRookies = [];
for (const list of wByPlayer.values()) {
  list.sort((a, b) => a.season - b.season);
  const top = [...list].filter(r => (r.minutes || 0) >= 600).sort((a, b) => (b.ws || 0) - (a.ws || 0))[0];
  if (top) { const t = rule(top.name, wfranchise(top.team, top.season), wAny, wBase); if (t) wBest.push({ ...top, rule: t, label: String(top.season), q: `WS ${top.ws} PER ${top.per} min ${top.minutes}` }); }
  const first = list[0];
  if (first.season >= 1998 && (first.minutes || 0) >= 500) {
    const t = rule(first.name, wfranchise(first.team, first.season), wAny, wBase);
    if (t) wRookies.push({ ...first, rule: t, label: String(first.season), q: `WS ${first.ws} PER ${first.per} min ${first.minutes}` });
  }
}
show('WNBA SUPER SEASON capstone — best season (WS) of an uncarded pairing:', wBest, r => r.ws || 0);
show('WNBA ROOKIE capstone — first season of an uncarded pairing:', wRookies, r => r.ws || 0);
console.log(`\nNBA seasons scanned ${seasons.length} (${seasons[0]}-${seasons.at(-1)}); WNBA ${wseasons.length} (${wseasons[0]}-${wseasons.at(-1)}).`);
