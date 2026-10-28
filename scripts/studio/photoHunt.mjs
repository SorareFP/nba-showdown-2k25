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
import { CARD_SETS, DORMANT_CARDS, DORMANT_KEYS, PHOTO_WANTED_KEYS } from '../../src/game/cardSets.js';
import { IMAGE_EXTENSIONS } from '../../src/cards/sets.js';
// The one rule the studio reads too (2026-09-24: "Photo hunt and card studio
// aren't matching"): a placeholder is owed a photo, a dormant Throwback is not.
import { photoState, needsPhoto } from '../../src/studio/photoNeeds.js';
// The search and the uniform, shared with the studio's live Photo Hunt panel.
import { huntTarget, stratSearchUrl } from '../../src/studio/photoSearch.js';
import { STRATS } from '../../src/game/strats.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Section order and labels. Sets absent here are simply not hunted. */
const SECTIONS = [
  ['2026-27', '2026-27 Base', 'NBA'],
  ['summer-standouts', 'Summer Standouts', 'NBA'],
  ['super-season', 'Super Season', 'NBA'],
  ['rookie', 'Rookie', 'NBA'],
  ['dissonance', 'Dissonance', 'NBA'],
  // Record Breakers (2026-10-14): every card is photoWanted, so the ones still
  // without a photo are listed though dormant (see the throwbacks note below).
  ['record-breakers', 'Record Breakers', 'NBA'],
  ['team-rewards', 'Team Rewards', 'NBA'],
  ['set-rewards', 'Set Rewards', 'NBA'],
  ['wnba', 'WNBA', 'WNBA'],
  ['wnba-rookie', 'WNBA Rookie', 'WNBA'],
  ['wnba-super-season', 'WNBA Super Season', 'WNBA'],
  ['wnba-team-rewards', 'WNBA Team Rewards', 'WNBA'],
  ['wnba-set-rewards', 'WNBA Set Rewards', 'WNBA'],
  // The catch-alls, since 2026-09-24: a requested or curated Throwback is
  // live in packs and owed a photo like any card. The dormant ones are not in
  // CARD_SETS at all, so they appear only when their photo is wanted
  // (photoWanted on the curated entry, 2026-10-14: LeBron James 2022-23).
  ['throwbacks', 'Throwbacks', 'NBA'],
  ['wnba-throwbacks', 'WNBA Throwbacks', 'WNBA'],
];

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Photo stems in a set's photos directory — image files only, as the studio's server counts them. */
function photoIds(set) {
  const dir = path.join(ROOT, 'card-art', 'sets', set, 'photos');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir)
    .filter(f => IMAGE_EXTENSIONS.includes(path.extname(f).toLowerCase()))
    .map(f => f.replace(/\.[^.]+$/, '')));
}

/** The ids whose file is only placeholder art (paintPlaceholders.py writes the manifest). */
function placeholderIds(set) {
  const manifest = path.join(ROOT, 'card-art', 'sets', set, 'photos', '_placeholders.json');
  return new Set(fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : []);
}

/** Owed a photo, by the rule the studio shares (src/studio/photoNeeds.js). */
function owed(setId, id, have, placeholders) {
  return needsPhoto(photoState(setId, id, { photoIds: have, placeholders, dormantKeys: DORMANT_KEYS, wantedKeys: PHOTO_WANTED_KEYS }));
}

function rowsFor(setId, league) {
  const have = photoIds(setId);
  const placeholders = placeholderIds(setId);
  const wanted = DORMANT_CARDS.filter(c => c.set === setId && PHOTO_WANTED_KEYS.has(`${c.set}:${c.id}`));
  const cards = [...(CARD_SETS[setId] ?? []), ...wanted].filter(c => owed(setId, c.id, have, placeholders));
  cards.sort((a, b) => a.name.localeCompare(b.name));
  return cards.map(card => {
    // The season, the era-resolved team, its uniform era and the search —
    // src/studio/photoSearch.js, which the studio's panel reads too.
    const t = huntTarget(setId, card);
    const era = t.era ? `<span class="era">${esc(t.era)}</span>` : '';
    return `<tr data-k="${esc(setId)}/${esc(card.id)}">` +
      `<td class="pick"><button class="tick" aria-label="done"></button></td>` +
      `<td class="who"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(card.name)}</a></td>` +
      `<td class="season">${esc(t.label)}</td>` +
      `<td class="jersey"><span class="code">${esc(t.code)}</span> ${era}</td>` +
      `<td class="fileid">${esc(card.id)}</td></tr>`;
  });
}

// ── Strategy cards ──────────────────────────────────────────────────────────
//
// EVERY strat face is composed by the studio from strats.js (the full export
// of 2026-09-06 replaced the old hand-made strat_*.png faces), so a strat is
// owed a photo exactly as a player card is: none on disk, or MS-Paint
// placeholder art (scripts/studio/paintPlaceholders.py) listed in
// _placeholders.json. This section used to read a hand-kept list of
// "composed" strats that had gone stale — it asked for 46 while 95 wore
// placeholders or nothing. The photo lands where every other set's does —
// card-art/sets/strats/photos/{id}.{ext}. The search is the card's idea, not a
// player: "NBA double team" finds a trap, not a person.
const PHASE_LABEL = { matchup: 'Matchup', pre_roll: 'Pre-roll', scoring: 'Scoring', post_roll: 'Post-roll', reaction: 'Reaction' };

