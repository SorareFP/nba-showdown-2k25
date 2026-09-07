// What can be tested about season storage without a Firestore emulator: the
// signed-OUT half, which is the whole of it for anybody who has not made an
// account, and the card round trip both halves share.
//
// The round trip is the part worth guarding. A season stores rosters as card
// keys and puts the cards back on the way in; if that mapping ever slips, a
// season loads with empty rosters and the failure shows up as an unplayable
// fixture three rounds in, not as an error at load.
import { describe, it, expect, beforeEach } from 'vitest';
import { dehydrate, hydrate, saveSeason, loadSeason, listSeasons, deleteSeason } from './seasons.js';
import { createSeason } from '../game/modes/season.js';
import { CARDS } from '../game/cards.js';
import { cardKey } from '../game/cardSets.js';

/** A localStorage that behaves like one, for the signed-out path. */
function stubStorage() {
  const map = new Map();
  globalThis.localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
  };
}

const roster = CARDS.slice(0, 10);
const season = () => createSeason({
  id: 'season-test',
  humans: [{ id: 'you', name: 'My Team', roster }],
  size: 4,
  length: 'short',
});

beforeEach(stubStorage);

describe('the card round trip', () => {
  it('stores keys and gives back cards', () => {
    const s = season();
    const stored = dehydrate(s);
    // Nothing on the wire is a card object.
    for (const t of stored.teams) {
      expect(t.roster.every(k => typeof k === 'string')).toBe(true);
    }
    expect(stored.teams[0].roster).toEqual(roster.map(cardKey));

    const back = hydrate(stored);
    expect(back.teams[0].roster).toEqual(roster);
    // Everything else survives untouched.
    expect(back.fixtures).toEqual(s.fixtures);
    expect(back.size).toBe(4);
  });

  it('drops a card that no longer exists rather than loading an undefined', () => {
    const stored = dehydrate(season());
    stored.teams[0].roster = [...stored.teams[0].roster.slice(0, 9), 'a_player_who_left_the_pool'];
    const back = hydrate(stored);
    expect(back.teams[0].roster).toHaveLength(9);
    expect(back.teams[0].roster.every(Boolean)).toBe(true);
  });

  it('hydrates nothing to null', () => {
    expect(hydrate(null)).toBeNull();
  });
});

describe('the signed-out store', () => {
  it('saves, loads and lists a season', async () => {
    const s = season();
    await saveSeason(null, s);
    const back = await loadSeason(null, s.id);
    expect(back.id).toBe(s.id);
    expect(back.teams[0].roster).toEqual(roster);

    const all = await listSeasons(null);
    expect(all.map(x => x.id)).toEqual([s.id]);
  });

  it('overwrites the same season rather than accumulating copies', async () => {
    const s = season();
    await saveSeason(null, s);
    await saveSeason(null, { ...s, round: 3 });
    const all = await listSeasons(null);
    expect(all).toHaveLength(1);
    expect(all[0].round).toBe(3);
  });

  it('lists newest first', async () => {
    await saveSeason(null, { ...season(), id: 'old', createdAt: 1 });
    await saveSeason(null, { ...season(), id: 'new', createdAt: 2 });
    const all = await listSeasons(null);
    expect(all.map(x => x.id)).toEqual(['new', 'old']);
  });

  it('deletes one', async () => {
    const s = season();
    await saveSeason(null, s);
    await deleteSeason(null, s.id);
    expect(await loadSeason(null, s.id)).toBeNull();
    expect(await listSeasons(null)).toEqual([]);
  });

  it('survives a storage that is not there at all', async () => {
    // A private window, or a browser with site data blocked. A season that
    // cannot be saved is still playable in this sitting, so nothing throws.
    delete globalThis.localStorage;
    await expect(saveSeason(null, season())).resolves.toBeTruthy();
    expect(await listSeasons(null)).toEqual([]);
  });
});
