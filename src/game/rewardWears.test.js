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
//
// RE-CUT BY THE COLLECTION-REWARD RE-PICK (2026-09-30). Every reward now beats
// the best card its collection asks for, the conference and whole-set rewards
// moved to set-rewards, and each special set's own top card became its reward.
// The table below is read off that build; the verdicts the sweep and the user
// made (Summer Standouts is an identity, bronze under the gold line) stand.
import { describe, it, expect } from 'vitest';
import { CARD_SETS, getCardByKey, cardKey } from './cardSets.js';
import { cardTreatment, setBadge, setTreatment } from '../cards/sets.js';
import { SUPER_SEASON_BADGE, SUPER_SEASON_MIN_SALARY } from '../cards/badges.js';

const REWARD_SETS = ['team-rewards', 'wnba-team-rewards', 'set-rewards', 'wnba-set-rewards'];

/** key -> the set whose look the reward wears. The whole reward roster, nothing left off. */
const WEARS = {
  // ── NBA team rewards (30) since the 2026-09-30 re-pick ─────────────────
  'team-rewards:Russell_Westbrook': 'throwbacks',
  'team-rewards:LeBron_James_2016': 'throwbacks',
  'team-rewards:LeBron_James_2020': 'throwbacks',
  'team-rewards:Larry_Bird': 'throwbacks',
  'team-rewards:Dwyane_Wade_2009': 'throwbacks', // moved from the dormant Throwback: his Super Season is 2009-10
  'team-rewards:Kevin_Durant': 'summer-standouts', // a playoff run keeps its identity (the user's ruling)
  'team-rewards:Kevin_Love': 'super-season', // built; 2013-14 is his best by the rule, and he has no Super Season card
  'team-rewards:Tim_Duncan': 'throwbacks', // his 1997-98 rookie card beats every later season, so none is a Super Season
  'team-rewards:Anthony_Davis_2015': 'throwbacks', // moved from the dormant Throwback
  'team-rewards:Julius_Erving': 'super-season', // 1980-81, his Super Season since the value pick weighed it (2026-09-30)
  'team-rewards:Dirk_Nowitzki': 'throwbacks',
  'team-rewards:Shaquille_O_Neal': 'throwbacks',
  'team-rewards:Karl_Malone': 'throwbacks',
  'team-rewards:Patrick_Ewing': 'throwbacks',
  'team-rewards:Bradley_Beal': 'throwbacks',
  'team-rewards:Clyde_Drexler': 'throwbacks',
  'team-rewards:Blake_Griffin': 'super-season', // built; 2018-19 is his best by the rule
  'team-rewards:Alex_English': 'super-season', // built; his 1982-83 scoring title is his best
  'team-rewards:Vince_Carter': 'throwbacks',
  'team-rewards:Yao_Ming': 'throwbacks',
  'team-rewards:Reggie_Miller': 'throwbacks',
  'team-rewards:Kemba_Walker': 'throwbacks',
  'team-rewards:Derrick_Rose': 'super-season', // 2010-11, his Super Season, moved in (the John Wall precedent)
  'team-rewards:Marc_Gasol': 'throwbacks',
  'team-rewards:Dominique_Wilkins': 'throwbacks',
  'team-rewards:Michael_Redd': 'super-season',
  'team-rewards:Steve_Nash_2006': 'throwbacks',
  'team-rewards:Chris_Paul_2015': 'throwbacks',
  'team-rewards:Peja_Stojakovic': 'super-season',
  'team-rewards:Jason_Kidd_2003': 'super-season',
  // ── WNBA team rewards (13) ──────────────────────────────────────────────
  'wnba-team-rewards:Angel_McCoughtry': 'wnba-throwbacks',
  'wnba-team-rewards:Tamika_Catchings': 'wnba-throwbacks',
  'wnba-team-rewards:Cappie_Pondexter': 'wnba-super-season',
  'wnba-team-rewards:Becky_Hammon': 'wnba-super-season',
  'wnba-team-rewards:Seimone_Augustus': 'wnba-throwbacks',
  'wnba-team-rewards:Penny_Taylor': 'wnba-super-season',
  'wnba-team-rewards:Mwadi_Mabika': 'wnba-throwbacks',
  'wnba-team-rewards:Cheryl_Ford': 'wnba-super-season',
  'wnba-team-rewards:Epiphanny_Prince': 'wnba-throwbacks',
  'wnba-team-rewards:Alysha_Clark': 'wnba-super-season',
  'wnba-team-rewards:Chamique_Holdsclaw': 'wnba-throwbacks',
  'wnba-team-rewards:Nykesha_Sales': 'wnba-throwbacks',
  'wnba-team-rewards:Sophia_Witherspoon': 'wnba-throwbacks',
  // ── set rewards (7): the special sets, the conferences and the whole set ─
  'set-rewards:Giannis_Antetokounmpo': 'super-season',
  'set-rewards:David_Robinson': 'rookie',
  'set-rewards:Anthony_Davis': 'summer-standouts',
  'set-rewards:Russell_Westbrook_2020': 'dissonance',
  'set-rewards:Joel_Embiid': 'super-season',
  'set-rewards:Stephen_Curry': 'super-season', // the West reward: his 2015-16 Super Season, moved out of the set
  'set-rewards:Giannis_Antetokounmpo_2023': 'throwbacks', // the whole-set reward, built as a Throwback and moved in
  // ── WNBA set rewards (2) ────────────────────────────────────────────────
  'wnba-set-rewards:Diana_Taurasi': 'wnba-super-season',
  'wnba-set-rewards:Breanna_Stewart': 'wnba-rookie',
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

  it('the rewards that left on 2026-09-30 are gone from the reward sets and live where they qualify', () => {
    // Built rewards that left keep their card: a Throwback, or a Super Season
    // when that season was the player's best.
    for (const [old, now] of [
      ['Josh_Smith', 'throwbacks:Josh_Smith_2009'], ['Luol_Deng', 'throwbacks:Luol_Deng_2011'],
      ['Luis_Scola', 'throwbacks:Luis_Scola_2011'], ['Elton_Brand', 'throwbacks:Elton_Brand_2003'],
      ['Alonzo_Mourning', 'throwbacks:Alonzo_Mourning_2006'], ['Allan_Houston', 'throwbacks:Allan_Houston_2003'],
      ['Sam_Cassell', 'throwbacks:Sam_Cassell_2004'], ['Gerald_Wallace', 'super-season:Gerald_Wallace'],
      ['Wesley_Matthews', 'super-season:Wesley_Matthews'], ['Stephen_Curry', 'throwbacks:Stephen_Curry_2021'],
    ]) {
      expect(CARD_SETS['team-rewards'].some(c => c.id === old), old).toBe(false);
      expect(CARD_SETS[now.split(':')[0]].some(c => cardKey(c) === now), now).toBe(true);
    }
    // Moved rewards went home: Wall's Super Season is back in its set.
    expect(getCardByKey('super-season:John_Wall')?.season).toBe(2017);
    expect(getCardByKey('rookie:Michael_Jordan')?.season).toBe(1985);
    // The older outgoing three still live where they qualify.
    expect(CARD_SETS['team-rewards'].some(c => c.id === 'Anthony_Parker')).toBe(false);
    expect(getCardByKey('super-season:Anthony_Parker')?.season).toBe(2007);
    expect(getCardByKey('throwbacks:Bradley_Beal_2021')?.season).toBe(2021);
    // And the batch's new cards exist.
    for (const key of ['super-season:Paul_Millsap', 'super-season:Dell_Curry', 'super-season:DeMarcus_Cousins',
      'super-season:Bernard_King', 'super-season:Arvydas_Sabonis', 'super-season:Adrian_Dantley', 'super-season:Kristaps_Porzingis',
      'rookie:Derrick_Rose', 'dissonance:Derrick_Rose_NYK', 'dissonance:Derrick_Rose_MIN', 'dissonance:Derrick_Rose_DET',
      'throwbacks:Blake_Griffin_2014', 'throwbacks:Lou_Williams_2020', 'throwbacks:Shawn_Marion_2007', 'rookie:Shawn_Marion']) {
      expect(getCardByKey(key), key).toBeTruthy();
    }
  });
});
