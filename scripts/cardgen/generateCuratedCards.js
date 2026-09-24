// CURATED THROWBACKS — the cards the generators own in the Free Agents
// catch-all set.
//
//   node scripts/cardgen/generateCuratedCards.js
//
// Reads card-data/curated-cards-2026.json and writes every card in it into
// card-data/generated/cards-throwbacks.json, building each through the Free
// Agents builder (buildFreeAgent.mjs, write:false) — the same pipeline a
// requested Throwback takes, so a curated card and a requested one are the
// same kind of card, cut from the real game log and priced against the base.
//
// ── WHY A FILE OF ITS OWN ───────────────────────────────────────────────────
//
// The user's rule (2026-09-18): "If a card does not qualify for super season
// or rookie (or dissonance), 26-27, they should be throwbacks." When a reward
// is re-picked, the outgoing card has to land somewhere. Bradley Beal's
// 2020-21 (the Wizards reward until John Wall's 2016-17 took the goal) is
// nobody's best season and not a rookie year, so it is a Throwback — and it
// cannot go into cards-free-agents.json, because the Card Studio writes that
// file WHOLE from the Requests panel and a generator's card in it would be
// lost on the next request. So the generator owns this file, and
// src/game/cardSets.js joins it exactly as it joins the requests.
//
// ── IDEMPOTENT ──────────────────────────────────────────────────────────────
//
// A second run is byte-identical apart from generatedAt: the request-only
// fields the builder stamps (requested, requestId, builtAt) are dropped, and
// a Throwbacks id always carries its season, so nothing depends on the order
// the sets were loaded in. Runs from the cache; the builder fetches a game log
// only if it is not cached, which for a curated card it always is.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { buildFreeAgent } from './buildFreeAgent.mjs';

const GEN_DIR = path.join(REPO_ROOT, 'card-data', 'generated');
export const CURATED_FILE = path.join(REPO_ROOT, 'card-data', 'curated-cards-2026.json');
export const OUTPUT_FILE = path.join(GEN_DIR, 'cards-throwbacks.json');
export const SET_ID = 'throwbacks';

/**
 * THE WNBA SIDE HAS A FILE OF ITS OWN (2026-09-24). The value pick retires
 * WNBA Super Seasons too, and a card file is one set: the studio and the face
 * export read a set from the file whose `set` it is (scripts/studio/export.js
 * already named cards-wnba-throwbacks.json), so seventeen WNBA Throwbacks
 * folded into the NBA file were joined by the game and invisible to both.
 */
export const WNBA_SET_ID = 'wnba-throwbacks';
export const WNBA_OUTPUT_FILE = path.join(GEN_DIR, 'cards-wnba-throwbacks.json');

/** The fields that belong to a REQUEST, not to a card the generator owns. */
const REQUEST_ONLY_FIELDS = ['requested', 'requestId', 'builtAt'];

/** generateSpecialSets.js writes this (every run, even empty); it runs before this step. */
export const DEMOTED_FILE = path.join(GEN_DIR, 'demoted-super-seasons.json');

/** The WNBA Super Seasons the value pick retired (wnba/generateWnbaLegends.js, 2026-09-24). */
export const WNBA_DEMOTED_FILE = path.join(GEN_DIR, 'demoted-wnba-super-seasons.json');

export function readDemoted(file = DEMOTED_FILE) {
  if (!fs.existsSync(file)) return [];
  const { cards = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  // A demoted card keeps the Throwbacks set it names (wnba-throwbacks for a
  // WNBA season); one that names none is an NBA Throwback.
  return cards.map(c => ({ ...c, set: c.set ?? SET_ID }));
}

export function readCurated(file = CURATED_FILE) {
  if (!fs.existsSync(file)) return [];
  const { cards = [] } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return cards;
}

/** A built request's card as a curated one: same card, none of the request bookkeeping. */
export function curatedCard(card, entry) {
  const out = { ...card };
  for (const field of REQUEST_ONLY_FIELDS) delete out[field];
  // The reason it is here travels with it, the way a legend's does.
  out.curated = entry.why;
  return out;
}

export async function main({ log = console.log } = {}) {
  const entries = readCurated();
  const cards = [];
  for (const entry of entries) {
    if (entry.set !== SET_ID) {
      throw new Error(`${entry.name} ${entry.season}: curated cards are Throwbacks only, not ${entry.set}.`);
    }
    const built = await buildFreeAgent({
      bbrefId: entry.bbrefId, season: Number(entry.season), playoffs: false, set: SET_ID, write: false,
    });
    cards.push(curatedCard(built.card, entry));
    log(`  ${entry.name} ${entry.season}: ${built.cardKey} $${built.salary} ${built.rarity}` +
      (built.provisional ? ' PROVISIONAL' : '') + (built.fetchedLog ? ' (log fetched)' : ''));
  }
  // The Super Seasons the generator demoted (a Rookie card of the player's
  // out-priced them, 2026-09-22): already built, they join as they are.
  const demoted = [...readDemoted(), ...readDemoted(WNBA_DEMOTED_FILE)];
  for (const card of demoted) log(`  ${card.name} ${card.seasonLabel}: ${card.set}:${card.id} $${card.salary} (demoted Super Season)`);
  cards.push(...demoted);
  const bySalary = (a, b) => b.salary - a.salary || a.id.localeCompare(b.id);
  const nba = cards.filter(c => c.set !== WNBA_SET_ID).sort(bySalary);
  const wnba = cards.filter(c => c.set === WNBA_SET_ID).sort(bySalary);
  const body = {
    set: SET_ID,
    generatedAt: new Date().toISOString(),
    note:
      'CURATED THROWBACKS — generator-owned (scripts/cardgen/generateCuratedCards.js from ' +
      'card-data/curated-cards-2026.json, plus demoted-super-seasons.json). Retired rewards that qualify ' +
      'for no other set, and Super Seasons that are no longer a Super Season (a Rookie card of the ' +
      'player\'s out-priced them, or the value pick chose another season). ' +
      'Requested Throwbacks live in cards-free-agents.json; both join the throwbacks set in cardSets.js.',
    cards: nba,
  };
  const wnbaBody = {
    set: WNBA_SET_ID,
    generatedAt: body.generatedAt,
    note:
      'WNBA THROWBACKS — generator-owned (scripts/cardgen/generateCuratedCards.js from ' +
      'demoted-wnba-super-seasons.json): WNBA Super Seasons the value pick retired. Requested WNBA ' +
      'Throwbacks live in cards-free-agents.json; both join the wnba-throwbacks set in cardSets.js.',
    cards: wnba,
  };
  fs.mkdirSync(GEN_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${JSON.stringify(body, null, 1)}\n`);
  // Written even when empty: the game imports it.
  fs.writeFileSync(WNBA_OUTPUT_FILE, `${JSON.stringify(wnbaBody, null, 1)}\n`);
  log(`Curated throwbacks: ${nba.length} NBA, ${wnba.length} WNBA card(s).\n  ${OUTPUT_FILE}\n  ${WNBA_OUTPUT_FILE}`);
  return body;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
