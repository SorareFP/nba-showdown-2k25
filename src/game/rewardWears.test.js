// EVERY REWARD WEARS ITS IDENTITY — pinned card by card (2026-09-22).
//
// The user's rule (2026-09-18): "If a card does not qualify for super season
// or rookie (or dissonance), 26-27, they should be throwbacks. Sweep current
// cards for this." The sweep (wf_790808f7-4d6) classified all 52 reward cards
// and the user ruled on the edge cases: Summer Standouts IS an identity (the 8
// playoff runs keep it), a flagged Super Season (Stockton) wears Throwbacks,
// and a Super Season under the gold line (Portis) falls back to the bronze
// reward look. The generators stamp `wears`; cardTreatment reads it. This
// table is the sweep's verdict written down, so a generator regression —
// builtBadges' false ROOKIE on Parker was one — fails loudly, by name.
//
// RE-CUT BY THE SUPER SEASON VALUE PICK (2026-09-24). Each player's Super
// Season became the season his card prices highest, so a reward that was a
// Super Season card can now sit on a retired season (Kobe 2005-06, Turner
// 2018-19, Stockton 2001-02 — re-pointed to their Throwbacks ids, the old keys
// aliased in cardSets.js) and a built reward can now BE the Super Season
// (Giannis 2019-20, Embiid 2022-23 — migrated from it, the identity
// unchanged in kind). Stockton is no longer a flag and a ruling: his 2001-02
// is a Throwback card, and the reward wears the set it came from like any other.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, getCardByKey, cardKey } from './cardSets.js';
import { cardTreatment, setBadge, setTreatment } from '../cards/sets.js';
import { SUPER_SEASON_BADGE, SUPER_SEASON_MIN_SALARY } from '../cards/badges.js';

const REWARD_SETS = ['team-rewards', 'wnba-team-rewards', 'set-rewards', 'wnba-set-rewards'];

