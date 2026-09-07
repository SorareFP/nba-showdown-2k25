/**
 * SET COMPLETION REWARDS — the capstone for finishing a special set.
 *
 *   node scripts/cardgen/generateSetRewards.js
 *
 * Reads card-data/set-rewards-2026.json: per goal, the cards built for that
 * group (they all live in the home set) and, among them, the STRONGEST BY
 * SALARY is MOVED into `set-rewards` (NBA) or `wnba-set-rewards` (WNBA) —
 * exactly as generateTeamRewards.js moves a card: same numbers, same season,
 * same era mark, same art; `set` changes, the origin set's badge joins
 * `badges` under the SET REWARD pill, and `rewardGoal` says which goal earns
 * it. cardSets.js filters a moved card out of its home set by `migratedFrom`,
 * so the set is completable without it and the reward is never a duplicate.
 *
 * Why salary decides: the user's instruction was "make the top player the
 * reward", and salary is the game's own single number for how good a card is.
 * Run this AFTER the home sets, every time they change — a re-priced set can
 * change which card is on top, and a stale reward file would hold a card the
 * home set has since re-issued.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const PICKS_FILE = path.join(REPO_ROOT, 'card-data', 'set-rewards-2026.json');
export const OUTPUT_FILES = {
  NBA: path.join(GEN_DIR, 'cards-set-rewards.json'),
  WNBA: path.join(GEN_DIR, 'cards-wnba-set-rewards.json'),
};

/** The badge a moved card carries in from its home set. */
export const ORIGIN_BADGE = {
  'super-season': 'super-season',
  rookie: 'rookie',
  'summer-standouts': 'summer-standout',
  dissonance: 'dissonance',
  'wnba-super-season': 'super-season',
  'wnba-rookie': 'rookie',
};

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const leagueOf = set => (set.startsWith('wnba') ? 'WNBA' : 'NBA');

/** Pick the strongest present candidate of a group, and say who was missing. */
export function chooseReward(group, cards) {
  const byId = new Map(cards.map(c => [c.id, c]));
  const present = group.candidates.filter(id => byId.has(id));
  const missing = group.candidates.filter(id => !byId.has(id));
  const best = present
    .map(id => byId.get(id))
    .sort((a, b) => (b.salary ?? 0) - (a.salary ?? 0) || group.candidates.indexOf(a.id) - group.candidates.indexOf(b.id))[0] ?? null;
  return { best, present, missing };
}

export function moveCard(source, { set, goal }) {
  const badge = ORIGIN_BADGE[set];
  if (!badge) throw new Error(`No origin badge declared for set ${set}.`);
  return {
    ...source,
    set: leagueOf(set) === 'WNBA' ? 'wnba-set-rewards' : 'set-rewards',
    badges: [...new Set([...(source.badges ?? []), badge])],
    migratedFrom: { set, id: source.id },
    rewardGoal: goal,
  };
}

export function main({ log = console.log } = {}) {
  const picks = readJson(PICKS_FILE);
  const out = { NBA: [], WNBA: [] };
  const report = [];
  for (const [goal, group] of Object.entries(picks.groups ?? {})) {
    const file = path.join(GEN_DIR, `cards-${group.set}.json`);
    if (!fs.existsSync(file)) throw new Error(`${goal}: ${file} does not exist — build ${group.set} first.`);
    const cards = readJson(file).cards;
    const { best, present, missing } = chooseReward(group, cards);
    if (!best) throw new Error(`${goal}: none of ${group.candidates.join(', ')} is in ${group.set}.`);
    out[leagueOf(group.set)].push(moveCard(best, { set: group.set, goal }));
    report.push(
      `  ${goal.padEnd(24)} ${best.name} ${best.seasonLabel ?? best.season} $${best.salary}` +
      ` (of ${present.length} present${missing.length ? `; missing: ${missing.join(', ')}` : ''})`
    );
  }
  // ONE PLAYER, TWO SEASONS, ONE SET: a card id is the player, so two rewards
  // of the same player in the same reward set would share a key (Westbrook's
  // 2016-17 Super Season and his 2019-20 Rockets stint, on the first run).
  // Colliding rewards take a season-qualified id; everything downstream — the
  // collection key, the face path, the hunt row, the art migration — reads
  // the card's own id, and `migratedFrom.id` still names the home card.
  for (const list of Object.values(out)) {
    const count = new Map();
    for (const c of list) count.set(c.id, (count.get(c.id) ?? 0) + 1);
    for (const c of list) if (count.get(c.id) > 1) c.id = `${c.id}_${c.season}`;
  }
  for (const [league, file] of Object.entries(OUTPUT_FILES)) {
    const payload = {
      generatedAt: new Date().toISOString(),
      set: league === 'WNBA' ? 'wnba-set-rewards' : 'set-rewards',
      note:
        'SET COMPLETION REWARDS — cards MOVED out of their home special set (see migratedFrom) ' +
        'and earned by completing that set (rewardGoal). Built by scripts/cardgen/generateSetRewards.js ' +
        'from card-data/set-rewards-2026.json; the strongest card by salary of each group is the reward.',
      cards: out[league],
    };
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 1)}\n`);
  }
  log('Set rewards:');
  for (const line of report) log(line);
  log(`Wrote:\n  ${OUTPUT_FILES.NBA}\n  ${OUTPUT_FILES.WNBA}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
