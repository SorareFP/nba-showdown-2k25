// The set model, and the one thing it must never do: change how the two sets
// that already exist behave.
//
// `hidesEmptyRows` used to be `set === CURRENT_SET`. It is now a lookup in a
// declared list, which is a strictly more powerful rule and therefore a strictly
// better place to introduce a silent regression — the 2026-27 set losing its
// hidden row would push a sixth row into the photo frame on 350 cards, and the
// 2025-26 set gaining one would delete a real printed row from 66 finished
// cards. Both are pinned here, by set id, not by whatever the constants happen
// to hold.
import { describe, it, expect } from 'vitest';
import {
  BADGE_IDS,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  SUPER_SEASON_MIN_SALARY,
} from './badges.js';
import {
  ART_ROOT,
  CURRENT_SET,
  DEFAULT_PHOTO_EXT,
  FINISHED_SET,
  ROOKIE_SET,
  SETS,
  SET_IDS,
  SUPER_SEASON_SET,
  WNBA_SET,
  WNBA_SUPER_SEASON_SET,
  cardTreatment,
  getSet,
  hidesEmptyRows,
  isEditableSet,
  photoUrlPath,
  setBadge,
  setPaths,
  setTreatment,
  showsSeason,
} from './sets.js';

describe('the declared set list', () => {
  it('holds the six sets the studio offers', () => {
    expect(SET_IDS).toEqual([
      '2026-27', '2025-26', 'super-season', 'rookie', 'wnba', 'wnba-super-season',
    ]);
  });

  it('names the season sets in the constants everything else imports', () => {
    expect(CURRENT_SET).toBe('2026-27');
    expect(FINISHED_SET).toBe('2025-26');
    expect(SUPER_SEASON_SET).toBe('super-season');
    expect(ROOKIE_SET).toBe('rookie');
    expect(WNBA_SET).toBe('wnba');
    expect(WNBA_SUPER_SEASON_SET).toBe('wnba-super-season');
  });

  it('gives every set an id, a name and an explicit treatment', () => {
    for (const set of SETS) {
      expect(set.id, JSON.stringify(set)).toBeTruthy();
      expect(set.name).toBeTruthy();
      // `null` rather than undefined: an absent treatment must be a decision on
      // the record, not a field somebody forgot.
      expect(set).toHaveProperty('treatment');
      expect(typeof set.editable).toBe('boolean');
      expect(typeof set.hidesEmptyRows).toBe('boolean');
      expect(typeof set.showsSeason).toBe('boolean');
      // Same rule as `treatment`: null is a decision, undefined is an omission.
      expect(set, JSON.stringify(set)).toHaveProperty('badge');
      expect(set.badge === null || typeof set.badge === 'string').toBe(true);
    }
  });

  it('has no duplicate ids — they are directory names', () => {
    expect(new Set(SET_IDS).size).toBe(SET_IDS.length);
  });

  it('uses ids that are safe as a path segment', () => {
    // Every id is interpolated into card-art/sets/{id}/ and public/cards/{id}/.
    for (const id of SET_IDS) expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
  });

  it('returns null for a set it does not know, including prototype keys', () => {
    expect(getSet('nope')).toBeNull();
    expect(getSet('toString')).toBeNull();
    expect(getSet(undefined)).toBeNull();
  });
});

describe('hidesEmptyRows', () => {
  it('hides rows that pay nothing on the set being built — unchanged', () => {
    expect(hidesEmptyRows(CURRENT_SET)).toBe(true);
  });

  it('PRINTS them on the finished set, where 66 cards really have that row', () => {
    expect(hidesEmptyRows(FINISHED_SET)).toBe(false);
  });

  it('hides them on both special sets, whose charts come out of the same generator', () => {
    expect(hidesEmptyRows(SUPER_SEASON_SET)).toBe(true);
    expect(hidesEmptyRows(ROOKIE_SET)).toBe(true);
  });

  it('prints everything for an unknown set — the fail-loud default', () => {
    // An unprinted row that should have shown is invisible; an extra row
    // overflows the chart into the photo frame and trips a test.
    expect(hidesEmptyRows('who-knows')).toBe(false);
    expect(hidesEmptyRows(undefined)).toBe(false);
    expect(hidesEmptyRows('constructor')).toBe(false);
  });
});

