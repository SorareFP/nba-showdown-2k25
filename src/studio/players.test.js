import { describe, it, expect } from 'vitest';
import {
  playerIdFromName,
  POOL_PLAYERS,
  CARD_PLAYERS,
  SOURCES,
  DEFAULT_SOURCE,
  PRIMARY_SOURCES,
  SECONDARY_SOURCES,
  visibleSources,
  photoProgress,
  filterPlayers,
  stepSelection,
  TEAMS_RESOLVED,
  STATS_GENERATED,
  BADGES_GENERATED,
  BADGE_FILE,
  AWARDS_GENERATED,
  awardsFor,
} from './players.js';
import {
  BADGE_IDS,
  BEST_SEASON_BADGE,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  pickBadge,
} from '../cards/badges.js';
import { AWARD_CODES } from '../cards/awards.js';
import { isSafePlayerId } from '../../scripts/studio/studioServerPlugin.js';
import { getTeam } from '../cards/teams.js';
import {
  CURRENT_SET,
  STATS_SEASON,
  FINISHED_SET,
  FINISHED_STATS_SEASON,
  ROOKIE_SET,
  SET_IDS,
  SUPER_SEASON_SET,
  WNBA_SET,
  WNBA_SUPER_SEASON_SET,
  getSet,
} from '../cards/sets.js';

const P = (id, name, team, pos) => ({ id, name, team, pos });

const SAMPLE = [
  P('Tyrese_Maxey', 'Tyrese Maxey', 'PHI', 'PG'),
  P('Kevin_Durant', 'Kevin Durant', 'HOU', 'SF'),
  P('Luka_Doncic', 'Luka Dončić', 'LAL', 'PG'),
];

describe('playerIdFromName', () => {
  it('joins name parts with underscores', () => {
    expect(playerIdFromName('Kevin Durant')).toBe('Kevin_Durant');
  });

  it('collapses runs of punctuation into a single underscore', () => {
    expect(playerIdFromName("De'Aaron Fox")).toBe('De_Aaron_Fox');
    expect(playerIdFromName('A.J. Green')).toBe('A_J_Green');
  });

  it('trims the underscore a trailing suffix dot would leave', () => {
    // "Jabari_Smith_Jr_" would be the id; the shipped set spells it
    // "Jabari_Smith_Jr", and this id is a filename people read.
    expect(playerIdFromName('Jabari Smith Jr.')).toBe('Jabari_Smith_Jr');
    expect(playerIdFromName('  Kevin Durant  ')).toBe('Kevin_Durant');
  });

  it('strips diacritics instead of collapsing them to underscores', () => {
    // This id is the photo filename, so the scheme must not churn — and the
    // form it is pinned to is the one the repo already ships: card art named
    // "Vit_Krejci.png", ids in src/game/rawCards.js like "Alperen_Sengun".
    expect(playerIdFromName('Luka Dončić')).toBe('Luka_Doncic');
    expect(playerIdFromName('Nikola Jokić')).toBe('Nikola_Jokic');
    expect(playerIdFromName('Alperen Şengün')).toBe('Alperen_Sengun');
    expect(playerIdFromName('Vít Krejčí')).toBe('Vit_Krejci');
    expect(playerIdFromName('Jonas Valančiūnas')).toBe('Jonas_Valanciunas');
    expect(playerIdFromName('Dennis Schröder')).toBe('Dennis_Schroder');
  });

  it('keeps case and word breaks, unlike a cross-source match key', () => {
    // resolveTeams.js's normalizeName lowercases and drops separators to match
    // names across feeds. This is a filename, so it must stay readable.
    expect(playerIdFromName('Luka Dončić')).not.toBe('lukadoncic');
  });

  it('survives a missing name instead of throwing', () => {
    expect(playerIdFromName(undefined)).toBe('');
    expect(playerIdFromName(null)).toBe('');
    expect(playerIdFromName('...')).toBe('');
  });
});

