// The pack engine had no tests at all, which is how the shop came to be missing
// seven of the packs the engine defines — including the team pack, the whole
// answer to "collections take too many boosters". These cover the contract
// between the two, plus the guarantees players are actually paying for.
import { describe, it, expect } from 'vitest';
import {
  generatePack, PACK_TYPES, CONFERENCES, DIVISIONS, MAX_DUPES_PER_PACK,
  SPECIAL_SETS_IN_PACKS, SPECIAL_BAND_SHARE, parseFavoriteTeam, favoriteTeamOptions, normalizeFavoriteTeam, leagueOfCard } from './packEngine.js';
import { CARD_MAP } from './cards.js';
import { TEAM_ROSTERS } from './collections.js';
import { CARD_SETS, BASE_SET, cardKey, ALL_CARDS } from './cardSets.js';
import { currentFranchise, currentFranchiseFor, getTeam } from '../cards/teams.js';
import { getPlayerRarity, RARITY_ORDER } from './rarity.js';
import { shopPacks, PACK_COPY } from '../components/PackShop.jsx';

/** Options good enough to open any pack, whatever it needs. */
function optionsFor(def) {
  const opts = {};
  if (def.needsTeam) opts.team = 'OKC';
  if (def.themed === 'conference') opts.conference = 'East';
  if (def.themed === 'division') opts.division = 'Pacific';
  return opts;
}

const players = cards => cards.filter(c => c.type === 'player');
const rarityOf = pull => getPlayerRarity(CARD_MAP[pull.id]);
const atLeast = (r, min) => RARITY_ORDER.indexOf(r) >= RARITY_ORDER.indexOf(min);

const BUYABLE = Object.entries(PACK_TYPES).filter(([, def]) => !def.once);

describe('every pack the engine defines can actually be opened', () => {
  it.each(BUYABLE)('opens %s', (key, def) => {
    const cards = generatePack(key, optionsFor(def));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.id, `${key} pulled an id with no card`).toBeTruthy();
  });

  it('gives every pack the number of players it advertises', () => {
    for (const [key, def] of BUYABLE) {
      if (def.box) continue; // a box is 36 packs, counted below
      expect(players(generatePack(key, optionsFor(def))), key).toHaveLength(def.players);
    }
  });

  it('makes a booster box the boxful plus its bonus', () => {
    const def = PACK_TYPES.booster_box;
    const box = generatePack('booster_box');
    const perBooster = PACK_TYPES.booster.players + PACK_TYPES.booster.strats;
    const bonus = PACK_TYPES[def.bonus];
    expect(box).toHaveLength(def.box * perBooster + bonus.players + bonus.strats);
  });

  it('refuses a themed pack it cannot theme', () => {
    expect(() => generatePack('team_pack', { team: 'XXX' })).toThrow();
    expect(() => generatePack('nope')).toThrow(/Unknown pack/);
  });
});

describe('the shop and the engine agree', () => {
  // The regression that motivated all of this: the shop was a hand-written list
  // and quietly fell seven packs behind.
  it('lists every buyable pack', () => {
    expect(shopPacks().map(p => p.key).sort()).toEqual(BUYABLE.map(([k]) => k).sort());
  });

  it('never lists a once-only pack, which cannot be bought twice', () => {
    const once = Object.entries(PACK_TYPES).filter(([, d]) => d.once).map(([k]) => k);
    expect(once).toContain('starter');
    for (const key of once) expect(shopPacks().map(p => p.key)).not.toContain(key);
  });

  it('has written copy for each one, so none falls into the ungrouped bucket', () => {
    const ungrouped = shopPacks().filter(p => p.group === 'More').map(p => p.key);
    expect(ungrouped).toEqual([]);
    for (const p of shopPacks()) expect(PACK_COPY[p.key].desc, p.key).toBeTruthy();
  });

  it('gives a picker to exactly the packs that need one', () => {
    for (const p of shopPacks()) {
      const needs = Boolean(p.def.needsTeam || p.def.themed);
      expect(Boolean(p.pick), `${p.key} picker`).toBe(needs);
    }
  });
});

