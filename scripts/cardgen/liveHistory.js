// THE LIVE SERIES' HISTORY — card-data/generated/live-history.json.
//
// The user (2026-10-28): "a live series dashboard that shows how players' card
// details have changed over time … 'latest changes,' 7-21 day windows, since
// start of season." cards-live.json is rewritten every night, so what a card
// was last week lives only in the bot's commits, which the app cannot read.
// So the nightly job (generateLive.js) also keeps this file: every Live card's
// numbers on every night, and its chart on the nights a window can open on —
// the 21-day window's and each card's first. The app reads it in the Live
// Series view of Collection (src/game/liveMoves.js, LiveMovers.jsx).
//
// It FILLS ITSELF FROM GIT. Before recording tonight, the job records any of
// the bot's nightly commits the file has no night for — the checkout has the
// whole history (live-series.yml fetches it) — so the nights before this file
// existed are in it, and a night the file missed (a deploy that kept an older
// copy, a run that failed after its commit) comes back on the next run.
//
//   { set, note, fields, nights: ['2026-10-22', …],
//     players: { <id>: { rows: [[salary, speed, …] | null per night], charts: { <night>: [[lo, hi, pts, reb, ast], …] } } } }
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT } from './cache.js';
import { anchorIndex } from '../../src/game/liveWindows.js';

export const HISTORY_FILE = path.join(REPO_ROOT, 'card-data', 'generated', 'live-history.json');
const LIVE_FILE_PATH = 'card-data/generated/cards-live.json';

/** A night's numbers per card, in this order. */
export const HISTORY_FIELDS = ['salary', 'speed', 'power', 'shotLine', 'paintBoost', 'threePtBoost', 'defBoost', 'games'];

/** The widest day window: charts are kept back to where it opens. */
const CHART_WINDOW = '21';

export const emptyHistory = () => ({
  set: 'live',
  note: 'The Live Series night by night (scripts/cardgen/liveHistory.js): every card\'s numbers each night, '
    + 'its chart on the nights a window can open on. Written by the nightly job; read by the Live Series view.',
  fields: HISTORY_FIELDS,
  nights: [],
  players: {},
});

export const snapshotOf = card => HISTORY_FIELDS.map(f => (f === 'games' ? (card.live?.games?.real ?? 0) : (card[f] ?? null)));
const packChart = chart => (chart ?? []).map(t => [t.lo, t.hi, t.pts, t.reb, t.ast]);

/** Open a slot for a night at `at` in every card's rows and charts. */
function insertNight(history, at, date) {
  const nights = [...history.nights];
  nights.splice(at, 0, date);
  const players = Object.fromEntries(Object.entries(history.players).map(([id, p]) => {
    const rows = [...p.rows];
    while (rows.length < history.nights.length) rows.push(null);
    rows.splice(at, 0, null);
    const charts = Object.fromEntries(Object.entries(p.charts ?? {}).map(([k, v]) => [Number(k) >= at ? Number(k) + 1 : Number(k), v]));
    return [id, { rows, charts }];
  }));
  return { ...history, nights, players };
}

/**
 * Record one night's cards. A date already recorded is replaced (a second run
 * the same day); an older date is slotted in where it belongs. A card missing
 * that night gets a gap; a card new that night starts there.
 */
export function recordNight(history, { date, cards }) {
  let h = history;
  let at = h.nights.indexOf(date);
  if (at < 0) {
    at = h.nights.findIndex(d => d > date);
    if (at < 0) at = h.nights.length;
    h = insertNight(h, at, date);
  }
  const length = h.nights.length;
  const players = { ...h.players };
  const seen = new Set();
  for (const card of cards) {
    seen.add(card.id);
    const p = players[card.id] ?? { rows: [], charts: {} };
    const rows = [...p.rows];
    while (rows.length < length) rows.push(null);
    rows[at] = snapshotOf(card);
    players[card.id] = { rows, charts: { ...p.charts, [at]: packChart(card.chart) } };
  }
  for (const [id, p] of Object.entries(players)) {
    if (seen.has(id)) continue;
    const rows = [...p.rows];
    while (rows.length < length) rows.push(null);
    rows[at] = null;
    const charts = { ...p.charts };
    delete charts[at];
    players[id] = { rows, charts };
  }
  return { ...h, players };
}

