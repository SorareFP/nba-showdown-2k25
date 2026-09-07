// The WNBA sets sit BELOW the NBA scale, on purpose.
//
// The user (2026-09-06): "Some of these WNBA cards are still so overpowered.
// The speed and power numbers still need major rebalancing relative to the
// NBA cards." The rule that answers it lives in constants.js
// (WNBA_LEAGUE_FACTOR) and wnbaSize.js (capToNbaMaxima); this checks the
// GENERATED sets, so a regeneration that forgot either fails here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../cache.js';
import { NBA_SPEED_MAX, NBA_POWER_MAX } from './wnbaSize.js';
import { WNBA_LEAGUE_FACTOR } from './constants.js';

const GEN = path.join(REPO_ROOT, 'card-data', 'generated');
const read = f => {
  const p = path.join(GEN, f);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')).cards ?? [] : [];
};
const WNBA = ['cards-wnba.json', 'cards-wnba-super-season.json', 'cards-wnba-rookie.json', 'cards-wnba-team-rewards.json', 'cards-wnba-set-rewards.json'];
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

describe('WNBA cards against the NBA scale', () => {
  const cards = WNBA.flatMap(f => read(f).map(c => ({ ...c, _file: f })));

  it('has the sets to check', () => {
    expect(cards.length).toBeGreaterThan(150);
  });

  it('never prints more Speed or Power than the NBA scale does', () => {
    const over = cards.filter(c => c.speed > NBA_SPEED_MAX || c.power > NBA_POWER_MAX);
    expect(over.map(c => `${c._file} ${c.name} S${c.speed} P${c.power}`)).toEqual([]);
  });

  it('tops out below an NBA MVP: the best total is the printed ceiling times the factor', () => {
    // 30 * 0.88 = 26.4 → a 26 at most, rounding at the split.
    const top = Math.max(...cards.map(c => c.speed + c.power));
    expect(top).toBeLessThanOrEqual(Math.round(30 * WNBA_LEAGUE_FACTOR));
  });

  it('puts the legends median near the NBA Super Season median, not five above it', () => {
    const legends = read('cards-wnba-super-season.json').map(c => c.speed + c.power);
    const nbaSuper = read('cards-super-season.json').map(c => c.speed + c.power);
    expect(median(legends)).toBeLessThanOrEqual(median(nbaSuper) + 2);
  });

  it('Sylvia Fowles is a strong big, not a bigger big than exists', () => {
    const fowles = cards.find(c => c.name === 'Sylvia Fowles');
    if (!fowles) return;
    expect(fowles.power).toBeLessThanOrEqual(NBA_POWER_MAX);
  });
});