describe('targeted packs stay inside their target', () => {
  it('draws a team pack only from that FRANCHISE — roster plus its own specials', () => {
    // It used to be roster-only. The user's rule widened it: "I think we can put
    // players for the corresponding teams in those packs (Kawhi summer card goes
    // in the Toronto pack)." So the test is no longer "is this id on the current
    // roster" but "does this card belong to this franchise", which for a special
    // card means resolving the era it prints — Kawhi's card says TOR09.
    for (const team of ['OKC', 'MIL', 'LAL', 'TOR']) {
      const roster = new Set(TEAM_ROSTERS[team]);
      for (let i = 0; i < 40; i++) {
        for (const pull of players(generatePack('team_pack', { team }))) {
          if (roster.has(pull.id)) continue;
          const [set, id] = String(pull.id).split(':');
          expect(SPECIAL_SETS_IN_PACKS, `${team} pulled ${pull.id}`).toContain(set);
          const card = (CARD_SETS[set] ?? []).find(c => c.id === id);
          expect(card, `${team} pulled unknown ${pull.id}`).toBeTruthy();
          expect(currentFranchise(card.team), `${team} pulled ${card.name} (${card.team})`)
            .toBe(team);
        }
      }
    }
  });

  it('keeps an era card belonging to another franchise out of a team pack', () => {
    // The concrete case: Kawhi has a Raptors Summer Standouts card. Toronto can
    // pull it; the Clippers, whose roster he is actually on today, cannot.
    const kawhi = 'summer-standouts:Kawhi_Leonard';
    let fromClippers = 0;
    for (let i = 0; i < 300; i++) {
      for (const pull of players(generatePack('team_pack', { team: 'LAC' }))) {
        if (pull.id === kawhi) fromClippers += 1;
      }
    }
    expect(fromClippers).toBe(0);
  });

  it('holds specials to the same band share in a team pack as in a booster', () => {
    // The other half of the user's rule — "we just can't make it infinitely
    // easier to get that card in one pack vs another". A small franchise-specific
    // special pool concentrates WITHIN the quarter SPECIAL_BAND_SHARE allows and
    // never beyond it.
    let special = 0;
    let n = 0;
    for (let i = 0; i < 300; i++) {
      for (const pull of players(generatePack('team_pack', { team: 'TOR' }))) {
        n += 1;
        if (String(pull.id).includes(':')) special += 1;
      }
    }
    expect(special / n).toBeGreaterThan(SPECIAL_BAND_SHARE - 0.1);
    expect(special / n).toBeLessThan(SPECIAL_BAND_SHARE + 0.1);
  });

  it('draws a conference pack only from that conference', () => {
    const east = new Set(CONFERENCES.East);
    for (let i = 0; i < 40; i++) {
      for (const pull of players(generatePack('conference', { conference: 'East' }))) {
        expect(east.has(CARD_MAP[pull.id].team)).toBe(true);
      }
    }
  });

  it('draws a division pack only from that division', () => {
    const pacific = new Set(DIVISIONS.Pacific);
    for (let i = 0; i < 40; i++) {
      for (const pull of players(generatePack('division', { division: 'Pacific' }))) {
        expect(pacific.has(CARD_MAP[pull.id].team)).toBe(true);
      }
    }
  });

  it('draws a set-scoped pack only from its own pool', () => {
    for (const [key, set] of [['nba_booster', BASE_SET], ['wnba_booster', 'wnba'], ['rookie_pack', 'rookie'], ['standouts', 'summer-standouts']]) {
      const pool = new Set(CARD_SETS[set].map(cardKey));
      for (let i = 0; i < 20; i++) {
        for (const pull of players(generatePack(key))) {
          expect(pool.has(pull.id), `${key} pulled ${pull.id}`).toBe(true);
        }
      }
    }
  });
});

describe('the duplicate cap', () => {
  it('never repeats the same card more than twice in one pack', () => {
    // Not "no duplicates" — duplicates are what the burn mechanic is for. The
    // cap only stops the worst case, a five-card team pack of one player.
    for (const key of ['booster', 'team_pack', 'super', 'rookie_pack']) {
      for (let i = 0; i < 400; i++) {
        const counts = {};
        for (const pull of players(generatePack(key, optionsFor(PACK_TYPES[key])))) {
          counts[pull.id] = (counts[pull.id] ?? 0) + 1;
        }
        const repeats = Object.values(counts).reduce((n, c) => n + (c - 1), 0);
        expect(repeats, `${key} repeated ${repeats} slots`).toBeLessThanOrEqual(MAX_DUPES_PER_PACK);
      }
    }
  });

  it('keeps a team pack usefully varied despite the tiny pool', () => {
    // A ten-card roster and five pulls is the hardest case for variety, and the
    // whole point of the pack is progress toward a collection.
    let distinct = 0;
    const N = 600;
    for (let i = 0; i < N; i++) {
      distinct += new Set(players(generatePack('team_pack', { team: 'OKC' })).map(p => p.id)).size;
    }
    expect(distinct / N).toBeGreaterThan(2.8);
  });
});

