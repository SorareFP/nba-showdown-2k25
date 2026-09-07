// A traded player's card wears the LAST team he played for that season.
//
// The user's rule (2026-09-06): "make sure that the player winds up on the LAST
// team they played for -- like De'Andre Hunter 2024-25 ended up with the Cavs."
// Until then the jersey was the most-minutes stint and nine cards were wrong.
// This is the sweep that found them, kept: every generated card on a season
// with several stints is checked against the last stint in the full
// Basketball-Reference table, which lists stints in the order they were played.
//
// Dissonance is NOT swept: that set is curated and the odd jersey is the point
// (Rasheed Wallace's single game as a Hawk IS the card).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './cache.js';
import { TEAM_ALIASES } from '../../src/cards/teams.js';
import { isAggregateTeam } from './fetchHistory.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const CACHE = path.join(REPO_ROOT, 'card-data', 'cache');
const SWEPT = ['cards-super-season', 'cards-rookie', 'cards-summer-standouts', 'cards-team-rewards', 'cards-set-rewards'];
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');

function fullTable(season) {
  const p = path.join(CACHE, `bbref-${season}-advanced-full.json`);
  if (!fs.existsSync(p)) return null;
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return raw.data ?? raw;
}

function splitSeasons() {
  const out = [];
  for (const file of SWEPT) {
    const p = path.join(GEN, `${file}.json`);
    if (!fs.existsSync(p)) continue;
    for (const card of JSON.parse(fs.readFileSync(p, 'utf8')).cards ?? []) {
      const table = fullTable(card.season);
      if (!table) continue;
      const stints = table.filter(r => norm(r.name) === norm(card.name) && !isAggregateTeam(r.team));
      if (stints.length < 2) continue;
      const last = stints[stints.length - 1].team;
      out.push({ file, name: card.name, season: card.season, team: String(card.team), last, want: TEAM_ALIASES[last] ?? last });
    }
  }
  return out;
}

describe('a traded season wears the last team', () => {
  const rows = splitSeasons();

  it('finds the split seasons at all — the sweep is not vacuous', () => {
    // Hunter 2025 (ATL → CLE) is in the Super Season set; if the tables or the
    // set ever stop lining up this fails loudly instead of passing on nothing.
    expect(rows.some(r => r.name === "De'Andre Hunter" && r.season === 2025)).toBe(true);
  });

  it('puts every one of them on the team he finished with', () => {
    // A card's team may be an ERA key ('LAC16', 'TOR96'): the franchise code is
    // its prefix, so the check is a prefix match on the app-side code.
    const wrong = rows.filter(r => !r.team.startsWith(r.want));
    expect(wrong.map(r => `${r.file} ${r.name} ${r.season}: card ${r.team}, finished ${r.last}`)).toEqual([]);
  });

  it('De\'Andre Hunter 2024-25 is a Cav', () => {
    const hunter = rows.find(r => r.name === "De'Andre Hunter" && r.season === 2025);
    expect(hunter?.team).toBe('CLE');
  });
});
