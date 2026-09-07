// Rebuild The Photo Hunt — the checklist of every card still waiting on a photo.
//
//   node scripts/studio/photoHunt.mjs > photo-hunt.html
//
// ── WHY THIS IS A SCRIPT AND NOT A HAND-EDITED PAGE ─────────────────────────
//
// The page was written by hand once and immediately went stale: the pool has
// since lost five players, the rookie sets lost 151 cards between them, and
// three whole sets (Dissonance, Team Rewards, WNBA Super Season) never appeared
// on it at all. Hand-patching a thousand rows to match a regenerated set is the
// kind of job that is wrong the moment it is finished.
//
// TICK KEYS ARE THE ONE THING THAT MUST NOT MOVE. Progress lives in the
// reader's own localStorage under `set/fileId`, so a row that keeps its key
// keeps its tick across a rebuild. That is why the key is built from the set id
// and the card id rather than from anything cosmetic like a row index.
//
// WHAT COUNTS AS "HAS A PHOTO" is exactly what the studio counts: a file at
// card-art/sets/{set}/photos/{id}.{any ext}. Read off the filesystem rather
// than from a manifest, because the manifest is one more thing to go stale.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARD_SETS } from '../../src/game/cardSets.js';
import { STRATS } from '../../src/game/strats.js';
import { getTeam, franchiseForSeason, canonicalTeam } from '../../src/cards/teams.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Section order and labels. Sets absent here are simply not hunted. */
const SECTIONS = [
  ['2026-27', '2026-27 Base', 'NBA'],
  ['summer-standouts', 'Summer Standouts', 'NBA'],
  ['super-season', 'Super Season', 'NBA'],
  ['rookie', 'Rookie', 'NBA'],
  ['dissonance', 'Dissonance', 'NBA'],
  ['team-rewards', 'Team Rewards', 'NBA'],
  ['set-rewards', 'Set Rewards', 'NBA'],
  ['wnba', 'WNBA', 'WNBA'],
  ['wnba-rookie', 'WNBA Rookie', 'WNBA'],
  ['wnba-super-season', 'WNBA Super Season', 'WNBA'],
  ['wnba-team-rewards', 'WNBA Team Rewards', 'WNBA'],
  ['wnba-set-rewards', 'WNBA Set Rewards', 'WNBA'],
];

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** File stems already present in a set's photos directory. */
function photoIds(set) {
  const dir = path.join(ROOT, 'card-art', 'sets', set, 'photos');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).map(f => f.replace(/\.[^.]+$/, '')));
}

/**
 * The year to SEARCH for, which is not the year to print.
 *
 * A card says "2006-07" because that is the season. An image search for
 * "2006-07" only matches pages that spell the season that way, and most do not
 * — a photo agency captions it "2007". Searching the latter year alone finds
 * the same uniform and far more of it. The table keeps the full label, because
 * a reader needs to know which season they are looking for.
 *
 * WNBA labels are already a single year and pass through untouched.
 */
function searchSeason(label, rookie = false) {
  const span = /^(\d{4})-\d{2}$/.exec(String(label ?? ''));
  if (!span) return String(label ?? '');
  // A ROOKIE CARD SEARCHES THE EARLIER YEAR (the user, 2026-09-07). The rule
  // above holds for a season in general — an agency captions 2006-07 as
  // "2007" — but a rookie is written about when he ARRIVES: "2024 NBA draft",
  // "2024 rookie", his summer-league and opening-night photos. Searching 2025
  // for a 2024-25 rookie finds his second-half and playoff pictures instead.
  return String(Number(span[1]) + (rookie ? 0 : 1));
}

/**
 * The search a human would type, minus the part they would forget.
 *
 * `-card -cards -topps -panini -facebook -instagram -threads` is load-bearing: without it a player-plus-season
 * image search returns trading cards, which is precisely the thing this hunt is
 * trying to make rather than find.
 */