/** key -> the set whose look the reward wears. The whole reward roster, nothing left off. */
const WEARS = {
  // ── NBA team rewards (33): 13 built, 20 moved ────────────────────────────
  // 2019-20 (the set tier) and 2022-23 (the East tier) are their Super Seasons
  // since the value pick, so both rewards migrate from that set now.
  'team-rewards:Giannis_Antetokounmpo': 'super-season',
  'team-rewards:Joel_Embiid': 'super-season',
  'team-rewards:Stephen_Curry': 'throwbacks', // 2020-21, the West tier; his best is 2015-16 (carded)
  'team-rewards:Paul_George': 'super-season',
  'team-rewards:Kevin_Durant': 'summer-standouts', // a playoff run keeps its identity (the user's ruling)
  'team-rewards:Jamal_Murray': 'summer-standouts',
  // 2005-06, retired to a Throwback when 2008-09 took his Super Season.
  'team-rewards:Kobe_Bryant_2006': 'throwbacks',
  // 2026-09-22: his 1989-90 Rookie card out-prices the 1993-94 season, which
  // the Super Season generator demotes to a Throwback; the reward migrates from there.
  'team-rewards:David_Robinson_1994': 'throwbacks',
  'team-rewards:Blake_Griffin': 'super-season', // built; 2018-19 is his best by the rule (2.30 over 2.26)
  'team-rewards:Kevin_Garnett': 'summer-standouts',
  'team-rewards:Kyrie_Irving': 'summer-standouts',
  'team-rewards:Vince_Carter': 'throwbacks', // 1999-2000, the re-pick; his best (2000-01) and rookie year are carded
  'team-rewards:Julius_Erving': 'super-season',
  'team-rewards:John_Wall': 'super-season', // 2016-17, migrated in: "if it's a super season, make it as such"
  'team-rewards:Marc_Gasol': 'throwbacks',
  'team-rewards:Alonzo_Mourning': 'throwbacks',
  'team-rewards:Chris_Paul': 'rookie',
  'team-rewards:John_Stockton_2002': 'throwbacks', // 2001-02, a Throwback card since the value pick
  'team-rewards:Sam_Cassell': 'super-season',
  'team-rewards:Wesley_Matthews': 'super-season',
  'team-rewards:Myles_Turner_2019': 'throwbacks', // 2018-19, retired to a Throwback by the value pick
  'team-rewards:Allan_Houston': 'throwbacks',
  'team-rewards:Jameer_Nelson': 'summer-standouts',
  'team-rewards:Nic_Claxton': 'super-season', // $890 since the 2026-09-24 reprice: under the gold line, bronze
  'team-rewards:Gerald_Wallace': 'super-season', // $870 since the reprice (was $900, on the line): bronze
  'team-rewards:Bobby_Portis': 'super-season', // under the gold line: bronze with TEAM REWARD over BEST SEASON
  'team-rewards:Josh_Smith': 'throwbacks',
  'team-rewards:Steve_Nash': 'summer-standouts',
  'team-rewards:Elton_Brand': 'throwbacks', // 2002-03, the re-pick; his best (2005-06) is his Super Season card
  'team-rewards:Luol_Deng': 'throwbacks',
  'team-rewards:Mike_Bibby': 'summer-standouts',
  'team-rewards:Luis_Scola': 'throwbacks',
  'team-rewards:Jason_Kidd': 'rookie',
  // ── WNBA team rewards (13): 12 built, 1 moved ────────────────────────────
  'wnba-team-rewards:Angel_McCoughtry': 'wnba-throwbacks',
  'wnba-team-rewards:Tamika_Catchings': 'wnba-throwbacks',
  'wnba-team-rewards:Cappie_Pondexter': 'wnba-super-season',
  // 2010-11, the Lynx re-pick (2026-09-24): her 2006-07 priced legendary once
  // the salary model and the WNBA shooting scale were corrected, over the band
  // Minnesota earns. 2011 is the Lynx's first title, a Throwback season.
  'wnba-team-rewards:Seimone_Augustus': 'wnba-throwbacks',
  'wnba-team-rewards:Becky_Hammon': 'wnba-super-season',
  'wnba-team-rewards:Penny_Taylor': 'wnba-super-season',
  'wnba-team-rewards:Chamique_Holdsclaw': 'wnba-throwbacks', // 1999-2000, the Mystics re-pick (2026-09-24)
  'wnba-team-rewards:Cheryl_Ford': 'wnba-super-season',
  'wnba-team-rewards:Alysha_Clark': 'wnba-super-season',
  'wnba-team-rewards:Epiphanny_Prince': 'wnba-throwbacks',
  'wnba-team-rewards:Mwadi_Mabika': 'wnba-throwbacks',
  'wnba-team-rewards:Nykesha_Sales': 'wnba-throwbacks',
  'wnba-team-rewards:Sophia_Witherspoon': 'wnba-throwbacks',
  // ── set rewards (4 + 2), all moved ───────────────────────────────────────
  'set-rewards:Russell_Westbrook_2017': 'super-season',
  'set-rewards:Michael_Jordan': 'rookie',
  'set-rewards:Dwyane_Wade': 'summer-standouts',
  'set-rewards:Russell_Westbrook_2020': 'dissonance',
  'wnba-set-rewards:Jonquel_Jones': 'wnba-super-season',
  'wnba-set-rewards:Candice_Wiggins': 'wnba-rookie',
};

const rewards = REWARD_SETS.flatMap(set => CARD_SETS[set]);