describe('the 2025-26 pool', () => {
  // THE ONE PLACE THE POOL SIZE IS PINNED. Every other test that used to quote
  // 331 now derives its count, because that number moves whenever a name is
  // added to card-data/force-include-2026.json and eleven tests failing for
  // that reason teaches nobody anything. Here it is the assertion: 331 players
  // clear the MPG>=12 / G>=40 rule and 19 more are force-included (18 whose
  // 2025-26 season was cut short by injury, plus Ty Jerome by name). Update
  // this number, deliberately, when the list changes — and see
  // scripts/cardgen/generatePool.test.js, which checks the composition itself.
  it('loads the whole 350-player pool', () => {
    expect(POOL_PLAYERS).toHaveLength(350);
  });

  it('gives every player a unique id', () => {
    const ids = new Set(POOL_PLAYERS.map(p => p.id));
    expect(ids.size).toBe(POOL_PLAYERS.length);
  });

  it('produces ids the studio server will accept as filenames', () => {
    // The upload route rejects any id outside [A-Za-z0-9_.-]; an id it refuses
    // is a player whose photo can never be saved.
    const rejected = POOL_PLAYERS.filter(p => !isSafePlayerId(p.id)).map(p => p.name);
    expect(rejected).toEqual([]);
  });

  it('carries name, team and position', () => {
    const maxey = POOL_PLAYERS.find(p => p.name === 'Tyrese Maxey');
    expect(maxey).toMatchObject({ id: 'Tyrese_Maxey', team: 'PHI', pos: 'PG' });
  });

  // Stats are OPTIONAL by design: cards-2026-27.json is generated, and a
  // checkout that has never run the generator must still open a studio you can
  // curate photos in. So this asserts the two shapes are each internally
  // coherent, not that one of them is the case — a test that demanded stats
  // would fail on a fresh clone, and one that demanded their absence (which is
  // what this used to do) fails the moment the generator is run.
  it('either has a complete generated stat line or none at all', () => {
    const maxey = POOL_PLAYERS.find(p => p.name === 'Tyrese Maxey');
    if (STATS_GENERATED) {
      expect(maxey.provisional).toBe(true);
      expect(typeof maxey.speed).toBe('number');
      expect(typeof maxey.power).toBe('number');
      expect(typeof maxey.shotLine).toBe('number');
      expect(typeof maxey.salary).toBe('number');
      expect(Array.isArray(maxey.chart)).toBe(true);
      expect(maxey.chart[0]).toMatchObject({
        lo: expect.any(Number),
        hi: expect.any(Number),
        pts: expect.any(Number),
      });
    } else {
      expect(maxey.chart).toBeUndefined();
      expect(maxey.salary).toBeUndefined();
    }
  });

  it('takes stats from the generated file but identity from the pool', async () => {
    // The generated file carries its own name/team/pos alongside the stats. If
    // the whole record were spread in, a team resolved by
    // scripts/cardgen/generateTeams.js (or fixed by hand in
    // card-data/manual-teams.json) would silently revert to whatever the card
    // generator last happened to see. Stats must come across; identity must not.
    if (!STATS_GENERATED) return;
    const generated = (await import('../../card-data/generated/cards-2026-27.json')).default.cards;
    const resolved = new Map(
      (await import('../../card-data/generated/player-teams-2026.json')).default.map(t => [
        t.name,
        t,
      ])
    );
    for (const card of generated) {
      const player = POOL_PLAYERS.find(p => p.id === card.id);
      expect(player).toBeDefined();
      expect(player.speed).toBe(card.speed);
      expect(player.chart).toEqual(card.chart);
      const fromTeamsFile = resolved.get(player.name);
      if (fromTeamsFile) expect(player.team).toBe(fromTeamsFile.team);
    }
  });

  it('leaves no underscore where a diacritic used to be', () => {
    // A letter this scheme cannot decompose (Đ, ø, ł — none of which NFD
    // touches) would silently become an underscore again. Doubled or edge
    // underscores are the symptom, so fail on them by name.
    const ugly = POOL_PLAYERS.filter(p => /^_|_$|__/.test(p.id)).map(p => p.name);
    expect(ugly).toEqual([]);
  });
});

describe('resolved teams overlaid on the pool', () => {
  // These assert the file generated by scripts/cardgen/generateTeams.js is
  // actually reaching the studio. Without it, 45 players render on the grey
  // "Unknown" theme with no logo — the single most visible thing wrong with the
  // set — and no pool player can fall back to an NBA headshot.
  const MULTI_TEAM = /^(2TM|3TM|4TM|TOT)$/;

  it('is switched on in this checkout', () => {
    expect(TEAMS_RESOLVED).toBe(true);
  });

  it('replaces the multi-team aggregate codes with real teams', () => {
    const stuck = POOL_PLAYERS.filter(p => MULTI_TEAM.test(p.team)).map(p => p.name);
    // Only the players no source can place: on no active roster AND carrying an
    // aggregate code. They stay in the list and stay visibly unthemed, which is
    // the point — they need a human decision, recorded in manual-teams.json.
    expect(stuck).toEqual([
      'Cam Thomas',
      'Vince Williams Jr.',
      'Ochai Agbaji',
      'Guerschon Yabusele',
    ]);
  });

  it('keeps every pool player, including the ones it could not resolve', async () => {
    // The resolved file is SHORTER than the pool — the generator emits only
    // players it could give a real team, and 4 have none from any source.
    // Reading it as the list rather than as an overlay would silently drop them.
    const resolved = (await import('../../card-data/generated/player-teams-2026.json')).default;
    expect(POOL_PLAYERS.length - resolved.length).toBe(4);
  });

  it('gives resolved players the personId the headshot fallback needs', () => {
    const harden = POOL_PLAYERS.find(p => p.name === 'James Harden');
    // Traded mid-season: "2TM" in the raw pool, a real team here.
    expect(harden).toMatchObject({ team: 'CLE', personId: 201935 });
    const withId = POOL_PLAYERS.filter(p => p.personId).length;
    expect(withId).toBeGreaterThan(300);
  });

  it('leaves the unresolvable few with an explicit null personId', () => {
    const thomas = POOL_PLAYERS.find(p => p.name === 'Cam Thomas');
    expect(thomas.personId).toBeNull();
  });

  it('names every team in a form the card theming knows', () => {
    // A team abbreviation getTeam() cannot find renders grey with no logo. The
    // four unresolved players are the only ones allowed to look like that.
    const unthemed = POOL_PLAYERS.filter(p => getTeam(p.team).name === 'Unknown').map(p => p.name);
    expect(unthemed).toHaveLength(4);
  });
});