describe('guarantees', () => {
  it('honours a guaranteed rare-or-better player', () => {
    for (let i = 0; i < 120; i++) {
      const best = players(generatePack('super')).map(rarityOf);
      expect(best.some(r => atLeast(r, 'rare'))).toBe(true);
    }
  });

  it('makes every Rare Deluxe player rare or better', () => {
    for (let i = 0; i < 120; i++) {
      for (const r of players(generatePack('rare_deluxe')).map(rarityOf)) {
        expect(atLeast(r, 'rare')).toBe(true);
      }
    }
  });

  it('reaches the apex band only through the Legendary Chase', () => {
    for (let i = 0; i < 120; i++) {
      expect(players(generatePack('legendary_chase')).map(rarityOf)).toContain('legendary');
    }
  });

  it('never launders a legendary out of a "guaranteed super rare"', () => {
    // The guarantee means EXACTLY the super-rare band. If it were "super-rare or
    // better" the apex cards would leak into a 1,500-coin pack and the chase
    // pack would stop meaning anything.
    let legendaries = 0;
    for (let i = 0; i < 400; i++) {
      const all = players(generatePack('mega_deluxe')).map(rarityOf);
      expect(all.every(r => atLeast(r, 'super-rare'))).toBe(true);
      legendaries += all.filter(r => r === 'legendary').length;
    }
    expect(legendaries).toBe(0);
  });
});

describe('pulls are collection keys', () => {
  it('keys base cards bare and every other set with its prefix', () => {
    // A booster mixes the special sets in now, so a bare id and a prefixed one
    // are both correct out of the same pack — what must hold is that the KEY
    // matches the set the card actually came from.
    const base = new Set(CARD_SETS[BASE_SET].map(c => c.id));
    for (let i = 0; i < 200; i += 1) {
      for (const pull of players(generatePack('booster'))) {
        if (pull.id.includes(':')) {
          const [set, id] = pull.id.split(':');
          // A booster's base is both leagues now, so `wnba:` is a base pull.
          expect([...SPECIAL_SETS_IN_PACKS, 'wnba'], pull.id).toContain(set);
          expect(CARD_SETS[set].some(c => c.id === id), pull.id).toBe(true);
        } else {
          expect(base.has(pull.id), pull.id).toBe(true);
        }
      }
    }
    for (const pull of players(generatePack('wnba_booster'))) {
      expect(pull.id.startsWith('wnba:')).toBe(true);
    }
  });

  it('never pulls a card the collection cannot resolve', () => {
    for (const [key, def] of BUYABLE) {
      for (const pull of generatePack(key, optionsFor(def))) {
        if (pull.type !== 'player') continue;
        expect(CARD_MAP[pull.id], `${key} pulled unresolvable ${pull.id}`).toBeTruthy();
      }
    }
  });
});

describe('both leagues in the everyday packs', () => {
  it('draws WNBA cards from a plain booster, at roughly their share of the pool', () => {
    // The user's rule: WNBA folded into standard and premium; league-only
    // packs are targeted. Over a thousand boosters the WNBA share of base
    // pulls should sit near its share of the two league sets — not zero, and
    // not dominant.
    const nba = CARD_SETS[BASE_SET].length;
    const wnba = CARD_SETS.wnba.length;
    const expected = wnba / (nba + wnba);
    let base = 0;
    let w = 0;
    for (let i = 0; i < 1000; i += 1) {
      for (const pull of players(generatePack('booster'))) {
        const set = pull.id.includes(':') ? pull.id.split(':')[0] : BASE_SET;
        if (set === BASE_SET || set === 'wnba') {
          base += 1;
          if (set === 'wnba') w += 1;
        }
      }
    }
    const share = w / base;
    expect(share).toBeGreaterThan(expected * 0.6);
    expect(share).toBeLessThan(expected * 1.5);
  });

  it('keeps the league packs to one league each', () => {
    for (let i = 0; i < 50; i += 1) {
      for (const pull of players(generatePack('nba_booster'))) expect(pull.id.includes(':')).toBe(false);
      for (const pull of players(generatePack('wnba_booster'))) expect(pull.id.startsWith('wnba:')).toBe(true);
    }
  });
});