describe('showsSeason and setBadge', () => {
  it('names the season on the two sets that cut across seasons', () => {
    expect(showsSeason(SUPER_SEASON_SET)).toBe(true);
    expect(showsSeason(ROOKIE_SET)).toBe(true);
  });

  it('leaves BOTH season sets alone', () => {
    // The base set IS this season, so a season line would be noise. The
    // finished set draws its legend cards' seasons in the hand-made art, so a
    // template-drawn one would print a second season over the top of it.
    expect(showsSeason(CURRENT_SET)).toBe(false);
    expect(showsSeason(FINISHED_SET)).toBe(false);
    expect(setBadge(CURRENT_SET)).toBeNull();
    expect(setBadge(FINISHED_SET)).toBeNull();
  });

  it('badges the two special sets with the card type, BY ID', () => {
    // An ID now, not the pill's text — the badge stopped being a set property
    // and became a card property, so the text, the colour and the priority all
    // live in src/cards/badges.js. What a set declares is which badge EVERY
    // card in it carries; a card may carry more of its own.
    expect(setBadge(SUPER_SEASON_SET)).toBe(SUPER_SEASON_BADGE);
    expect(setBadge(ROOKIE_SET)).toBe(ROOKIE_BADGE);
  });

  it('declares only badges that exist', () => {
    // The ids are strings in a data table, so nothing but this stops a typo
    // from silently rendering no pill at all on a set that asked for one.
    for (const set of SETS) {
      if (set.badge === null) continue;
      expect(BADGE_IDS, `${set.id}`).toContain(set.badge);
    }
  });

  it('leaves the base set unbadged as a SET while its cards badge themselves', () => {
    // The distinction the whole change turns on. `setBadge` says nothing about
    // whether a 2026-27 card shows a pill — 149 of them do, from their own
    // record — only whether the SET puts one on every card. It does not.
    expect(setBadge(CURRENT_SET)).toBeNull();
    expect(getSet(CURRENT_SET).badge).toBeNull();
  });

  it('says no for an unknown set rather than throwing', () => {
    expect(showsSeason('who-knows')).toBe(false);
    expect(showsSeason(undefined)).toBe(false);
    expect(setBadge('who-knows')).toBeNull();
    expect(setBadge('constructor')).toBeNull();
  });
});

describe('setTreatment', () => {
  it('leaves both season sets untreated, so they render as they always did', () => {
    expect(setTreatment(CURRENT_SET)).toBeNull();
    expect(setTreatment(FINISHED_SET)).toBeNull();
  });

  it('treats the two special sets', () => {
    expect(setTreatment(SUPER_SEASON_SET)).toBe('gold-foil');
    expect(setTreatment(ROOKIE_SET)).toBe('green-accent');
  });

  it('returns null for an unknown set rather than throwing', () => {
    expect(setTreatment('nope')).toBeNull();
  });
});