describe('photo-id collisions', () => {
  // The photo directory is ONE namespace shared by both sources, so this is the
  // check that matters: two different people must never derive the same
  // filename, or curating one silently overwrites the other's photo.
  const bare = name =>
    name
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');

  it('gives every pool player a distinct id', () => {
    expect(new Set(POOL_PLAYERS.map(p => p.id)).size).toBe(POOL_PLAYERS.length);
  });

  it('gives all 306 shipped cards distinct ids', () => {
    expect(new Set(CARD_PLAYERS.map(p => p.id)).size).toBe(306);
  });

  it('never gives two different people the same id across both sets', () => {
    const byId = new Map();
    const clashes = [];
    for (const p of [...POOL_PLAYERS, ...CARD_PLAYERS]) {
      const seen = byId.get(p.id);
      if (seen === undefined) byId.set(p.id, p.name);
      else if (bare(seen) !== bare(p.name)) clashes.push(`${p.id}: ${seen} vs ${p.name}`);
    }
    expect(clashes).toEqual([]);
  });

  it('lands most of the pool on an id the shipped set already uses', () => {
    // Not a requirement, a canary: this was 177 while accents collapsed to
    // underscores, 194 on the 331-player pool, and 211 once the 19
    // force-included players were added (nearly all of them are 2025-26 cards
    // too). If the SHARE drops, the id scheme has drifted off the convention
    // src/game/rawCards.js and public/cards/players/ were built on. A share
    // rather than a count, so adding a name to the force-include list cannot
    // fail it.
    const shipped = new Set(CARD_PLAYERS.map(p => p.id));
    const overlap = POOL_PLAYERS.filter(p => shipped.has(p.id)).length;
    expect(overlap / POOL_PLAYERS.length).toBeGreaterThan(0.55);
  });
});

