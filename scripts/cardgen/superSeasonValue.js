// THE SUPER SEASON IS THE PLAYER'S MOST VALUABLE SEASON (2026-09-24).
//
// The user, on Maya Moore: the season she requested as a free agent (2016)
// cost more than her Super Season (2014) — "I'd like to know why the correct
// SS years were not allocated correctly." They were chosen by a box-score
// rating (z of BPM and VORP against the season's league) while a card's price
// is what its finished chart, Speed/Power and shooting are worth in THIS game;
// the two disagree whenever a season's shape (threes, defence) differs from
// its box score, and nothing compared a Super Season with the player's other
// seasons, because they were never built. The user's ruling: re-pick on value,
// and "if there is something already made that should be a super season, just
// swap it out."
//
// So the generators build EVERY eligible season of a Super Season player that
// has a real game log, in the same batch as the set, price them all on the
// base field (a price is batch-independent since 2cb684eb), and keep the most
// valuable. This module is that choice and its bookkeeping, pure where it can
// be; generateSpecialSets.js (NBA) and wnba/generateWnbaLegends.js (WNBA) wire
// it in.
//
//   eligible   the tiered floors of history.js `eligibleSeasons` — the same
//              seasons the box-score pick scored, never more
//   real log   a candidate whose chart would be synthetic is out of the
//              running (synthetic charts price ~60% high); its season is
//              listed so the log can be fetched and the next run can weigh it
//   ties       keep the declared season (the box-score pick, a legend's named
//              season, a standout)
//   losers     a season that was SHIPPED as a Super Season and is no longer
//              one becomes a Throwback (`<id>_<season>`), kept in
//              card-data/super-season-retired.json so it survives every later
//              run — no shipped card vanishes
//   swaps      a winning season that already exists as a requested (Free
//              Agents) or curated (Throwbacks) card is absorbed: the Super
//              Season card records `migratedFrom`, the old copy leaves its set
//              (cardSets hasMigratedOut) and its key aliases to the new one
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import { eligibleSeasons } from './history.js';

export const VALUE_REPICK = 'another season of the player is the stronger card — a Throwback instead';
export const RETIRED_FILE = path.join(REPO_ROOT, 'card-data', 'super-season-retired.json');

const pairKey = (id, season) => `${id}|${season}`;

/**
 * The candidate seasons for each incumbent, as selections the set's builder
 * takes.
 *
 * `careerOf(playerId)` returns the player's seasons as rows carrying at least
 * `{ season, games, minutes }`; `selectionFor(incumbent, season)` returns the
 * selection a season would be built from, or null when the tables cannot
 * build it; `exclude(playerId, season)` drops seasons that are some other
 * set's to card (the base season, the rookie season). The incumbent's own
 * season is never a candidate — it is already in the batch.
 */
export function candidateSelections(incumbents, { careerOf, selectionFor, exclude = () => false, idOf = s => s.season.playerId }) {
  const out = [];
  for (const incumbent of incumbents) {
    const id = idOf(incumbent);
    const own = incumbent.season.season;
    const career = careerOf(id) ?? [];
    if (!career.length) continue;
    const { pool } = eligibleSeasons(career);
    for (const row of pool) {
      if (row.season === own || exclude(id, row.season)) continue;
      const sel = selectionFor(incumbent, row.season);
      if (sel) out.push({ ...sel, candidateFor: id });
    }
  }
  return out;
}

/**
 * The most valuable season per player among BUILT and PRICED cards.
 *
 * `cards` are the incumbents' cards and the candidates', each carrying
 * `bbrefId`, `season`, `salary` and `provisional`. `incumbentSeason` maps a
 * player id to the declared season. A provisional candidate (no real log)
 * does not compete; it is returned in `unweighed` so the log can be fetched.
 * Returns the winners in the incumbents' order, the repicks, and the losers.
 */
/**
 * WHAT A CHALLENGER MUST BEAT THE SHIPPED SEASON BY, in dollars.
 *
 * A price moves a little on every rebuild — the pool, the shooting basis, a
 * player's own last-82 window — and with a bar of one dollar the pick moved
 * with it: the 2026-09-29 rebuild, which changed nothing but the rebounds
 * and assists on each row, re-chose fifteen Super Seasons on gaps of $0 to
 * $50 (Clint Capela 2020-21 to 2018-19 at $1,010 apiece), retiring fifteen
 * shipped cards to Throwbacks and minting fifteen that needed photos. So the
 * season that SHIPS is the holder, and a challenger takes the card only by
 * clearing it by this much. A player with no shipped Super Season is picked
 * on the plain rule; nothing owned is at stake. Zero restores the old bar.
 */
export const REPICK_MARGIN = 50;