describe('cardTreatment', () => {
  // A set declares its treatment for the TIER it declares its badge for, and a
  // card demoted out of that tier does not get it. `setTreatment` still answers
  // the set-level question and is unchanged; this is the card-level refinement
  // of it. See `tierBadge` in badges.js for the comparison both halves share.

  it('withholds the gold foil from a Super Season card under the salary line', () => {
    expect(cardTreatment(SUPER_SEASON_SET, SUPER_SEASON_MIN_SALARY)).toBe('gold-foil');
    expect(cardTreatment(SUPER_SEASON_SET, SUPER_SEASON_MIN_SALARY - 10)).toBeNull();
    expect(cardTreatment(SUPER_SEASON_SET, 10)).toBeNull();
    expect(cardTreatment(SUPER_SEASON_SET, 1500)).toBe('gold-foil');
  });

  it('covers the WNBA legends without naming them', () => {
    // Fifteen of the sixteen are gold. The cheapest — Tina Charles' 2016 at
    // $860 — cleared the old $700 line and does not clear the $900 one, so it
    // is now the set's one BEST SEASON card. That is the whole argument for
    // applying the rule generally arriving in practice: `cardTreatment` asks
    // the same question of every set rather than of a list of set ids, so a
    // named roster of sixteen stopped being unanimous with nothing edited.
    expect(cardTreatment(WNBA_SUPER_SEASON_SET, 1100)).toBe('gold-foil');
    expect(cardTreatment(WNBA_SUPER_SEASON_SET, 860)).toBeNull();
  });

  it('leaves the Rookie set green at every price', () => {
    // Its badge does not tier: "this was his first season" is a fact about a
    // career, not a claim a small salary can overstate. A rookie card is cheap
    // by definition and the green is not the gold.
    for (const salary of [10, 890, 900, 1500, undefined]) {
      expect(cardTreatment(ROOKIE_SET, salary), String(salary)).toBe('green-accent');
    }
  });

  it('is exactly setTreatment for every set that does not tier', () => {
    for (const set of SETS) {
      if (set.badge === SUPER_SEASON_BADGE) continue;
      for (const salary of [10, 899, 900, 1500, undefined]) {
        expect(cardTreatment(set.id, salary), `${set.id} $${salary}`)
          .toBe(setTreatment(set.id));
      }
    }
  });

  it('keeps the treatment when the salary is unknown, and answers for no set at all', () => {
    // Demotion needs evidence — see tierBadge. And an unknown set has no
    // treatment to withhold or grant.
    expect(cardTreatment(SUPER_SEASON_SET, undefined)).toBe('gold-foil');
    expect(cardTreatment(SUPER_SEASON_SET, null)).toBe('gold-foil');
    expect(cardTreatment('nope', 10)).toBeNull();
    expect(cardTreatment('constructor', 10)).toBeNull();
  });
});

describe('isEditableSet', () => {
  it('allows the three sets being curated and refuses the finished one', () => {
    expect(isEditableSet(CURRENT_SET)).toBe(true);
    expect(isEditableSet(SUPER_SEASON_SET)).toBe(true);
    expect(isEditableSet(ROOKIE_SET)).toBe(true);
    expect(isEditableSet(FINISHED_SET)).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    // The server's photo route calls this before writing, so "unknown means no"
    // is load-bearing rather than tidy.
    expect(isEditableSet('nope')).toBe(false);
    expect(isEditableSet(undefined)).toBe(false);
  });
});

describe('every set owns a separate directory', () => {
  it('scopes photos, crops, team colours and exports by set id', () => {
    const seen = new Set();
    for (const id of SET_IDS) {
      const paths = setPaths(id);
      expect(paths.root).toBe(`${ART_ROOT}/sets/${id}`);
      expect(paths.photos).toContain(`/${id}/`);
      expect(paths.crops).toContain(`/${id}/`);
      expect(paths.teamOverrides).toContain(`/${id}/`);
      // NEVER public/cards/players/ — that is the finished set's hand-made art.
      expect(paths.cards).toBe(`public/cards/${id}`);
      expect(paths.cards).not.toBe('public/cards/players');
      for (const p of [paths.photos, paths.crops, paths.teamOverrides, paths.cards]) {
        expect(seen.has(p), `${id} collides on ${p}`).toBe(false);
        seen.add(p);
      }
    }
  });

  it('gives the same player a different photo URL in each set', () => {
    // The id spaces overlap BY DESIGN — every set derives ids with the same
    // rule — so the set is the only thing keeping one card's art off another's.
    const urls = SET_IDS.map(id => photoUrlPath('LeBron_James', id, DEFAULT_PHOTO_EXT));
    expect(new Set(urls).size).toBe(SET_IDS.length);
    for (const url of urls) expect(url).toContain('LeBron_James.jpg');
  });
});
