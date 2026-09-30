// A HIGHER ROW IS NEVER WORSE, on every card that ships (the user, 2026-09-30,
// on De'Anthony Melton's 16-19: 3/1/0 over 20+: 3/0/0 and Pascal Siakam's
// 16-20: 3/1/1 over 21+: 3/1/0 — "if I were playing him, I'd consider putting
// my absolute worst defender on him to try to get him above having an
// assist"). Every roll bonus has to be good news, so no row may be worth less
// than the row below it, at the exchange generate.js prices rows with.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rowValue } from './generate.js';

const GEN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'card-data', 'generated');
const files = fs.readdirSync(GEN).filter(f => /^cards-.*\.json$/.test(f));

describe('every chart climbs', () => {
  it('reads every committed set', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    it(`${file}: no row is worth less than the row below it`, () => {
      const data = JSON.parse(fs.readFileSync(path.join(GEN, file), 'utf8'));
      const cards = Array.isArray(data) ? data : data.cards ?? [];
      const bad = [];
      for (const card of cards) {
        const chart = card.chart ?? [];
        for (let i = 1; i < chart.length; i += 1) {
          if (rowValue(chart[i]) < rowValue(chart[i - 1]) - 1e-9) {
            const row = t => `${t.lo}-${t.hi}: ${t.pts}/${t.reb}/${t.ast}`;
            bad.push(`${card.name} ${row(chart[i - 1])} then ${row(chart[i])}`);
            break;
          }
        }
      }
      expect(bad).toEqual([]);
    });
  }
});