function stratRows() {
  const have = photoIds('strats');
  // MS-Paint placeholders (scripts/studio/paintPlaceholders.py) sit in the
  // photos folder so the studio composes a face today, and list themselves in
  // _placeholders.json so the hunt still asks for the real photo.
  const placeholders = placeholderIds('strats');
  return STRATS
    .filter(s => owed('strats', s.id, have, placeholders))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(s => {
      const url = stratSearchUrl(s);
      return `<tr data-k="strats/${esc(s.id)}">` +
        `<td class="pick"><button class="tick" aria-label="done"></button></td>` +
        `<td class="who"><a href="${url}" target="_blank" rel="noopener">${esc(s.name)}</a></td>` +
        `<td class="season">${esc(PHASE_LABEL[s.phase] ?? s.phase)}</td>` +
        `<td class="jersey"><span class="code">${s.side === 'def' ? 'DEFENSE' : 'OFFENSE'}</span> <span class="era">${esc(s.rarity)}</span></td>` +
        `<td class="fileid">${esc(s.id)}${placeholders.has(s.id) ? ' <span class="era">placeholder art</span>' : ''}</td></tr>`;
    });
}

// ── The Live Series (2026-10-28) ────────────────────────────────────────────
//
// The Live Series' additions — rookies, the returning and the short seasons of
// card-data/live-rookies.json, with no base card — are carded by the nightly
// job once they have numbers, and one with no photo yet wears the placeholder
// face (the user, 2026-10-28: "Placeholder photos are fine"). So the ones with
// none are owed one like any card. And a rookie whose photo is from college or an
// overseas club is flagged in the 2026-27 folder's _flags.json, kind 'college'
// (the user: "add to the photo hunt rookies who have college pictures but not
// pics with their NBA teams"); a photo newer than its flag is the replacement,
// and the row goes. Their photos live in the base set's folder, as every Live
// card's does.
const LIVE_FILE = path.join(ROOT, 'card-data', 'live-rookies.json');
const LIVE_PHOTOS = '2026-27';

function liveAdditions() {
  if (!fs.existsSync(LIVE_FILE)) return [];
  const body = JSON.parse(fs.readFileSync(LIVE_FILE, 'utf8'));
  const out = new Set((body.leftOut ?? []).map(x => x?.id ?? x));
  const of = (list, kind) => (list ?? []).filter(a => a?.id && !out.has(a.id)).map(a => ({
    id: a.id, name: a.name, team: a.team, kind,
    // Searched as the Studio searches them (players.js): this season's, a rookie as one.
    seasonLabel: '2026-27', searchYear: '2026', liveRookie: kind === 'rookie',
  }));
  return [...of(body.rookies, 'rookie'), ...of(body.returning, 'returning'), ...of(body.shortSeason, 'short season')];
}

const KIND_LABEL = { rookie: 'Rookie', returning: 'Returning', 'short season': 'Short season' };

function liveRow(prefix, card, note) {
  const t = huntTarget('live', card);
  return `<tr data-k="${esc(prefix)}/${esc(card.id)}">` +
    `<td class="pick"><button class="tick" aria-label="done"></button></td>` +
    `<td class="who"><a href="${esc(t.url)}" target="_blank" rel="noopener">${esc(card.name)}</a></td>` +
    `<td class="season">${esc(KIND_LABEL[card.kind] ?? card.kind)}</td>` +
    `<td class="jersey"><span class="code">${esc(t.code)}</span> <span class="era">${esc(note)}</span></td>` +
    `<td class="fileid">${esc(card.id)}</td></tr>`;
}

/** Additions with no photo: out of the set until they have one. */
function liveMissingRows() {
  const have = photoIds(LIVE_PHOTOS);
  return liveAdditions().filter(c => !have.has(c.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => liveRow('live', c, 'placeholder face until it has a photo'));
}

/** The modified time of a card's photo in a folder, or null. */
function photoTime(set, id) {
  const dir = path.join(ROOT, 'card-art', 'sets', set, 'photos');
  if (!fs.existsSync(dir)) return null;
  const f = fs.readdirSync(dir).find(x => x.replace(/\.[^.]+$/, '') === id && IMAGE_EXTENSIONS.includes(path.extname(x).toLowerCase()));
  return f ? fs.statSync(path.join(dir, f)).mtimeMs : null;
}

/** Additions whose photo is flagged as not in their NBA uniform, until a newer one lands. */
function liveReplaceRows() {
  const file = path.join(ROOT, 'card-art', 'sets', LIVE_PHOTOS, 'photos', '_flags.json');
  const flags = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return liveAdditions()
    .filter(c => flags[c.id]?.kind === 'college' && !(photoTime(LIVE_PHOTOS, c.id) > flags[c.id].at))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => liveRow('live-replace', c, flags[c.id].note ?? 'not in an NBA uniform'));
}

const PLAYER_HEADS = ['', 'Player (click = tuned image search)', 'Season', 'Jersey', 'Save as (any ext)'];
const STRAT_HEADS = ['', 'Card (click = image search for the idea)', 'Phase', 'Side · rarity', 'Save as (any ext)'];

const sections = [
  ...SECTIONS.map(([id, label, league]) => ({ id, label, league, heads: PLAYER_HEADS, rows: rowsFor(id, league) })),
  { id: 'live', label: 'Live Series additions — no photo yet', league: 'NBA', heads: PLAYER_HEADS, rows: liveMissingRows() },
  { id: 'live-replace', label: 'Live Series rookies — wanted in their NBA uniform', league: 'NBA', heads: PLAYER_HEADS, rows: liveReplaceRows() },
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
