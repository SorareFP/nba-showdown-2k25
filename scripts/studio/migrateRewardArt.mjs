// Move the ART of a migrated card into the reward set, so the card keeps its face.
//
//   node scripts/studio/migrateRewardArt.mjs            # move what is stranded
//   node scripts/studio/migrateRewardArt.mjs --dry-run  # say what would move
//
// Runs over BOTH reward sets. It used to name cards-team-rewards.json alone,
// which was right when that was the only set that migrated; the WNBA set does
// now too (Becky Hammon's Super Season card is the Aces reward), and a script
// that silently covered half the migrations would strand her face.
//
// ── WHY THIS IS NEEDED AT ALL ───────────────────────────────────────────────
//
// A card's photo is addressed by SET: card-art/sets/<set>/photos/<id>.<ext>,
// with its crop in that set's crops.json. Thirty cards moved into team-rewards
// and their art did not follow, so the studio went from showing seven finished
// Summer Standouts faces to showing thirty-three NO PHOTO frames. The cards
// were right and looked broken, which is the worst of both.
//
// ── WHY IT MOVES RATHER THAN COPIES ─────────────────────────────────────────
//
// Same reason the card moves. A photo left in the old set is art for a card
// that set no longer has: the photo hunt would count it as done, the studio
// would list it under a player who is not there, and the next hand looking for
// the file would find two.
//
// Idempotent, and safe to run after any regeneration: a photo already in the
// reward set is left alone, and one that was never in the source set is not
// invented.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';

/** Every set that cards migrate INTO, and the file that records the moves. */
const REWARD_SETS = ['team-rewards', 'wnba-team-rewards', 'set-rewards', 'wnba-set-rewards'];
const rewardsFile = set => path.join(REPO_ROOT, 'card-data', 'generated', `cards-${set}.json`);
const artDir = set => path.join(REPO_ROOT, 'card-art', 'sets', set);
const photosDir = set => path.join(artDir(set), 'photos');
const cropsFile = set => path.join(artDir(set), 'crops.json');

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
const writeJson = (file, body) => fs.writeFileSync(file, `${JSON.stringify(body, null, 1)}\n`);

/** The file in `dir` whose stem is `id`, or null. */
function photoFor(dir, id) {
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).find(f => f.replace(/\.[^.]+$/, '') === id) ?? null;
}

const dryRun = process.argv.includes('--dry-run');
const sourceCrops = new Map();
let moved = 0;
let already = 0;
let none = 0;
let total = 0;

for (const rewardSet of REWARD_SETS) {
  const file = rewardsFile(rewardSet);
  if (!fs.existsSync(file)) {
    console.log(`${rewardSet}: not generated yet — skipped`);
    continue;
  }
  const cards = JSON.parse(fs.readFileSync(file, 'utf8')).cards.filter(c => c.migratedFrom);
  total += cards.length;
  if (cards.length === 0) continue;

  fs.mkdirSync(photosDir(rewardSet), { recursive: true });
  const targetCrops = readJson(cropsFile(rewardSet));
  let movedHere = 0;

  for (const card of cards) {
    const { set, id } = card.migratedFrom;
    if (photoFor(photosDir(rewardSet), card.id)) { already += 1; continue; }
    const photo = photoFor(photosDir(set), id);
    if (!photo) { none += 1; continue; }

    const from = path.join(photosDir(set), photo);
    // The card keeps its id across the move, but read it off the CARD rather
    // than assuming — a set could rename on the way in and this stays right.
    const to = path.join(photosDir(rewardSet), photo.replace(/^[^.]+/, card.id));
    console.log(
      `${dryRun ? 'would move' : 'moved'}  ${set}/${photo}  ->  ${rewardSet}/${path.basename(to)}`
    );
    if (!dryRun) fs.renameSync(from, to);
    moved += 1;
    movedHere += 1;

    // AND THE CROP WITH IT. The framing is per-card work somebody did by hand;
    // leaving it behind would re-centre every migrated face on its next render.
    if (!sourceCrops.has(set)) sourceCrops.set(set, readJson(cropsFile(set)));
    const crops = sourceCrops.get(set);
    if (crops[id]) {
      targetCrops[card.id] = crops[id];
      delete crops[id];
    }
  }
  if (!dryRun && movedHere > 0) writeJson(cropsFile(rewardSet), targetCrops);
}

if (!dryRun) for (const [set, crops] of sourceCrops) writeJson(cropsFile(set), crops);
console.log(
  `\n${moved} moved, ${already} already in a reward set, ${none} had no photo to move ` +
    `(of ${total} migrated cards).`
);