describe('a box knows its packs', () => {
  it('tags every card with the pack it came from, boosters then the bonus', () => {
    const box = generatePack('booster_box');
    const def = PACK_TYPES.booster_box;
    const byPack = {};
    for (const c of box) {
      expect(typeof c.packIndex).toBe('number');
      (byPack[c.packIndex] ??= []).push(c);
    }
    expect(Object.keys(byPack)).toHaveLength(def.box + 1);
    for (let i = 0; i < def.box; i += 1) {
      expect(byPack[i], `pack ${i}`).toHaveLength(PACK_TYPES.booster.players + PACK_TYPES.booster.strats);
      for (const c of byPack[i]) expect(c.packType).toBe('booster');
    }
    for (const c of byPack[def.box]) expect(c.packType).toBe(def.bonus);
  });

  it('leaves a single pack untagged, so the reveal treats it as one', () => {
    for (const c of generatePack('booster')) expect(c.packIndex).toBeUndefined();
  });
});

describe('the starter pack\'s favourite-team core', () => {
  const byKey = new Map(ALL_CARDS.map(c => [cardKey(c), c]));
  const playersOf = pack => pack.filter(c => c.type === 'player').map(c => byKey.get(c.id)).filter(Boolean);
  const fromTeam = (cards, fav) => {
    const want = parseFavoriteTeam(fav);
    return cards.filter(c => leagueOfCard(c) === want.league && currentFranchise(c.team) === want.abbr);
  };

  it('still deals a full starter — the core is INSIDE the twenty, not instead of it', () => {
    const pack = generatePack('starter', { favoriteTeam: 'nba:MIL' });
    expect(pack.filter(c => c.type === 'player')).toHaveLength(20);
    // Thirty dealt plus the sign-up gift (bonusStrats) — see packableStrats.
    expect(pack.filter(c => c.type === 'strat')).toHaveLength(31);
    // Two High Screen & Roll inside the thirty, every time (guaranteedStrats).
    expect(pack.filter(c => c.type === 'strat' && c.id === 'high_screen_roll').length).toBeGreaterThanOrEqual(2);
    expect(pack.some(c => c.type === 'strat' && c.id === 'unethical_hoops')).toBe(true);
  });

  it('guarantees the named franchise, and the right league of it', () => {
    // ATL is a Hawk and a Dream — the collision the league qualifier exists for.
    for (const fav of ['nba:ATL', 'wnba:ATL', 'nba:MIL', 'wnba:LVA']) {
      const mine = fromTeam(playersOf(generatePack('starter', { favoriteTeam: fav })), fav);
      expect(mine.length, fav).toBeGreaterThanOrEqual(2);
      const other = fav.startsWith('wnba') ? 'nba' : 'wnba';
      expect(fromTeam(playersOf(generatePack('starter', { favoriteTeam: fav })), `${other}:${parseFavoriteTeam(fav).abbr}`).length)
        .toBeLessThan(mine.length + 3);
    }
  });

  it('leans on commons and an uncommon, not on the stars', () => {
    const mine = fromTeam(playersOf(generatePack('starter', { favoriteTeam: 'nba:LAL' })), 'nba:LAL');
    for (const c of mine) expect(['common', 'uncommon', 'rare', 'super-rare', 'legendary']).toContain(getPlayerRarity(c));
    expect(mine.filter(c => ['common', 'uncommon'].includes(getPlayerRarity(c))).length).toBeGreaterThanOrEqual(2);
  });

  it('deals a normal starter when no team is named, and survives an unknown one', () => {
    expect(generatePack('starter').filter(c => c.type === 'player')).toHaveLength(20);
    expect(generatePack('starter', { favoriteTeam: 'nba:ZZZ' }).filter(c => c.type === 'player')).toHaveLength(20);
    expect(generatePack('starter', { favoriteTeam: '' }).filter(c => c.type === 'player')).toHaveLength(20);
  });

  it('offers only franchises with enough cards to make a core, both leagues', () => {
    const opts = favoriteTeamOptions();
    expect(opts.filter(o => o.startsWith('nba:'))).toHaveLength(30);
    expect(opts.filter(o => o.startsWith('wnba:')).length).toBeGreaterThanOrEqual(12);
    expect(opts).toContain('nba:MIL');
    expect(opts).toContain('wnba:LVA');
  });

  it('spells a favourite the way the option list does, whatever case it arrives in', () => {
    expect(normalizeFavoriteTeam('nba:cle')).toBe('nba:CLE');
    expect(normalizeFavoriteTeam('NBA:CLE')).toBe('nba:CLE');
    expect(normalizeFavoriteTeam('wnba:lva')).toBe('wnba:LVA');
    expect(normalizeFavoriteTeam('mil')).toBe('nba:MIL');
    expect(normalizeFavoriteTeam('')).toBe(null);
    for (const option of favoriteTeamOptions()) expect(normalizeFavoriteTeam(option)).toBe(option);
  });

  it('offers the folded WNBA franchises on the strength of their legends, and deals them a thin core', () => {
    const opts = favoriteTeamOptions();
    for (const key of ['wnba:CLE', 'wnba:HOU', 'wnba:SAC', 'wnba:MIA']) expect(opts).toContain(key);
    expect(opts.filter(o => /^wnba:CHA/.test(o))).toHaveLength(1);   // the Sting's two eras are one team
    // The pack's own keys: the legends live in the special sets, outside the
    // starter pool the other helpers resolve against.
    const keysOf = fav => generatePack('starter', { favoriteTeam: fav }).filter(c => c.type === 'player').map(c => c.id);
    // The Rockers: a common and two uncommons exist, so the core is two of
    // them and nothing rarer is needed.
    for (let n = 0; n < 6; n += 1) {
      const rockers = keysOf('wnba:CLE').filter(k => /^wnba-super-season:(Michelle_Edwards|Chasity_Melvin|Suzie_McConnell_Serio)$/.test(k));
      expect(rockers.length).toBeGreaterThanOrEqual(2);
      expect(rockers.length).toBeLessThanOrEqual(3);
    }
    // The Comets: one uncommon among legends, so the top-up adds one rarer
    // card — the least rare available, Janeth Arcain.
    for (let n = 0; n < 6; n += 1) {
      const comets = keysOf('wnba:HOU');
      expect(comets).toContain('wnba-super-season:Michelle_Snow');
      expect(comets).toContain('wnba-super-season:Janeth_Arcain');
      expect(comets.filter(k => /^wnba-super-season:(Michelle_Snow|Janeth_Arcain|Tina_Thompson|Cynthia_Cooper|Sheryl_Swoopes)$/.test(k))).toHaveLength(2);
    }
    // The Sol: one legend, a rare. She is the core.
    expect(keysOf('wnba:MIA')).toContain('wnba-super-season:Elena_Baranova');
  });

  it('offers nothing the team tables cannot name', () => {
    // THE PICKER PUTS EVERY ONE OF THESE ON SCREEN. Two used to come out as
    // "Unknown" behind a grey ball: `favoriteTeamOptions` read WNBA codes
    // through the NBA's franchise history, so the Phoenix Mercury resolved to
    // the Suns' PHX and the Seattle Storm to the Thunder's OKC, and neither is
    // in WNBA_TEAMS. A choice you cannot see the name of is not a choice.
    const unnamed = [];
    for (const option of favoriteTeamOptions()) {
      const { league, abbr } = parseFavoriteTeam(option);
      const team = getTeam(abbr, league === 'wnba' ? { league: 'WNBA' } : {});
      if (!team || team.name === 'Unknown') unnamed.push(option);
    }
    expect(unnamed).toEqual([]);
  });

  it('keeps the two WNBA franchises the NBA has a claim on', () => {
    const opts = favoriteTeamOptions();
    expect(opts).toContain('wnba:PHO'); // Mercury, not the Suns
    expect(opts).toContain('wnba:SEA'); // Storm, who did not move to Oklahoma
    expect(opts).not.toContain('wnba:PHX');
    expect(opts).not.toContain('wnba:OKC');
    // And the core still finds them, which is the half a bad option would hide.
    const byKey = new Map(ALL_CARDS.map(c => [cardKey(c), c]));
    for (const fav of ['wnba:PHO', 'wnba:SEA']) {
      const want = parseFavoriteTeam(fav);
      const mine = generatePack('starter', { favoriteTeam: fav })
        .filter(c => c.type === 'player')
        .map(c => byKey.get(c.id))
        .filter(c => c && leagueOfCard(c) === want.league
          && currentFranchiseFor(c.team, { league: 'WNBA' }) === want.abbr);
      expect(mine.length, fav).toBeGreaterThanOrEqual(2);
    }
  });

  it('reads a bare code as NBA, so an older stored value keeps working', () => {
    expect(parseFavoriteTeam('MIL')).toEqual({ league: 'nba', abbr: 'MIL' });
    expect(parseFavoriteTeam('wnba:lva')).toEqual({ league: 'wnba', abbr: 'LVA' });
    expect(parseFavoriteTeam('')).toBeNull();
    expect(parseFavoriteTeam(null)).toBeNull();
  });
});
