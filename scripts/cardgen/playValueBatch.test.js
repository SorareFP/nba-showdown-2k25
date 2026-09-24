// A CARD'S PRICE IS ITS OWN (2026-09-24). Priced against the base field, a
// card must cost the same whether it is priced alone or inside a batch — the
// Super Season re-pick compares seasons built in different batches, and the
// team term used to average over the batch (Maya Moore 2016: $1,410 in the
// requests file, ~$1,440 alone).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { priceAgainstBase, samePlayer } from './playValue.js';
import * as A from './attributes.js';
import { REPO_ROOT } from './cache.js';

const OPTS = { roundSalary: A.roundSalary, min: A.SALARY_MIN, max: A.SALARY_MAX };
const load = f => {
  const b = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'card-data', 'generated', f), 'utf8'));
  return Array.isArray(b) ? b : b.cards;
};

describe('priceAgainstBase', () => {
  it('prices a card the same alone as inside its set', () => {
    const set = load('cards-wnba-super-season.json').slice(0, 12).map(c => structuredClone(c));
    const inBatch = set.map(c => structuredClone(c));
    priceAgainstBase(inBatch, OPTS);
    for (let i = 0; i < set.length; i += 3) {
      const alone = [structuredClone(set[i])];
      priceAgainstBase(alone, OPTS);
      expect(alone[0].salary, set[i].name).toBe(inBatch[i].salary);
    }
  });

  it('treats a season-suffixed id as the same player', () => {
    expect(samePlayer({ id: 'Maya_Moore' }, { id: 'Maya_Moore_2016' })).toBe(true);
    expect(samePlayer({ id: 'Gary_Payton' }, { id: 'Gary_Payton_II' })).toBe(false);
  });
});