describe('SOURCES', () => {
  it('offers the new pool and the shipped card set', () => {
    expect(SOURCES.pool.players).toHaveLength(POOL_PLAYERS.length);
    expect(SOURCES.cards.players).toHaveLength(306);
  });

  it('sorts both by name so the list order is predictable', () => {
    for (const source of Object.values(SOURCES)) {
      const names = source.players.map(p => p.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('gives the shipped set full stats, unlike the pool', () => {
    expect(SOURCES.cards.players[0].chart.length).toBeGreaterThan(0);
  });

  it('names each option by the SET it is, with its size', () => {
    // THE BUG THIS PINS. The editable option was labelled "2025-26 pool" — for
    // the season its STATS came from — beside a badge reading "set 2026-27".
    // The user read the toggle, saw only the old season, and concluded: "I
    // can't edit the 2026-27 set." They could; it was the label.
    expect(SOURCES.pool.label).toBe(`${CURRENT_SET} set · ${POOL_PLAYERS.length} players`);
    expect(SOURCES.cards.label).toBe(`${FINISHED_SET} set · 306 cards (reference)`);
  });

  it('leads the editable option with the set being built, not the stats season', () => {
    // The specific regression: STATS_SEASON reaching the front of this label
    // again. It may appear in `sub` and in `hint`; it may not lead.
    expect(SOURCES.pool.label.startsWith(CURRENT_SET)).toBe(true);
    expect(SOURCES.pool.label).not.toContain(STATS_SEASON);
    expect(STATS_SEASON).not.toBe(CURRENT_SET);
  });

  it('marks the reference option as reference in the label itself', () => {
    // Not only in hover text: which option is preview-only has to survive
    // someone who never hovers anything.
    expect(SOURCES.cards.label).toContain('reference');
    expect(SOURCES.cards.label.startsWith(FINISHED_SET)).toBe(true);
  });

  it('quotes a count that cannot drift from the list it labels', () => {
    for (const source of Object.values(SOURCES)) {
      expect(source.label, source.key).toContain(String(source.players.length));
    }
  });

  it('keeps the stats season as subtext, where it cannot mislead', () => {
    expect(SOURCES.pool.sub).toContain(STATS_SEASON);
    expect(SOURCES.cards.sub).toBeTruthy();
  });

  it('defaults to the set being built', () => {
    expect(DEFAULT_SOURCE).toBe('pool');
    expect(SOURCES[DEFAULT_SOURCE].editable).toBe(true);
  });

  it('marks the finished set read-only and the set being built editable', () => {
    // Load-bearing, not cosmetic: both lists share one photo store keyed by
    // player id, so an upload made against the finished set writes into the
    // set being built. See Studio.jsx / PlayerList.jsx / CropEditor.jsx.
    expect(SOURCES.pool.editable).toBe(true);
    expect(SOURCES.cards.editable).toBe(false);
  });

  it('explains the stats-season-to-set relationship in each hint', () => {
    // The hover text is where the full explanation lives now that the labels
    // no longer carry it, so it has to name both seasons.
    expect(SOURCES.pool.hint).toContain(STATS_SEASON);
    expect(SOURCES.pool.hint).toContain(CURRENT_SET);
    expect(SOURCES.cards.hint).toContain(FINISHED_SET);
    expect(SOURCES.cards.hint).toContain(FINISHED_STATS_SEASON);
  });
});

describe('season constants', () => {
  it('keeps a set one year ahead of the stats it is built from', () => {
    // Both pairings follow the same rule, which is the fact the labels teach:
    // 2024-25 stats -> the 2025-26 set; 2025-26 stats -> the 2026-27 set.
    expect(STATS_SEASON).toBe(FINISHED_SET);
    expect(FINISHED_STATS_SEASON).toBe('2024-25');
    expect(CURRENT_SET).toBe('2026-27');
  });
});

describe('the base set\'s card-type badges', () => {
  // The 2026-27 pool is the first list whose CARDS carry badges rather than
  // inheriting one from the set they are in. What is checked here is the JOIN —
  // that the studio hands CardTemplate the ids the generator wrote, for the
  // right players, keyed the way everything else in this tool is keyed.

  it('gives every pool player a badges array, empty or not', () => {
    // Always present, so nothing downstream has to test for the generated
    // file's absence — CardTemplate spreads it into pickBadge unconditionally.
    for (const p of POOL_PLAYERS) {
      expect(Array.isArray(p.badges), p.name).toBe(true);
    }
  });

  it('badges exactly the players the generator named, and only them', () => {
    expect(BADGES_GENERATED).toBe(true);
    const named = new Map(BADGE_FILE.badges.map(b => [b.id, b.badges]));
    let badged = 0;
    for (const p of POOL_PLAYERS) {
      if (p.badges.length === 0) {
        expect(named.has(p.id), `${p.name} was badged and should not be`).toBe(false);
        continue;
      }
      badged += 1;
      expect(p.badges, p.name).toEqual(named.get(p.id));
    }
    expect(badged).toBe(BADGE_FILE.badges.length);
  });

  it('declares only badges the card layer can draw, and resolves to one', () => {
    for (const p of POOL_PLAYERS.filter(p => p.badges.length)) {
      for (const id of p.badges) expect(BADGE_IDS, p.name).toContain(id);
      expect(pickBadge(p.badges), p.name).not.toBeNull();
    }
  });

  it('prints ROOKIE on all 33 who are both, and tiers the other 107 by salary', () => {
    // THIS TEST USED TO ASSERT THE REVERSE — "SUPER SEASON on every badged
    // card, and ROOKIE on none" — and its reasoning was correct: a player whose
    // rookie season is the current one has only that season, so it is his best
    // one too, and Super Season outranked Rookie. What it recorded was a real
    // structural fact and an unintended design. The overlap set is not a mixed
    // population that needed a tie-break; it IS the 2025-26 rookies, and
    // "his best season" over a one-season career says nothing. So ROOKIE wins.
    //
    // ── AND THE 107 ARE NO LONGER ONE NUMBER ────────────────────────────────
    //
    // The gold pill is now the GILDED TIER of the Super Season badge: under
    // SUPER_SEASON_MIN_SALARY the same card prints BEST SEASON in the team's
    // accent instead. So `pickBadge` is given the salary here, exactly as
    // CardTemplate gives it, and the 107 split 14/93 (41/66 at the old $700).
    const badged = POOL_PLAYERS.filter(p => p.badges.length);
    const printed = badged.map(p => pickBadge(p.badges, p.salary).id);
    expect(printed.length).toBe(BADGE_FILE.counts.players);
    expect(printed.filter(id => id === ROOKIE_BADGE).length).toBe(33);
    // 14/93, not the 13/94 the linear salary model produced: pricing a card by
    // what it does in play moved one more base card across
    // SUPER_SEASON_MIN_SALARY. The split is a measurement of the price, so it
    // is expected to move whenever the price does.
    expect(printed.filter(id => id === SUPER_SEASON_BADGE).length).toBe(14);
    expect(printed.filter(id => id === BEST_SEASON_BADGE).length).toBe(93);
    // Everyone who prints ROOKIE is someone the SUPER SEASON fact is also true
    // of — the nesting is what makes this a priority question and not a rule.
    // The tier does not touch it: a rookie card is cheap, its Super Season
    // badge demotes, and ROOKIE still outranks whichever form of it survives.
    for (const p of badged.filter(p => pickBadge(p.badges, p.salary)?.id === ROOKIE_BADGE)) {
      expect(p.badges, p.name).toContain(SUPER_SEASON_BADGE);
    }
    // …and both facts are still on every record, neither thrown away. `applies`
    // is untouched by the tier — no player RECORD claims `best-season`, because
    // it is not a fact about a player but a rendering of the one above it.
    expect(POOL_PLAYERS.filter(p => p.badges.includes(ROOKIE_BADGE)).length)
      .toBe(BADGE_FILE.counts.applies[ROOKIE_BADGE]);
    expect(POOL_PLAYERS.filter(p => p.badges.includes(SUPER_SEASON_BADGE)).length)
      .toBe(BADGE_FILE.counts.applies[SUPER_SEASON_BADGE]);
    expect(POOL_PLAYERS.filter(p => p.badges.includes(BEST_SEASON_BADGE)).length).toBe(0);
    expect(BADGE_FILE.counts.applies[BEST_SEASON_BADGE]).toBe(0);
    // The generator's own tally of what will print, held against the pool the
    // studio actually lists — which is the join that would catch the badge file
    // and the salary file having been generated from different pools.
    expect(BADGE_FILE.counts.printed).toEqual({
      [ROOKIE_BADGE]: 33,
      [SUPER_SEASON_BADGE]: 14,
      [BEST_SEASON_BADGE]: 93,
    });
  });

  it('is scoped to the set it was generated for', () => {
    // A file from another season must degrade to no badges rather than badging
    // 149 players of a pool it was not built from.
    expect(BADGE_FILE.set).toBe(CURRENT_SET);
  });
});

describe('photoProgress', () => {
  it('counts how many of the active set have a photo', () => {
    expect(photoProgress(SAMPLE, ['Kevin_Durant'])).toEqual({
      withPhoto: 1,
      total: 3,
      missing: 2,
    });
  });

  it('ignores photos belonging to players outside the active set', () => {
    // card-art/photos/ accumulates files from both sources; counting the
    // shipped-card photos against the 350-player pool would inflate progress.
    expect(photoProgress(SAMPLE, ['08_09_LeBron_James', 'Kevin_Durant'])).toMatchObject({
      withPhoto: 1,
      total: 3,
    });
  });

  it('handles an empty set and missing photo data', () => {
    expect(photoProgress([], [])).toEqual({ withPhoto: 0, total: 0, missing: 0 });
    expect(photoProgress(SAMPLE, undefined)).toMatchObject({ withPhoto: 0, missing: 3 });
  });

  it('accepts a Set as well as an array', () => {
    expect(photoProgress(SAMPLE, new Set(['Kevin_Durant'])).withPhoto).toBe(1);
  });
});

describe('filterPlayers', () => {
  it('returns everyone with no filter', () => {
    expect(filterPlayers(SAMPLE, {})).toHaveLength(3);
  });

  it('matches on name, case-insensitively', () => {
    expect(filterPlayers(SAMPLE, { query: 'duran' }).map(p => p.name)).toEqual(['Kevin Durant']);
  });

  it('matches on team and position too', () => {
    expect(filterPlayers(SAMPLE, { query: 'PHI' }).map(p => p.name)).toEqual(['Tyrese Maxey']);
    expect(filterPlayers(SAMPLE, { query: 'pg' })).toHaveLength(2);
  });

  it('matches accented names by their accented spelling', () => {
    expect(filterPlayers(SAMPLE, { query: 'dončić' })).toHaveLength(1);
  });

  it('narrows to players still missing a photo', () => {
    const out = filterPlayers(SAMPLE, { missingOnly: true, photoIds: ['Kevin_Durant'] });
    expect(out.map(p => p.name)).toEqual(['Tyrese Maxey', 'Luka Dončić']);
  });

  it('combines the text filter with missing-only', () => {
    const out = filterPlayers(SAMPLE, {
      query: 'PG',
      missingOnly: true,
      photoIds: ['Tyrese_Maxey'],
    });
    expect(out.map(p => p.name)).toEqual(['Luka Dončić']);
  });
});

describe('stepSelection', () => {
  const ids = SAMPLE.map(p => p.id);

  it('moves down and up the list', () => {
    expect(stepSelection(SAMPLE, ids[0], 1)).toBe(ids[1]);
    expect(stepSelection(SAMPLE, ids[1], -1)).toBe(ids[0]);
  });

  it('clamps at both ends rather than wrapping', () => {
    expect(stepSelection(SAMPLE, ids[0], -1)).toBe(ids[0]);
    expect(stepSelection(SAMPLE, ids[2], 1)).toBe(ids[2]);
  });

  it('resumes from where a filtered-out selection was, not from the top', () => {
    // The workflow this exists for: "needs photo" is on, a photo is dropped on
    // the player at index 1, they leave the list, and the next keypress must
    // land on whoever took their place — not back at row 0.
    expect(stepSelection(SAMPLE, 'Gone_Player', 1, 1)).toBe(ids[1]);
    expect(stepSelection(SAMPLE, 'Gone_Player', -1, 1)).toBe(ids[0]);
  });

  it('clamps a stale anchor to the list it is given', () => {
    expect(stepSelection(SAMPLE, 'Gone_Player', 1, 99)).toBe(ids[2]);
    expect(stepSelection(SAMPLE, 'Gone_Player', -1, 0)).toBe(ids[0]);
  });

  it('falls to the first entry when there is no anchor to resume from', () => {
    expect(stepSelection(SAMPLE, 'Nobody_At_All', 1)).toBe(ids[0]);
  });

  it('returns null for an empty list', () => {
    expect(stepSelection([], 'x', 1)).toBeNull();
    expect(stepSelection([], 'x', 1, 3)).toBeNull();
  });
});

describe('the special sets in the source list', () => {
  const SPECIAL = [SUPER_SEASON_SET, ROOKIE_SET, WNBA_SET, WNBA_SUPER_SEASON_SET];

  it('offers all six sets, in the order the model declares them', () => {
    // THE MODEL, not the row of buttons. Every set is still a source and still
    // reachable; one of them (`cards`) is now folded behind the selector's
    // disclosure, which is a rendering rule and is pinned separately against
    // visibleSources below. Nothing may fall out of SOURCES to achieve that —
    // a set removed from here is a set the studio cannot open at all.
    expect(Object.keys(SOURCES)).toEqual([
      'pool', 'cards', SUPER_SEASON_SET, ROOKIE_SET, WNBA_SET, WNBA_SUPER_SEASON_SET,
    ]);
    expect(Object.values(SOURCES).map(s => s.set)).toEqual(SET_IDS);
  });

  it('keys each special source by its own set id, so the two cannot drift', () => {
    for (const id of SPECIAL) expect(SOURCES[id].set).toBe(id);
  });

  it('names each one by the set it is, with a count that cannot drift', () => {
    for (const id of SPECIAL) {
      const source = SOURCES[id];
      expect(source.label).toContain(getSet(id).name);
      expect(source.label).toContain(String(source.players.length));
    }
  });

  it('has every roster loaded in this checkout', () => {
    // If this fails, run the generator each set's `hint` names. The studio
    // degrades to an empty, clearly-labelled set rather than failing to build —
    // this asserts the committed files are actually there.
    //
    // THE WNBA LEGENDS SET IS SIXTEEN CARDS AND THAT IS NOT A LOAD FAILURE: it
    // is the one set here whose roster is a NAMED LIST rather than a rule, so
    // "big enough to look loaded" is the wrong test for it. It is checked
    // against the list itself in scripts/cardgen/wnba/legends.test.js.
    for (const id of SPECIAL) {
      const floor = id === WNBA_SUPER_SEASON_SET ? 16 : 100;
      expect(SOURCES[id].players.length, id).toBeGreaterThanOrEqual(floor);
    }
  });

  it('makes both editable — they are sets being curated, not references', () => {
    for (const id of SPECIAL) expect(SOURCES[id].editable).toBe(true);
  });

  it('sorts them by name like every other list', () => {
    for (const id of SPECIAL) {
      const names = SOURCES[id].players.map(p => p.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
    }
  });

  it('gives every card a complete stat line, unlike the pool', () => {
    for (const id of SPECIAL) {
      for (const card of SOURCES[id].players) {
        expect(card.chart.length, `${id} ${card.name}`).toBeGreaterThan(1);
        expect(card.speed, `${id} ${card.name}`).toBeGreaterThan(0);
        expect(card.seasonLabel, `${id} ${card.name}`).toBeTruthy();
      }
    }
  });

  it('says in the hint what the exclusion rule is, on the sets that have one', () => {
    // Super Season and Rookie are DEFINED by their exclusion rule — no card if
    // the season in question is the current one — so that has to be reachable
    // from the tool, not only from the commit. The WNBA set has no exclusion
    // rule to state: it is a league, not a slice of a career, and its own
    // membership rule (MPG/games plus a named six) is in its `sub`.
    for (const id of [SUPER_SEASON_SET, ROOKIE_SET]) {
      expect(SOURCES[id].hint.toLowerCase()).toContain('current');
    }
  });

  it('warns in every special-set hint that the numbers are substitutes', () => {
    // NONE of these three sets can read the stats the base set runs on. The two
    // historical ones lack EPM, Estimated Wins and rim FG%; the WNBA lacks
    // those AND every plus/minus estimate there is. A number that looks
    // finished gets trusted, so each hint has to say what it is standing in for.
    for (const id of SPECIAL) {
      expect(SOURCES[id].hint.toLowerCase()).toMatch(
        /provisional|substitution|stand in|standing in|equivalent|fitted/
      );
    }
  });

  it('never lets a special-set card collide with another set\'s photo', () => {
    // The ids DO collide — LeBron James is LeBron_James in every NBA set — and
    // that is fine precisely because each set owns its own photos directory.
    // What must not collide is two cards inside ONE set.
    for (const id of SPECIAL) {
      const ids = SOURCES[id].players.map(p => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('the selector\'s reference group', () => {
  it('marks exactly the finished set as secondary', () => {
    // The finished 2025-26 set is the one thing here that is not being worked
    // on: it is printed, read-only, and consulted rather than curated. Nothing
    // else may quietly join it — a live set folded away is a set the user
    // stops finding.
    expect(SECONDARY_SOURCES.map(s => s.key)).toEqual(['cards']);
    expect(SOURCES.cards.secondary).toBe(true);
  });

  it('declares secondary rather than reading it off editable', () => {
    // They coincide today on one set, and that is a coincidence, not a rule —
    // see the comment on the field. This pins that the studio asks the
    // question it means: `pool` is editable and primary, `cards` is neither,
    // and every special set is editable and primary too, so `editable` alone
    // could not have produced this split without also being wrong about them.
    for (const source of PRIMARY_SOURCES) {
      expect(source.secondary, source.key).not.toBe(true);
    }
    expect(PRIMARY_SOURCES.map(s => s.key)).toEqual([
      'pool', SUPER_SEASON_SET, ROOKIE_SET, WNBA_SET, WNBA_SUPER_SEASON_SET,
    ]);
  });

  it('keeps every set in the model, folded or not', () => {
    // The request was to de-emphasise the reference set, NOT to drop it. It is
    // the only list with a complete stat line for every player, so it is how
    // the template gets judged against the cards that were actually printed.
    const folded = [...PRIMARY_SOURCES, ...SECONDARY_SOURCES].map(s => s.key);
    expect(folded.sort()).toEqual(Object.keys(SOURCES).sort());
  });

  it('hides the reference set by default', () => {
    expect(visibleSources().map(s => s.key)).toEqual(PRIMARY_SOURCES.map(s => s.key));
    expect(visibleSources().map(s => s.key)).not.toContain('cards');
  });

  it('offers every set once the group is open, in declared order', () => {
    expect(visibleSources({ showSecondary: true }).map(s => s.key)).toEqual(
      Object.keys(SOURCES)
    );
  });

  it('never hides the set that is currently on screen', () => {
    // The failure this prevents: a collapsed group swallowing the active
    // button, so the selector shows nothing selected while the stage below it
    // renders that set's cards, and the control at fault is unguessable.
    const shown = visibleSources({ showSecondary: false, activeKey: 'cards' });
    expect(shown.map(s => s.key)).toContain('cards');
    expect(shown.map(s => s.key)).toEqual(Object.keys(SOURCES));
  });

  it('does not reorder the sets to put the folded one last', () => {
    // Declared order is the model's order (SET_IDS). The reference set sits
    // second there and the selector must not renumber the world to move it —
    // when the group is open, the row reads exactly as the model does.
    const open = visibleSources({ showSecondary: true }).map(s => s.set);
    expect(open).toEqual(SET_IDS);
  });

  it('leaves the default source visible and selected in every state', () => {
    for (const showSecondary of [true, false]) {
      for (const activeKey of Object.keys(SOURCES)) {
        const keys = visibleSources({ showSecondary, activeKey }).map(s => s.key);
        expect(keys, `${showSecondary} / ${activeKey}`).toContain(DEFAULT_SOURCE);
        expect(keys, `${showSecondary} / ${activeKey}`).toContain(activeKey);
      }
    }
  });
});

describe('the award marks the studio joins on', () => {
  // WHERE THIS IS DIFFERENT FROM THE BADGES. card-badges.json is one set's file
  // and `badges` is one map, because a badge exists to carry a fact the special
  // sets excluded from the BASE set. An award is a fact about a SEASON and every
  // set has seasons, so card-awards.json is keyed by set and the join has to
  // happen per set — which is what these tests are for.

  it('gives every pool player an array, generated file or not', () => {
    // Nothing downstream may have to test for the file's absence: a checkout
    // that has never run generateAwards.js gets empty arrays, not undefined.
    for (const p of POOL_PLAYERS) {
      expect(Array.isArray(p.awards), p.name).toBe(true);
    }
  });

  it('marks the 2025-26 TROPHIES in the pool, and nobody else', () => {
    // The six voted awards are six players, one of them holding two, and the
    // SEVENTH trophy is the Finals MVP — Jalen Brunson, off the playoff column
    // and off no other. Asserted separately from the selection AND from the
    // ring so that a regression in the -1 rule cannot hide inside either of the
    // two larger counts: both of those mark whole groups at a time, and a
    // spurious trophy would be invisible in a total of forty.
    const trophies = POOL_PLAYERS.filter(
      p => p.awards.some(c => c !== 'AS' && c !== 'CHAMP')
    );
    expect(trophies.map(p => p.name).sort()).toEqual([
      'Cooper Flagg',
      'Jalen Brunson',
      'Keldon Johnson',
      'Nickeil Alexander-Walker',
      'Shai Gilgeous-Alexander',
      'Victor Wembanyama',
    ]);
  });

  it('marks 40 cards once All-Star and the ring count', () => {
    // 5 -> 31 -> 40 of a 350-card set. The user took the All-Star decision with
    // the middle number in front of him; all three are pinned here, in
    // awards.js and in the generated file's own counts, so they cannot drift.
    const marked = POOL_PLAYERS.filter(p => p.awards.length > 0);
    expect(marked.length).toBe(40);
    expect(marked.filter(p => p.awards.includes('AS')).length).toBe(28);
    expect(marked.filter(p => p.awards.includes('CHAMP')).length).toBe(11);
  });

  it('gives the ring to the champion ROSTER, not only to its stars', () => {
    // THE POINT OF A TEAM FACT. The base set reads 2025-26, which the Knicks
    // won, and eleven of that roster are in the pool — most of them holding
    // nothing else, which is exactly what a roster join should produce and what
    // a join gated on "has an awards row" would have missed.
    const ringed = POOL_PLAYERS.filter(p => p.awards.includes('CHAMP'));
    expect(ringed.map(p => p.name).sort()).toEqual([
      'Guerschon Yabusele',
      'Jalen Brunson',
      'Jordan Clarkson',
      'Jose Alvarado',
      'Josh Hart',
      'Karl-Anthony Towns',
      'Landry Shamet',
      'Mikal Bridges',
      'Miles McBride',
      'Mitchell Robinson',
      'OG Anunoby',
    ]);
    // NINE OF THE ELEVEN CARRY THE RING AND NOTHING ELSE, which is the measure
    // of what a roster join adds over the awards column: only Brunson and Towns
    // were All-Stars, and OG Anunoby's `DPOY-10,DEF2` earns him nothing at all
    // under the -1 rule, so without the ring he would have no mark either.
    expect(ringed.filter(p => p.awards.length === 1)).toHaveLength(9);
    expect(ringed.filter(p => p.awards.length > 1).map(p => p.name).sort()).toEqual([
      'Jalen Brunson',
      'Karl-Anthony Towns',
    ]);
    // And it sorts below the trophies and above All-Star wherever it appears —
    // on the card that proves it, since Brunson's Finals MVP is a trophy the
    // ring sits under and his All-Star place is a selection it sits over.
    const brunson = POOL_PLAYERS.find(p => p.id === 'Jalen_Brunson');
    expect(brunson.awards).toEqual(['FMVP', 'CHAMP', 'AS']);
  });

  it('gives Shai Gilgeous-Alexander all three of his, in importance order', () => {
    const sga = POOL_PLAYERS.find(p => p.id === 'Shai_Gilgeous_Alexander');
    expect(sga.awards).toEqual(['MVP', 'CPOY', 'AS']);
  });

  it('gives Luka Dončić an All-Star mark and no MVP, because MVP-4 is not an MVP', () => {
    // The failure this feature is judged by, asserted where the studio actually
    // hands a record to the template — and now carrying both halves of the same
    // row: `MVP-4,CPOY-8,AS,NBA1`. The selection prints, the fourth-place
    // finish does not, and admitting the first did not weaken the second.
    const luka = POOL_PLAYERS.find(p => p.id === 'Luka_Doncic');
    expect(luka.awards).toEqual(['AS']);
    expect(luka.awards).not.toContain('MVP');
    // And Victor Wembanyama, who was third in the same vote, gets DPOY and the
    // All-Star — not the MVP — which is the same rule producing a mark rather
    // than withholding one.
    expect(POOL_PLAYERS.find(p => p.id === 'Victor_Wembanyama').awards).toEqual(['DPOY', 'AS']);
  });

  it('joins the special sets by their own ids, not the pool\'s', () => {
    // A Super Season card and a base card can be the same player; they are
    // different cards of different seasons and must not share a mark. Kevin
    // Durant has a card in both special sets, an MVP on one and a Rookie of the
    // Year on the other.
    const superSeason = SOURCES[SUPER_SEASON_SET].players.find(c => c.id === 'Kevin_Durant');
    const rookie = SOURCES[ROOKIE_SET].players.find(c => c.id === 'Kevin_Durant');
    expect(superSeason.season).toBe(2014);
    expect(superSeason.awards).toEqual(['MVP', 'AS']);
    // His ROOKIE season carried no All-Star selection, so that card is a
    // one-mark card — the season really is part of the join.
    expect(rookie.season).toBe(2008);
    expect(rookie.awards).toEqual(['ROY']);
  });

  it('gives every card in every set an array, WNBA included', () => {
    // The WNBA sets are not covered by the generator — Basketball-Reference
    // serves that league under a different path — and "not covered" has to look
    // exactly like "won nothing" rather than like a crash.
    for (const set of [SUPER_SEASON_SET, ROOKIE_SET, WNBA_SET, WNBA_SUPER_SEASON_SET]) {
      for (const card of SOURCES[set].players) {
        expect(Array.isArray(card.awards), `${set} ${card.name}`).toBe(true);
      }
    }
    for (const set of [WNBA_SET, WNBA_SUPER_SEASON_SET]) {
      expect(SOURCES[set].players.every(c => c.awards.length === 0), set).toBe(true);
    }
  });

  it('never records a code the template cannot draw', () => {
    const all = [
      ...POOL_PLAYERS,
      ...SET_IDS.flatMap(id => SOURCES[id]?.players ?? []),
    ];
    for (const card of all) {
      for (const code of card.awards ?? []) {
        expect(AWARD_CODES, `${card.name} ${code}`).toContain(code);
      }
    }
  });

  it('says out loud that it is showing marks at all', () => {
    expect(AWARDS_GENERATED).toBe(true);
    expect(awardsFor(CURRENT_SET, 'Shai_Gilgeous_Alexander')).toEqual(['MVP', 'CPOY', 'AS']);
    // A set the generator does not cover, and an id nobody has, both answer the
    // same empty array — and neither can reach the prototype.
    expect(awardsFor(WNBA_SET, 'A_ja_Wilson')).toEqual([]);
    expect(awardsFor(CURRENT_SET, 'Nobody_At_All')).toEqual([]);
    expect(awardsFor('constructor', 'constructor')).toEqual([]);
  });
});