describe('every reward wears its identity', () => {
  it('is the whole roster: 52 cards, each one in the table and nothing in the table missing', () => {
    expect(rewards).toHaveLength(52);
    expect(rewards.map(cardKey).sort()).toEqual(Object.keys(WEARS).sort());
  });

  it('wears exactly what the sweep and the user decided, by name', () => {
    const got = Object.fromEntries(rewards.map(c => [cardKey(c), c.wears]));
    expect(got).toEqual(WEARS);
  });

  it('stamps the identity badge into badges beside the field, consistently', () => {
    // The look reads `wears`; the audit, the awards join and older readers read
    // `badges`. A contradiction (throwbacks worn, super-season carried) would
    // print two identity pills, so the data must never hold one.
    for (const card of rewards) {
      const identity = setBadge(card.wears);
      expect(identity, cardKey(card)).toBeTruthy();
      expect(card.badges ?? [], cardKey(card)).toContain(identity);
      if (card.wears !== 'super-season' && card.wears !== 'wnba-super-season') {
        expect(card.badges ?? [], cardKey(card)).not.toContain(SUPER_SEASON_BADGE);
      }
    }
  });

  it('a migrated reward wears the set it came from, unless the claim was dropped', () => {
    for (const card of rewards.filter(c => c.migratedFrom)) {
      if (card.notBestSeason) {
        // The user's ruling for a flagged Super Season: Throwbacks, not gold-no-pill.
        expect(card.migratedFrom.set, cardKey(card)).toBe('super-season');
        expect(card.wears, cardKey(card)).toBe('throwbacks');
        continue;
      }
      expect(card.wears, cardKey(card)).toBe(card.migratedFrom.set);
    }
    // None since the value pick: Stockton's 2001-02 is a Throwback card now,
    // and the reward migrates from it (see the header).
    expect(rewards.filter(c => c.notBestSeason).map(cardKey)).toEqual([]);
  });

  it('draws the worn look, and falls back to the bronze reward look when the tier withholds gold', () => {
    const treat = card => cardTreatment(card.set, card.salary, card.badges ?? [], card.wears);
    const portis = getCardByKey('team-rewards:Bobby_Portis');
    expect(portis.salary).toBeLessThan(SUPER_SEASON_MIN_SALARY);
    expect(treat(portis)).toEqual(setTreatment('team-rewards'));
    // Wesley Matthews is the cheapest reward over the line since the 2026-09-24
    // reprice took Gerald Wallace from $900 (on it — inclusive) to $870.
    const matthews = getCardByKey('team-rewards:Wesley_Matthews');
    expect(matthews.salary).toBeGreaterThanOrEqual(SUPER_SEASON_MIN_SALARY);
    expect(treat(matthews)).toEqual(cardTreatment('super-season', matthews.salary, matthews.badges));
    // And every reward wearing Super Season follows the line, whichever side.
    for (const card of rewards.filter(c => c.wears === 'super-season')) {
      expect(treat(card), cardKey(card)).toEqual(card.salary >= SUPER_SEASON_MIN_SALARY
        ? cardTreatment('super-season', card.salary, card.badges)
        : setTreatment(card.set));
    }
    for (const card of rewards) {
      if (card.wears === 'summer-standouts' || card.wears === 'dissonance') {
        // No set treatment to wear: the reward's own bronze, with the pill.
        expect(treat(card), cardKey(card)).toEqual(setTreatment(card.set));
      }
      if (/throwbacks$/.test(card.wears)) {
        expect(treat(card), cardKey(card)).toEqual(setTreatment(card.wears));
      }
    }
  });

  it('the three outgoing rewards are gone from the reward set and live where they qualify', () => {
    expect(getCardByKey('team-rewards:Bradley_Beal')).toBeUndefined();
    expect(getCardByKey('team-rewards:Ivica_Zubac')).toBeUndefined();
    // Parker's old key resolves through the alias only (keyAliases.test.js).
    expect(CARD_SETS['team-rewards'].some(c => c.id === 'Anthony_Parker')).toBe(false);
    expect(getCardByKey('super-season:Anthony_Parker')?.season).toBe(2007);
    expect(getCardByKey('super-season:Ivica_Zubac')?.season).toBe(2025);
    expect(getCardByKey('throwbacks:Bradley_Beal_2021')?.season).toBe(2021);
    // Wall's Super Season card is the reward, so it is hidden in its home set.
    expect(getCardByKey('super-season:John_Wall')).toBeUndefined();
    expect(getCardByKey('team-rewards:John_Wall')?.migratedFrom).toEqual({ set: 'super-season', id: 'John_Wall' });
    // And the batch's new cards exist.
    for (const key of ['super-season:Elton_Brand', 'super-season:Gilbert_Arenas', 'super-season:DeAndre_Jordan',
      'rookie:John_Wall', 'rookie:Elton_Brand', 'rookie:Gilbert_Arenas', 'rookie:DeAndre_Jordan']) {
      expect(getCardByKey(key), key).toBeTruthy();
    }
  });
});
