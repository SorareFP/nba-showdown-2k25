// FRIENDS, AND THE CARDS THEY NEED (2026-10-11) — docs/plans/2026-10-11-friends-design.md.
import { describe, it, expect } from 'vitest';
import {
  FRIENDS_MAX, NEED_WITHIN, NEEDS_MAX, CODE_LENGTH, CODE_ALPHABET,
  makeFriendCode, normalizeCode, goalName, needsFromCollection, sameNeeds, cleanNeeds,
  wantsByCard, wantText, friendNoteFor, listJoin, chunk,
} from './friends.js';
import { GOALS } from './collections.js';
import { KEY_ALIASES, canonicalKey } from './cardSets.js';

const team = GOALS.find(g => g.kind === 'team' && g.league === 'NBA' && g.requires.length >= 5);
const collected = keys => Object.fromEntries(keys.map(k => [k, { type: 'player', count: 1, collected: true }]));
const ofGoal = (needs, id) => needs.filter(n => n.goalId === id);

describe('friend codes', () => {
  it('are six characters from an alphabet with no look-alikes', () => {
    expect(CODE_LENGTH).toBe(6);
    expect(CODE_ALPHABET).not.toMatch(/[0O1I]/);
    let i = 0;
    const code = makeFriendCode(() => (i += 0.13) % 1);
    expect(code).toHaveLength(6);
    expect([...code].every(ch => CODE_ALPHABET.includes(ch))).toBe(true);
  });

  it('normalise what a person types, and refuse what cannot be a code', () => {
    expect(normalizeCode(' ab c-dEf ')).toBe('ABCDEF');
    expect(normalizeCode('ABC')).toBeNull();
    expect(normalizeCode('ABCDE0')).toBeNull();      // 0 is not in the alphabet
    expect(normalizeCode(null)).toBeNull();
  });
});

describe('what counts as a need', () => {
  it('is every missing card of an unclaimed collection 1 or 2 short', () => {
    const two = needsFromCollection(collected(team.requires.slice(2)), new Set());
    expect(ofGoal(two, team.id).map(n => n.cardKey).sort()).toEqual(team.requires.slice(0, 2).sort());
    expect(ofGoal(two, team.id)[0]).toMatchObject({ missing: 2, goalLabel: goalName(team) });
    const three = needsFromCollection(collected(team.requires.slice(3)), new Set());
    expect(ofGoal(three, team.id)).toEqual([]);
    expect(NEED_WITHIN).toBe(2);
  });

  it('skips a claimed collection and a card already held as a spare', () => {
    const c = collected(team.requires.slice(1));
    expect(ofGoal(needsFromCollection(c, new Set([team.id])), team.id)).toEqual([]);
    const withSpare = { ...collected(team.requires.slice(2)), [team.requires[0]]: { type: 'player', count: 1 } };
    expect(ofGoal(needsFromCollection(withSpare, new Set()), team.id).map(n => n.cardKey)).toEqual([team.requires[1]]);
  });

  it('names a collection the way a person says it', () => {
    expect(goalName({ kind: 'team', label: 'ATL', league: 'NBA' })).toBe('Atlanta Hawks collection');
    expect(goalName({ kind: 'conference', label: 'Eastern Conference' })).toBe('Eastern Conference collection');
    expect(goalName({ kind: 'set', label: 'Complete Super Season Set' })).toBe('Super Season set');
  });

  it('compares two lists by content, not order', () => {
    const a = [{ cardKey: 'x', goalId: 'g', goalLabel: 'G', missing: 1 }, { cardKey: 'y', goalId: 'g', goalLabel: 'G', missing: 1 }];
    expect(sameNeeds(a, [...a].reverse())).toBe(true);
    expect(sameNeeds(a, [a[0]])).toBe(false);
    expect(sameNeeds(a, [{ ...a[0], missing: 2 }, a[1]])).toBe(false);
  });
});

describe('the server keeps only well-formed needs', () => {
  it('drops junk and caps the list', () => {
    const good = { cardKey: team.requires[0], goalId: team.id, goalLabel: goalName(team), missing: 1 };
    expect(cleanNeeds(null)).toEqual([]);
    expect(cleanNeeds('nope')).toEqual([]);
    expect(cleanNeeds([good, { ...good, cardKey: 'Nobody_Real' }, { ...good, goalId: 'no-such-goal' }, { ...good, missing: 7 }, 42, null])).toEqual([good]);
    expect(cleanNeeds(Array(500).fill(good))).toHaveLength(NEEDS_MAX);
    expect(cleanNeeds([{ ...good, goalLabel: 'x'.repeat(500) }])[0].goalLabel).toHaveLength(60);
  });
});

describe('who wants a card, and what the dot says', () => {
  const need = (cardKey, goalLabel, missing) => ({ cardKey, goalId: 'g', goalLabel, missing });
  const friends = [
    { uid: 'u1', name: 'Sam', needs: [need('A', 'Atlanta Hawks collection', 2), need('A', 'Super Season set', 1)] },
    { uid: 'u2', name: 'Alex', needs: [need('A', 'Boston Celtics collection', 1), need('B', 'Boston Celtics collection', 1)] },
    { uid: 'u3', name: 'Jo' },
  ];

  it('one entry per friend, at their nearest collection', () => {
    const w = wantsByCard(friends);
    expect(w.get('A')).toEqual([
      { uid: 'u1', name: 'Sam', goalLabel: 'Super Season set', missing: 1 },
      { uid: 'u2', name: 'Alex', goalLabel: 'Boston Celtics collection', missing: 1 },
    ]);
    expect(w.get('B')).toHaveLength(1);
    expect(w.has('C')).toBe(false);
  });

  it('reads one friend in full, several by name', () => {
    expect(wantText(wantsByCard(friends).get('B'))).toBe('Alex needs this for the Boston Celtics collection (1 to go). List it?');
    expect(wantText(wantsByCard(friends).get('A'))).toBe('Sam and Alex need this for a collection. List it?');
    expect(listJoin(['A', 'B', 'C'])).toBe('A, B and C');
  });

  it('matches a card held or listed under an old key', () => {
    const [oldKey, newKey] = Object.entries(KEY_ALIASES)[0];
    expect(canonicalKey(oldKey)).toBe(newKey);
    const w = wantsByCard([{ uid: 'u1', name: 'Sam', needs: [need(oldKey, 'Super Season set', 1)] }]);
    expect(w.has(newKey)).toBe(true);
    expect(friendNoteFor(w, oldKey)).toBe('Sam needs this one');
    expect(friendNoteFor(w, 'Nobody_Real')).toBeNull();
  });

  it('splits a long list into query-sized chunks', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 30)).toEqual([]);
    expect(FRIENDS_MAX).toBe(30);
  });
});
