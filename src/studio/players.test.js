import { describe, it, expect } from 'vitest';
import {
  playerIdFromName,
  POOL_PLAYERS,
  CARD_PLAYERS,
  SOURCES,
  DEFAULT_SOURCE,
  photoProgress,
  filterPlayers,
  stepSelection,
  TEAMS_RESOLVED,
  STATS_GENERATED,
  BADGES_GENERATED,
  BADGE_FILE,
} from './players.js';
import {
  BADGE_IDS,
  ROOKIE_BADGE,
  SUPER_SEASON_BADGE,
  pickBadge,
} from '../cards/badges.js';
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

  it('prints SUPER SEASON on every badged card, and ROOKIE on none', () => {
    // The consequence of the priority the user asked for, on the real list:
    // a player whose rookie season is the current one has only that season, so
    // it is his best one too, and Super Season outranks Rookie.
    const printed = POOL_PLAYERS
      .filter(p => p.badges.length)
      .map(p => pickBadge(p.badges).id);
    expect(printed.filter(id => id === SUPER_SEASON_BADGE).length).toBe(printed.length);
    expect(printed.filter(id => id === ROOKIE_BADGE).length).toBe(0);
    // …while the ROOKIE fact itself is still on the record, not thrown away.
    expect(POOL_PLAYERS.filter(p => p.badges.includes(ROOKIE_BADGE)).length)
      .toBe(BADGE_FILE.counts.applies[ROOKIE_BADGE]);
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