export function pickByValue(cards, incumbentSeason, { idOf = c => c.bbrefId, holderSeason = null, margin = 0 } = {}) {
  const byPlayer = new Map();
  for (const card of cards) {
    const id = idOf(card);
    if (!byPlayer.has(id)) byPlayer.set(id, []);
    byPlayer.get(id).push(card);
  }
  const winners = new Map();
  const repicks = [];
  const losers = [];
  const unweighed = [];
  for (const [id, group] of byPlayer) {
    const own = incumbentSeason.get(id);
    const incumbent = group.find(c => c.season === own) ?? null;
    // THE HOLDER: the season shipped today when it is in the batch, else the
    // declared season. A challenger clears the holder by `margin` (see
    // REPICK_MARGIN); once one has, the rest compete on price alone.
    const held = holderSeason?.get(id);
    const shippedHolder = held != null ? group.find(c => c.season === held && !c.provisional) ?? null : null;
    const holder = shippedHolder ?? incumbent;
    const bar = shippedHolder ? margin : 0;
    let best = holder;
    for (const card of group) {
      if (card === holder) continue;
      if (card.provisional) { unweighed.push(card); continue; }
      if (!best) { best = card; continue; }
      const need = best === holder ? (holder.salary ?? 0) + bar : (best.salary ?? 0);
      if ((card.salary ?? 0) > need) best = card;
    }
    if (!best) continue;
    winners.set(id, best);
    for (const card of group) if (card !== best && !card.provisional) losers.push(card);
    if (holder && best !== holder) {
      repicks.push({
        name: best.name, bbrefId: id,
        from: { season: holder.season, salary: holder.salary },
        to: { season: best.season, salary: best.salary },
      });
    }
  }
  return { winners, repicks, losers, unweighed };
}

/** The seasons a card file SHIPS, as [bbrefId, season] pairs (Super Season or demoted Throwbacks). */
export function readShippedSeasons(file) {
  if (!fs.existsSync(file)) return [];
  const body = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (body.cards ?? []).filter(c => c.bbrefId && Number.isFinite(c.season)).map(c => [c.bbrefId, c.season]);
}

/** The seasons retired from Super Season, as `{ name, bbrefId, season, id, since, reason }`. */
export function readRetired(file = RETIRED_FILE) {
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8')).seasons ?? [];
}

export function writeRetired(seasons, file = RETIRED_FILE) {
  const sorted = [...seasons].sort((a, b) => a.name.localeCompare(b.name) || a.season - b.season);
  fs.writeFileSync(file, `${JSON.stringify({
    note: 'Seasons that were shipped as a Super Season and are no longer one (superSeasonValue.js, ' +
      '2026-09-24). Each is emitted as a Throwback (<id>_<season>) on every run, so a card someone ' +
      'may own never vanishes; a season that becomes the Super Season again leaves this list. ' +
      'Written by the generators — do not edit by hand.',
    seasons: sorted,
  }, null, 1)}\n`);
}

/**
 * The next retired list: what was retired, plus every SHIPPED season that is
 * not the player's Super Season any more, minus every season that is one now.
 * `shipped` is [id, season] pairs, `current` maps player id -> season, `names` id -> name.
 */
export function nextRetired(previous, { shipped, current, names, reason = VALUE_REPICK, today }) {
  // `shipped` is any iterable of [id, season] pairs — one player may have
  // shipped more than one season (a Super Season and an older Throwback).
  const keep = new Map(previous.map(r => [pairKey(r.bbrefId, r.season), r]));
  for (const [id, season] of shipped) {
    if (current.get(id) === season) continue;
    const k = pairKey(id, season);
    if (!keep.has(k)) keep.set(k, { name: names.get(id) ?? id, bbrefId: id, season, since: today, reason });
  }
  for (const [id, season] of current) keep.delete(pairKey(id, season));
  return [...keep.values()];
}

/**
 * The built card a winning season duplicates, if one exists in `others`
 * (requested or curated cards): `{ set, id }` for `migratedFrom`, or null.
 * Playoff runs are a different card and never match.
 */
export function absorbedCard(card, others, { idOf = c => c.bbrefId } = {}) {
  const hit = others.find(o => o && idOf(o) === idOf(card) && o.season === card.season && !o.playoffs && !o.playoffRun);
  return hit ? { set: hit.set, id: hit.id } : null;
}

/** A demoted copy of a Super Season card, under the Throwback's id and look. */
export function asThrowback(card, { set = 'throwbacks', reason = VALUE_REPICK, fromSet = 'super-season' } = {}) {
  const { notBestSeason, migratedFrom, ...rest } = card;
  void notBestSeason; void migratedFrom;
  const badges = (card.badges ?? []).filter(b => b !== 'super-season' && b !== 'best-season');
  const out = {
    ...rest,
    id: `${card.id}_${card.season}`,
    set,
    demoted: reason,
    demotedFrom: { set: fromSet, id: card.id },
  };
  if (badges.length) out.badges = badges; else delete out.badges;
  return out;
}