/** Drop the charts no window can open on: before the 21-day window, except each card's first. */
export function pruneCharts(history) {
  const from = anchorIndex(history.nights, CHART_WINDOW);
  const players = Object.fromEntries(Object.entries(history.players).map(([id, p]) => {
    const nights = Object.keys(p.charts ?? {}).map(Number).sort((a, b) => a - b);
    const first = nights[0];
    const charts = Object.fromEntries(nights.filter(n => n === first || n >= from).map(n => [n, p.charts[n]]));
    return [id, { ...p, charts }];
  }));
  return { ...history, players };
}

const BOT_SUBJECT = /^chore\(live\): the Live Series as of (\d{4}-\d{2}-\d{2})/;

/** The bot's nightly commits from `git log --format=%H%x09%s`, oldest first. */
export function parseBotCommits(log) {
  return String(log ?? '').split('\n')
    .map(line => line.split('\t'))
    .map(([sha, subject]) => ({ sha, date: BOT_SUBJECT.exec(subject ?? '')?.[1] }))
    .filter(c => c.sha && c.date)
    .reverse();
}

function gitCommits(cwd) {
  const log = execFileSync('git', ['log', '--format=%H%x09%s', '--', LIVE_FILE_PATH], { cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  return parseBotCommits(log);
}

function gitShow(cwd) {
  return sha => JSON.parse(execFileSync('git', ['show', `${sha}:${LIVE_FILE_PATH}`], { cwd, encoding: 'utf8', maxBuffer: 1 << 28 }));
}

/**
 * Record the bot's nights the history has none for. A commit's subject names
 * its night; the night recorded is its build's own date (live.asOf). A mirror
 * build (before the season) is not a night of the season.
 */
export function fillFromGit(history, { cwd = REPO_ROOT, commits = null, show = null } = {}) {
  const list = commits ?? gitCommits(cwd);
  const read = show ?? gitShow(cwd);
  let h = history;
  const added = [];
  for (const { sha, date } of list) {
    if (h.nights.includes(date)) continue;
    const body = read(sha);
    if (body?.live?.mode !== 'season') continue;
    const night = String(body.live.asOf ?? date).slice(0, 10);
    if (h.nights.includes(night)) continue;
    h = recordNight(h, { date: night, cards: body.cards ?? [] });
    added.push(night);
  }
  return { history: h, added };
}

export function readHistory(file = HISTORY_FILE) {
  if (!fs.existsSync(file)) return emptyHistory();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** A card to a line, so a night's diff reads card by card. */
export function serializeHistory(history) {
  const { players, ...head } = history;
  const lines = Object.keys(players).sort().map(id => `${JSON.stringify(id)}:${JSON.stringify(players[id])}`);
  const top = JSON.stringify(head).slice(0, -1);
  return `${top},"players":{\n${lines.join(',\n')}\n}}\n`;
}

/** Tonight's update: the missing nights from git, tonight, the charts trimmed. */
export function updateHistory({ file = HISTORY_FILE, date, cards, cwd = REPO_ROOT, log = console.log }) {
  let history = readHistory(file);
  try {
    const filled = fillFromGit(history, { cwd });
    history = filled.history;
    if (filled.added.length) log(`  history: filled ${filled.added.length} night(s) from git (${filled.added.join(', ')})`);
  } catch (e) {
    log(`  history: could not read git (${e.message.split('\n')[0]}); recording tonight only`);
  }
  history = pruneCharts(recordNight(history, { date, cards }));
  fs.writeFileSync(file, serializeHistory(history));
  log(`  history: ${history.nights.length} night(s), ${history.nights[0]} to ${history.nights.at(-1)}`);
  return history;
}

// node scripts/cardgen/liveHistory.js — the nights from git alone, nothing built.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { history, added } = fillFromGit(readHistory());
  fs.writeFileSync(HISTORY_FILE, serializeHistory(pruneCharts(history)));
  console.log(`live-history.json: ${history.nights.length} night(s); filled ${added.length} from git (${added.join(', ') || 'none'})`);
}
