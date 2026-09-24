// DORMANT THROWBACKS — the generator-owned Throwbacks with no photo.
//
//   node scripts/studio/dormantThrowbacks.mjs
//
// The user (2026-09-24), after the Super Season value pick left dozens of
// retired seasons to photograph: "The throwbacks that are vacated and remain
// without a photo after that move can just be hidden from packs and not occur
// until someone asks for them via free agents. This is just too many new
// photos to find." And: "Throwbacks WITHOUT photos should stay dormant."
//
// Writes card-data/generated/dormant-throwbacks.json: the keys of every card in
// cards-throwbacks.json and cards-wnba-throwbacks.json (the retired seasons and
// the curated throwbacks, both the generators') that has no photo at
// card-art/sets/<set>/photos/<id>.<any ext>. src/game/cardSets.js keeps those
// out of every set, pack and list — still resolvable by key, so a copy anyone
// already holds keeps its face — and because they are not in CARD_SETS the
// quote index offers their seasons to Free Agents like any uncarded season.
//
// NOT DORMANT, whatever their photos: a requested card (cards-free-agents.json;
// someone asked for it, and a request for a dormant season builds under the
// same key, which then wins) and a card that moved into a reward (its photo
// lives with the reward).
//
// A photo only counts once it is on disk, and the list is committed data, so
// run this after the art moves (superSeasonArt.py --apply calls it) and after
// an export (export.js calls it): drop a photo on a dormant Throwback in the
// studio, export its face, and it is back in the packs on the next deploy.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const GEN = path.join(ROOT, 'card-data', 'generated');
export const DORMANT_FILE = path.join(GEN, 'dormant-throwbacks.json');
const THROWBACK_FILES = ['cards-throwbacks.json', 'cards-wnba-throwbacks.json'];
const REWARD_FILES = ['cards-team-rewards.json', 'cards-set-rewards.json', 'cards-wnba-team-rewards.json', 'cards-wnba-set-rewards.json'];

const readCards = file => {
  const p = path.join(GEN, file);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).cards ?? [] : [];
};

/** File stems in a set's photos folder. */
function photoStems(root, set) {
  const dir = path.join(root, 'card-art', 'sets', set, 'photos');
  if (!fs.existsSync(dir)) return new Set();
  return new Set(fs.readdirSync(dir).filter(f => !f.startsWith('_') && !f.endsWith('.json')).map(f => f.replace(/\.[^.]+$/, '')));
}

/** The dormant keys, sorted: generator-owned Throwbacks with no photo. */
export function dormantKeys(root = ROOT) {
  const requested = new Set(readCards('cards-free-agents.json').map(c => `${c.set}:${c.id}`));
  const migrated = new Set(REWARD_FILES.flatMap(readCards)
    .filter(c => c.migratedFrom).map(c => `${c.migratedFrom.set}:${c.migratedFrom.id}`));
  const stems = {};
  const keys = [];
  for (const file of THROWBACK_FILES) {
    for (const card of readCards(file)) {
      const key = `${card.set}:${card.id}`;
      if (requested.has(key) || migrated.has(key)) continue;
      stems[card.set] ??= photoStems(root, card.set);
      if (!stems[card.set].has(card.id)) keys.push(key);
    }
  }
  return keys.sort();
}

export function writeDormant({ root = ROOT, log = console.log } = {}) {
  const keys = dormantKeys(root);
  const body = {
    note: 'DORMANT THROWBACKS — generator-owned Throwbacks with no photo, kept out of every set, pack and ' +
      'list by src/game/cardSets.js and offered to Free Agents requests instead. Written by ' +
      'scripts/studio/dormantThrowbacks.mjs; a photo plus an export brings a card back.',
    count: keys.length,
    keys,
  };
  fs.writeFileSync(DORMANT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  log(`dormant throwbacks: ${keys.length}`);
  return keys;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeDormant();
}
