import { describe, it, expect } from 'vitest';
import {
  THEME_FIELDS,
  normalizeHex,
  isValidHex,
  isUnambiguousHex,
  pruneTeamOverrides,
  setTeamColor,
  clearTeamColor,
  clearTeamOverride,
  hasTeamOverride,
  overriddenTeams,
} from './teamTheme.js';
import { TEAMS, getThemedTeam, resolveAccent, pickAccent } from '../cards/teams.js';

/** Denver's gold — the color the whole editor exists to let the user put back. */
const NUGGETS_GOLD = '#FEC524';

describe('THEME_FIELDS', () => {
  it('includes the accent, which has no official value to edit', () => {
    // primary and secondary depart from something; the accent is computed, so
    // an override is the only way to state it at all.
    expect(THEME_FIELDS).toEqual(['primary', 'secondary', 'accent']);
    expect(TEAMS.DEN.accent).toBeUndefined();
  });
});

describe('normalizeHex', () => {
  it('accepts a color with or without its hash, and upper-cases it', () => {
    // Both happen constantly: <input type="color"> hands back lowercase with a
    // hash, a value pasted from a spreadsheet often has neither.
    expect(normalizeHex('#fec524')).toBe('#FEC524');
    expect(normalizeHex('fec524')).toBe('#FEC524');
    expect(normalizeHex('  #FEC524  ')).toBe('#FEC524');
  });

  it('expands the three-digit shorthand', () => {
    expect(normalizeHex('#fc0')).toBe('#FFCC00');
    expect(normalizeHex('abc')).toBe('#AABBCC');
  });

  it('returns null for anything not yet a color', () => {
    // Null is the normal answer while the user is typing, not an error — it is
    // what keeps a half-typed value from repainting every card on the team.
    expect(normalizeHex('#FEC5')).toBeNull();
    expect(normalizeHex('#FEC52')).toBeNull();
    expect(normalizeHex('#GGGGGG')).toBeNull();
    expect(normalizeHex('')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
    expect(normalizeHex(undefined)).toBeNull();
  });

  it('agrees with isValidHex', () => {
    for (const v of ['#FEC524', 'fc0', '#FEC5', '', 'rgb(1,2,3)']) {
      expect(isValidHex(v), v).toBe(normalizeHex(v) !== null);
    }
  });
});

describe('isUnambiguousHex', () => {
  it('accepts six digits, which cannot grow into a different color', () => {
    expect(isUnambiguousHex('#008080')).toBe(true);
    expect(isUnambiguousHex('008080')).toBe(true);
    expect(isUnambiguousHex('  #FEC524 ')).toBe(true);
  });

  it('REJECTS the three-digit shorthand, even though it is a valid color', () => {
    // THE TYPING BUG. "#008" is #000088 and also the first four characters of
    // "#008080". Auto-committing it repaints every card on the team the wrong
    // color and — since the field then shows what was committed — overwrites
    // the half-typed text, making "#008080" impossible to type by hand.
    // Shorthand is still accepted; it just waits for Enter or blur.
    expect(isUnambiguousHex('#008')).toBe(false);
    expect(isValidHex('#008')).toBe(true);
    expect(normalizeHex('#008')).toBe('#000088');
  });

  it('rejects every prefix of a real color on the way to it', () => {
    const target = '#FEC524';
    for (let i = 1; i < target.length; i++) {
      expect(isUnambiguousHex(target.slice(0, i)), target.slice(0, i)).toBe(false);
    }
    expect(isUnambiguousHex(target)).toBe(true);
  });

  it('never accepts what normalizeHex would reject', () => {
    for (const v of ['#FEC5', 'zzz', '', null, '#FEC5240']) {
      expect(isUnambiguousHex(v), String(v)).toBe(false);
    }
  });
});

describe('setTeamColor', () => {
  it('sets one field and leaves the rest of the map alone', () => {
    const next = setTeamColor({ BOS: { primary: '#111111' } }, 'DEN', 'accent', NUGGETS_GOLD);
    expect(next).toEqual({ BOS: { primary: '#111111' }, DEN: { accent: NUGGETS_GOLD } });
  });

  it('adds to a team that already has another field overridden', () => {
    const next = setTeamColor({ DEN: { accent: NUGGETS_GOLD } }, 'DEN', 'secondary', '#862633');
    expect(next.DEN).toEqual({ accent: NUGGETS_GOLD, secondary: '#862633' });
  });

  it('canonicalizes the key on the way in', () => {
    // Editing while a Basketball-Reference-spelled player is selected must not
    // write a second, shadow "BRK" entry beside the real "BKN" one.
    expect(setTeamColor({}, 'BRK', 'primary', '#FFFFFF')).toEqual({ BKN: { primary: '#FFFFFF' } });
    expect(setTeamColor({}, 'CHO', 'primary', '#FFFFFF')).toEqual({ CHA: { primary: '#FFFFFF' } });
    expect(setTeamColor({}, 'PHO', 'primary', '#FFFFFF')).toEqual({ PHX: { primary: '#FFFFFF' } });
  });

  it('normalizes the value it stores', () => {
    expect(setTeamColor({}, 'DEN', 'accent', 'fec524').DEN.accent).toBe(NUGGETS_GOLD);
  });

  it('is a no-op for a value that is not a color yet', () => {
    // The caller passes whatever is in the text box, mid-keystroke included.
    const before = { DEN: { accent: NUGGETS_GOLD } };
    expect(setTeamColor(before, 'DEN', 'accent', '#FEC5')).toBe(before);
    expect(setTeamColor(before, 'DEN', 'accent', '')).toBe(before);
  });

  it('refuses a field that is not part of the theme', () => {
    expect(setTeamColor({}, 'DEN', 'logo', '#FFFFFF')).toEqual({});
    expect(setTeamColor({}, 'DEN', 'name', '#FFFFFF')).toEqual({});
  });

  it('does not mutate the map it was given', () => {
    const before = { DEN: { accent: NUGGETS_GOLD } };
    setTeamColor(before, 'DEN', 'primary', '#000000');
    expect(before).toEqual({ DEN: { accent: NUGGETS_GOLD } });
  });
});

describe('clearTeamColor', () => {
  it('removes one field and keeps the others', () => {
    const next = clearTeamColor({ DEN: { accent: NUGGETS_GOLD, primary: '#111111' } }, 'DEN', 'accent');
    expect(next.DEN).toEqual({ primary: '#111111' });
  });

  it('REMOVES rather than blanks, so the field goes back to being computed', () => {
    // An accent set to "" is not an accent that follows pickAccent — it is a
    // card with no accent color at all.
    const next = clearTeamColor({ DEN: { accent: NUGGETS_GOLD } }, 'DEN', 'accent');
    expect('DEN' in next).toBe(false);
    expect(resolveAccent(getThemedTeam('DEN', next))).toBe(pickAccent(TEAMS.DEN.primary, TEAMS.DEN.secondary));
  });

  it('drops the team entirely once its last field is cleared', () => {
    expect(clearTeamColor({ DEN: { accent: NUGGETS_GOLD } }, 'DEN', 'accent')).toEqual({});
  });

  it('canonicalizes the key', () => {
    expect(clearTeamColor({ BKN: { primary: '#FFFFFF' } }, 'BRK', 'primary')).toEqual({});
  });
});

describe('clearTeamOverride — reset to official', () => {
  it('REMOVES the key rather than writing the official values back into it', () => {
    // THE POINT OF THE RESET BUTTON. Writing today's official color back as an
    // override pins the team to a snapshot: correct teams.js tomorrow and this
    // team alone would keep the old value forever.
    const next = clearTeamOverride({ DEN: { accent: NUGGETS_GOLD, primary: '#111111' } }, 'DEN');
    expect(next).toEqual({});
    expect('DEN' in next).toBe(false);
    expect(next.DEN).toBeUndefined();
  });

  it('leaves every other team untouched', () => {
    const next = clearTeamOverride({ DEN: { accent: NUGGETS_GOLD }, OKC: { accent: '#FFFFFF' } }, 'DEN');
    expect(next).toEqual({ OKC: { accent: '#FFFFFF' } });
  });

  it('sends the team back to the table for every field at once', () => {
    const overridden = { DEN: { primary: '#FF0000', secondary: '#00FF00', accent: NUGGETS_GOLD } };
    expect(getThemedTeam('DEN', clearTeamOverride(overridden, 'DEN'))).toEqual(TEAMS.DEN);
  });

  it('canonicalizes the key, so resetting from a BRK player clears BKN', () => {
    expect(clearTeamOverride({ BKN: { primary: '#FFFFFF' } }, 'BRK')).toEqual({});
  });

  it('is a no-op for a team that has no override', () => {
    const before = { DEN: { accent: NUGGETS_GOLD } };
    expect(clearTeamOverride(before, 'BOS')).toBe(before);
  });
});

describe('pruneTeamOverrides', () => {
  it('drops empty entries so a fully-cleared team leaves the file', () => {
    expect(pruneTeamOverrides({ DEN: {}, OKC: { accent: NUGGETS_GOLD } })).toEqual({
      OKC: { accent: NUGGETS_GOLD },
    });
  });

  it('drops blanks, nulls and junk fields', () => {
    expect(
      pruneTeamOverrides({ DEN: { accent: '', primary: null, name: 'Nuggets', secondary: '#862633' } })
    ).toEqual({ DEN: { secondary: '#862633' } });
  });

  it('normalizes colors and canonicalizes keys on the way to disk', () => {
    expect(pruneTeamOverrides({ BRK: { primary: 'fff' } })).toEqual({ BKN: { primary: '#FFFFFF' } });
  });

  it('sorts the keys, so a one-color change is a one-line diff', () => {
    const out = pruneTeamOverrides({ OKC: { accent: '#FFFFFF' }, DEN: { accent: NUGGETS_GOLD } });
    expect(Object.keys(out)).toEqual(['DEN', 'OKC']);
  });

  it('survives an absent or malformed map', () => {
    expect(pruneTeamOverrides(undefined)).toEqual({});
    expect(pruneTeamOverrides({ DEN: 'not an object' })).toEqual({});
  });
});

describe('hasTeamOverride / overriddenTeams', () => {
  it('reports a team that departs from official, and one that does not', () => {
    const map = { DEN: { accent: NUGGETS_GOLD } };
    expect(hasTeamOverride(map, 'DEN')).toBe(true);
    expect(hasTeamOverride(map, 'BOS')).toBe(false);
    expect(hasTeamOverride({}, 'DEN')).toBe(false);
  });

  it('does not count a team whose entry is empty', () => {
    expect(hasTeamOverride({ DEN: {} }, 'DEN')).toBe(false);
    expect(hasTeamOverride({ DEN: { accent: '' } }, 'DEN')).toBe(false);
  });

  it('answers for an aliased spelling', () => {
    expect(hasTeamOverride({ BKN: { primary: '#FFFFFF' } }, 'BRK')).toBe(true);
  });

  it('lists every customised team, sorted — the "what have I changed" answer', () => {
    expect(overriddenTeams({ OKC: { accent: '#FFFFFF' }, DEN: { accent: NUGGETS_GOLD }, MEM: {} })).toEqual(
      ['DEN', 'OKC']
    );
    expect(overriddenTeams({})).toEqual([]);
  });
});

describe('the Denver round trip', () => {
  // The case the editor was built for, start to finish.
  it('gives the Nuggets their gold back and then takes the override away', () => {
    // Official and faithful: Flatirons Red, not the gold everyone pictures —
    // and too dark to read on navy, so the card falls back to cream.
    expect(TEAMS.DEN.secondary).toBe('#862633');
    const official = resolveAccent(getThemedTeam('DEN', {}));
    expect(official).toBe('#E6ECF8');

    const tuned = setTeamColor({}, 'DEN', 'accent', NUGGETS_GOLD);
    expect(resolveAccent(getThemedTeam('DEN', tuned))).toBe(NUGGETS_GOLD);
    // ...without touching the official record, or any other team.
    expect(TEAMS.DEN.secondary).toBe('#862633');
    expect(resolveAccent(getThemedTeam('BOS', tuned))).toBe(pickAccent(TEAMS.BOS.primary, TEAMS.BOS.secondary));

    const reset = clearTeamOverride(tuned, 'DEN');
    expect(reset).toEqual({});
    expect(resolveAccent(getThemedTeam('DEN', reset))).toBe(official);
  });
});
