// AWARDS ENTERED BY HAND: a winner the voting page does not list yet (the
// user, 2026-10-01, minutes after Angel Reese's DPOY was announced).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { mergeManualAwards, readManualAwards, MANUAL_AWARDS_FILE, OUTPUT_FILE } from './generateWnbaAwards.js';

const REESE = { playerId: 'reesean01w', name: 'Angel Reese' };
const MILES = { playerId: 'milesol01w', name: 'Olivia Miles' };

describe('mergeManualAwards', () => {
  it('adds a hand-entered winner the page does not list, and keeps the page\'s own', () => {
    const { winners, notes } = mergeManualAwards({ ROY: MILES }, { DPOY: REESE });
    expect(winners).toEqual({ ROY: MILES, DPOY: REESE });
    expect(notes).toEqual(['manual DPOY: Angel Reese (not on the voting page yet)']);
  });

  it('says so when the page has caught up, and changes nothing', () => {
    const { winners, notes } = mergeManualAwards({ DPOY: REESE }, { DPOY: REESE });
    expect(winners).toEqual({ DPOY: REESE });
    expect(notes[0]).toContain('agrees now');
  });

  it('the page wins a disagreement, out loud', () => {
    const { winners, notes } = mergeManualAwards({ DPOY: MILES }, { DPOY: REESE });
    expect(winners.DPOY).toEqual(MILES);
    expect(notes[0]).toContain('the page wins');
  });

  it('skips a code it does not read and an entry with no id', () => {
    const { winners, notes } = mergeManualAwards({}, { CHAMP: REESE, MVP: { name: 'Nobody' } });
    expect(winners).toEqual({});
    expect(notes).toHaveLength(2);
  });

  it('does not mutate the page\'s winners', () => {
    const page = { ROY: MILES };
    mergeManualAwards(page, { DPOY: REESE });
    expect(page).toEqual({ ROY: MILES });
  });
});

describe('the committed hand-entered awards', () => {
  const manual = readManualAwards();

  it('is seasons of code -> { playerId, name }, with the comment left out', () => {
    expect(fs.existsSync(MANUAL_AWARDS_FILE)).toBe(true);
    expect(manual._comment).toBeUndefined();
    for (const [season, byCode] of Object.entries(manual)) {
      expect(Number.isInteger(Number(season))).toBe(true);
      for (const entry of Object.values(byCode)) {
        expect(entry.playerId).toMatch(/^[a-z]+\d\dw$/);
        expect(typeof entry.name).toBe('string');
      }
    }
  });

  it('every entry reached a card: the generated marks carry it', () => {
    const marks = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf8')).sets;
    const all = Object.values(marks).flat();
    for (const [season, byCode] of Object.entries(manual)) {
      for (const [code, entry] of Object.entries(byCode)) {
        const hit = all.find(r => r.bbrefId === entry.playerId && r.season === Number(season));
        expect(hit, `${entry.name} ${season} ${code}`).toBeTruthy();
        expect(hit.awards).toContain(code);
      }
    }
  });
});
