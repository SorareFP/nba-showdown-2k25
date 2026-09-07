// Price a handful of WNBA reward CANDIDATES exactly the way the rewards
// generator prices its picks — same archive, same pipeline, same base-set
// value map — so a re-pick is chosen on its real price and band, not on the
// BPM rank alone (wnbaRewardCandidates.js ranks; it cannot price).
//
//   node scripts/analysis/priceWnbaRewardCandidates.mjs ATL:Angel_McCoughtry:2013 DAL:Cindy_Brown:1998:DET ...
//
// Each argument is FRANCHISE:Name_With_Underscores:season[:TEAM]. TEAM is the
// Basketball-Reference code of the season (defaults to the franchise code) —
// Detroit seasons of the Dallas franchise are DET, Tulsa ones TUL.
//
// Written 2026-09-06 to re-pick the seven franchise rewards the league factor
// moved out of band. Read-only: nothing is written anywhere.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cardgen/cache.js';
import { normalizeName } from '../cardgen/resolveTeams.js';
import { CALIBRATION_FILE } from '../cardgen/calibrateAttributes.js';
import { getPlayerRarity } from '../../src/game/rarity.js';
import { rewardBandFor } from '../../src/game/collectionDifficulty.js';
import * as PV from '../cardgen/playValue.js';
import * as A from '../cardgen/attributes.js';
import { loadArchive, rateArchive, buildWnbaCards } from '../cardgen/wnba/generateWnbaLegends.js';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));

const asks = process.argv.slice(2).map(a => {
  const [franchise, name, season, team] = a.split(':');
  return { franchise, name: name.replace(/_/g, ' '), season: Number(season), team: (team ?? franchise).toUpperCase() };
});
if (!asks.length) { console.error('name at least one FRANCHISE:Name:season[:TEAM]'); process.exit(1); }

const calibration = readJson(CALIBRATION_FILE);
const model = readJson(path.join(GEN_DIR, 'wnba-bpm-model.json'));
const { loaded } = loadArchive();
const seasons = rateArchive(loaded, model);
const reference = seasons.get(Math.max(...seasons.keys()));

const rows = asks.map(ask => {
  const entry = seasons.get(ask.season);
  const want = normalizeName(ask.name);
  const row = (entry?.rows ?? []).find(r => normalizeName(r.name) === want && String(r.team).toUpperCase() === ask.team);
  if (!row) console.warn(`no row: ${ask.name} ${ask.season} ${ask.team}`);
  return row;
});
const keep = asks.map((ask, i) => ({ ask, row: rows[i] })).filter(x => x.row);
const cards = buildWnbaCards({
  selections: keep.map(({ ask, row }) => ({ name: ask.name, era: null, best: row })),
  seasons,
  reference,
  calibration,
});
PV.priceAgainstBase(cards, { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX });

const hasLog = (row) => fs.existsSync(path.join(REPO_ROOT, 'card-data', 'cache', `gamelog-wnba-${row.playerId}-${row.season}.json`));
console.log('franchise  band            season  card                        S   P  line   salary  rarity       in-band');
keep.forEach(({ ask, row }, i) => {
  const c = cards[i];
  const band = rewardBandFor(`wnba-team-${ask.franchise}`);
  const rarity = getPlayerRarity(c);
  const ok = band && rarity === band.band;
  console.log(
    `${ask.franchise.padEnd(10)} ${(band ? `${band.band} $${band.salary[0]}-${band.salary[1]}` : '?').padEnd(28)} ${String(ask.season).padEnd(7)} ` +
    `${(ask.name + ' ' + ask.team).padEnd(27)} ${String(c.speed).padStart(2)}  ${String(c.power).padStart(2)}  ${String(c.shotLine).padStart(2)}   $${String(c.salary).padStart(4)}  ${rarity.padEnd(12)} ${ok ? 'YES' : 'no'}${hasLog(row) ? '' : '  (no log: smoothed)'}`
  );
});