function searchUrl(name, team, seasonLabel, league, rookie = false) {
  const parts = [
    name, team?.city, team?.name,
    league === 'WNBA' ? 'WNBA' : null,
    searchSeason(seasonLabel, rookie),
    rookie ? 'rookie' : null,
  ].filter(Boolean).join(' ');
  const q = encodeURIComponent(`${parts} -card -cards -topps -panini -facebook -instagram -threads`);
  return `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${q}`;
}

function rowsFor(setId, league) {
  const have = photoIds(setId);
  const cards = (CARD_SETS[setId] ?? []).filter(c => !have.has(c.id));
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards.map(card => {
    // The card's team code is already era-resolved by the generators; resolving
    // again is a no-op for those and a correction for any that are not.
    const key = card.season
      ? franchiseForSeason(canonicalTeam(card.team), card.season)
      : card.team;
    const team = getTeam(key, { league });
    const label = card.seasonLabel ?? (league === 'WNBA' ? '2026' : '2025-26');
    const era = team?.era ? `<span class="era">${esc(team.era)}</span>` : '';
    // A rookie card searches differently — see searchSeason. A capstone reward
    // MIGRATED out of a rookie set is still a rookie card and searches the
    // same way (Michael Jordan 1984-85 in set-rewards).
    const rookie = /rookie$/.test(setId) || /rookie$/.test(card.migratedFrom?.set ?? '');
    return `<tr data-k="${esc(setId)}/${esc(card.id)}">` +
      `<td class="pick"><button class="tick" aria-label="done"></button></td>` +
      `<td class="who"><a href="${esc(searchUrl(card.name, team, label, league, rookie))}" target="_blank" rel="noopener">${esc(card.name)}</a></td>` +
      `<td class="season">${esc(label)}</td>` +
      `<td class="jersey"><span class="code">${esc(key)}</span> ${era}</td>` +
      `<td class="fileid">${esc(card.id)}</td></tr>`;
  });
}

// ── Strategy cards ──────────────────────────────────────────────────────────
//
// Forty-two strats have a hand-made face; these nine are COMPOSED by the
// studio from strats.js and need only a photo dropped on them (the studio's
// own note in src/studio/players.js). The photo lands where every other
// set's does — card-art/sets/strats/photos/{id}.{ext} — so this section reads
// the same folder the studio writes. The search is the card's idea, not a
// player: "NBA double team" finds a trap, not a person.
const COMPOSED_STRATS = new Set([
  // The sign-up promo: the user wants a photo of Shai getting fouled here
  // (and an Underdog logo somewhere on the face), 2026-09-07.
  'unethical_hoops',
  'double_team', 'pick_up_full_court', 'cross_court_dime',
  'desperation_press', 'second_closer', 'ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset',
  // Wave one of the docx backlog (2026-09-06).
  'spain_pick_roll', 'mismatch_hunter', 'strength_in_numbers', 'energizer', 'defensive_identity',
  'defensive_anchor', 'swarming_defense', 'five_out', 'hammer_set', 'iso_heavy', 'three_point_barrage',
  'crash_and_kick', 'pick_and_pop', 'extra_pass', 'lob_city', 'stretch_five', 'post_domination',
  'unsung_hero', 'transition_outlet', 'find_the_open_man', 'putback_specialist', 'rim_protector',
  'drop_coverage', 'smothering_defense', 'denial', 'hustle_play', 'glass_cleaner', 'box_out',
  'help_defender',
]);
const PHASE_LABEL = { matchup: 'Matchup', pre_roll: 'Pre-roll', scoring: 'Scoring', post_roll: 'Post-roll', reaction: 'Reaction' };

function stratRows() {
  const have = photoIds('strats');
  // MS-Paint placeholders (scripts/studio/paintPlaceholders.py) sit in the
  // photos folder so the studio composes a face today, and list themselves in
  // _placeholders.json so the hunt still asks for the real photo.
  const manifest = path.join(ROOT, 'card-art', 'sets', 'strats', 'photos', '_placeholders.json');
  const placeholders = new Set(fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : []);
  return STRATS
    .filter(s => COMPOSED_STRATS.has(s.id) && (!have.has(s.id) || placeholders.has(s.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => {
      const q = encodeURIComponent(`NBA ${s.name} basketball -card -cards -topps -panini -facebook -instagram -threads`);
      const url = `https://www.google.com/search?tbm=isch&tbs=isz:l&q=${q}`;
      return `<tr data-k="strats/${esc(s.id)}">` +
        `<td class="pick"><button class="tick" aria-label="done"></button></td>` +
        `<td class="who"><a href="${url}" target="_blank" rel="noopener">${esc(s.name)}</a></td>` +
        `<td class="season">${esc(PHASE_LABEL[s.phase] ?? s.phase)}</td>` +
        `<td class="jersey"><span class="code">${s.side === 'def' ? 'DEFENSE' : 'OFFENSE'}</span> <span class="era">${esc(s.rarity)}</span></td>` +
        `<td class="fileid">${esc(s.id)}${placeholders.has(s.id) ? ' <span class="era">placeholder art</span>' : ''}</td></tr>`;
    });
}

const PLAYER_HEADS = ['', 'Player (click = tuned image search)', 'Season', 'Jersey', 'Save as (any ext)'];
const STRAT_HEADS = ['', 'Card (click = image search for the idea)', 'Phase', 'Side · rarity', 'Save as (any ext)'];

const sections = [
  ...SECTIONS.map(([id, label, league]) => ({ id, label, league, heads: PLAYER_HEADS, rows: rowsFor(id, league) })),
  { id: 'strats', label: 'Strategy cards', league: null, heads: STRAT_HEADS, rows: stratRows() },
].filter(s => s.rows.length > 0);
const total = sections.reduce((n, s) => n + s.rows.length, 0);

const toc = sections.map(s => `<a href="#${s.id}">${esc(s.label)}</a>`).join('');
const body = sections.map(s => `<div class="rule" id="${s.id}">${esc(s.label)} — <span class="n" data-set="${s.id}">${s.rows.length}</span> to find</div>
<div class="scroller"><table>
<thead><tr>${s.heads.map(t => `<th>${esc(t)}</th>`).join('')}</tr></thead>
<tbody>
${s.rows.join('\n')}
</tbody></table></div>`).join('\n');

process.stdout.write(`<title>The Photo Hunt</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Tomorrow:wght@500;700&family=Barlow:wght@400;500;600&display=swap">
<style>
:root {
  --ground:#f2f4f6; --panel:#ffffff; --panel2:#e9edf1; --ink:#1a2230; --dim:#5b6675;
  --line:#d4d9e0; --accent:#c25f17; --done:#3d8a4e;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --ground:#10151d; --panel:#171e29; --panel2:#1d2634; --ink:#e8ebf0; --dim:#97a1af;
  --line:#2a3341; --accent:#e8853b; --done:#5abf74;
} }
:root[data-theme="dark"] {
  --ground:#10151d; --panel:#171e29; --panel2:#1d2634; --ink:#e8ebf0; --dim:#97a1af;
  --line:#2a3341; --accent:#e8853b; --done:#5abf74;
}
* { box-sizing:border-box }
body { margin:0; background:var(--ground); color:var(--ink);
  font:400 15px/1.5 Barlow, 'Segoe UI', system-ui, sans-serif; }
.wrap { max-width:980px; margin:0 auto; padding:36px 24px 80px }
h1 { font:700 32px/1.1 Tomorrow, 'Arial Narrow', sans-serif; margin:0 0 6px }
h1 .t { color:var(--accent) }
header p { max-width:64ch; color:var(--dim); margin:0 0 4px }
.toc { display:flex; flex-wrap:wrap; gap:8px; margin:14px 0 4px }
.toc a { font:600 12px Tomorrow, sans-serif; letter-spacing:.06em; color:var(--accent);
  text-decoration:none; border:1px solid var(--line); background:var(--panel);
  padding:5px 10px; border-radius:4px }
.rule { font:500 13px Tomorrow, sans-serif; text-transform:uppercase; letter-spacing:.12em;
  color:var(--dim); margin:28px 0 8px }
.rule .n { color:var(--accent) }
.scroller { overflow-x:auto }
table { border-collapse:collapse; width:100%; background:var(--panel); border:1px solid var(--line) }
th { font:500 11px/1 Tomorrow, sans-serif; text-transform:uppercase; letter-spacing:.12em;
  color:var(--dim); text-align:left; padding:9px 12px; border-bottom:1px solid var(--line);
  background:var(--panel2) }
td { padding:6px 12px; border-bottom:1px solid var(--line); white-space:nowrap }
tr:last-child td { border-bottom:none }
.who a { font-weight:600; color:var(--ink); text-decoration:none; border-bottom:1px dashed var(--accent) }
.who a:hover { color:var(--accent) }
.season { font-variant-numeric:tabular-nums; color:var(--dim) }
.code { font:700 12px Tomorrow, sans-serif; letter-spacing:.06em; color:var(--accent) }
.era { color:var(--dim); font-size:12px }
.fileid { font-family:Consolas, monospace; font-size:12px; color:var(--dim) }
.tick { width:17px; height:17px; border:2px solid var(--dim); background:transparent;
  border-radius:3px; cursor:pointer; padding:0 }
.tick:focus-visible { outline:2px solid var(--accent); outline-offset:2px }
tr.on { display:none }
body.show-done tr.on { display:table-row }
body.show-done tr.on td { opacity:.45 }
tr.on .tick { background:var(--done); border-color:var(--done) }
.note { font-size:13px; color:var(--dim) }
</style>
<div class="wrap">
<header>
<h1>The <span class="t">Photo Hunt</span></h1>
<p>Every card still waiting on a photo — ${total} of them. Each name opens a Google
image search already tuned to large images with the team and season in the query, and trading-card listings excluded.
The <b>Jersey</b> column tells you which era uniform to look for; the <b>Save as</b>
column is the exact filename stem the studio expects (any image extension works)
in <code>card-art/sets/&lt;set&gt;/photos/</code> — or just drop the image on the
card's row in the studio and skip filenames entirely. Strategy cards are the last section:
the studio composes those faces, so a photo is all a new one needs.</p>
<p class="note">Ticks are saved in this browser so you can track progress across sessions.
Re-ask me for a fresh page anytime — it rebuilds from whatever is still missing.</p>
<p><button id="toggleDone" class="tick" style="width:auto;height:auto;padding:5px 12px;font:600 12px Tomorrow,sans-serif;color:var(--dim)">Show done (<span id="doneCount">0</span>)</button></p>
<nav class="toc">${toc}</nav>
</header>
${body}
</div>
<script>
const KEY='photo-hunt-done';
let done=new Set();
try { done=new Set(JSON.parse(localStorage.getItem(KEY)||'[]')); } catch(e) {}
const rows=[...document.querySelectorAll('tr[data-k]')];
function save(){ try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch(e) {} }
function paint(){
  rows.forEach(r=>r.classList.toggle('on', done.has(r.dataset.k)));
  document.getElementById('doneCount').textContent=done.size;
  document.querySelectorAll('.n[data-set]').forEach(n=>{
    const set=n.dataset.set;
    const remaining=rows.filter(r=>r.dataset.k.startsWith(set+'/')&&!done.has(r.dataset.k)).length;
    n.textContent=remaining;
  });
}
rows.forEach(r=>r.querySelector('.tick').addEventListener('click',()=>{
  const k=r.dataset.k; done.has(k)?done.delete(k):done.add(k); save(); paint();
}));
document.getElementById('toggleDone').addEventListener('click',()=>{
  document.body.classList.toggle('show-done');
});
paint();
</script>
`);
