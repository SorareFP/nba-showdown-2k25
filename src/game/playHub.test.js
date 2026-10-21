import { describe, it, expect } from 'vitest';
import { hubCards, climbStatus, dynastyStatus, seasonStatus } from './playHub.js';
import { newRun, chooseCamp, chooseStop, recordResult, openStops } from './modes/run.js';
import { CARDS } from './cards.js';
import { cardKey } from './cardSets.js';
import { DPHASE } from './modes/dynasty.js';

const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const start = () => newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
const camped = () => { const r = start(); return chooseCamp(r, { playbook: 'speed', boon: r.camp.boons[0] }); };
const ids = cards => cards.map(c => c.id);
const card = (cards, id) => cards.find(c => c.id === id);
const save = { game: { done: false, quarter: 2, section: 1, teamA: { name: 'A', score: 20 }, teamB: { name: 'B', score: 18 } }, at: 1000 };

describe('the Play hub', () => {
  it('lists every mode in a fixed order, the game in progress first only when there is one', () => {
    expect(ids(hubCards())).toEqual(['climb', 'quick', 'season', 'dynasty', 'tournament', 'pvp']);
    expect(ids(hubCards({ save, now: 1000 }))).toEqual(['game', 'climb', 'quick', 'season', 'dynasty', 'tournament', 'pvp']);
    expect(ids(hubCards({ save: { game: { ...save.game, done: true } } }))[0]).toBe('climb');
  });

  it('resumes the game in progress on the board, and holds Quick game until it is done', () => {
    const cards = hubCards({ save, now: 1000 });
    expect(card(cards, 'game').action).toEqual({ label: 'Resume', to: 'play' });
    expect(card(cards, 'game').status).toContain('Q2');
    expect(card(cards, 'quick').action.disabled).toBe(true);
    expect(card(cards, 'quick').note).toMatch(/one game at a time/i);
    expect(card(hubCards(), 'quick').action.disabled).toBe(false);
    expect(card(hubCards({ save, fromOther: true }), 'game').action.label).toBe('Resume here');
  });

  it('starts a mode with nothing going, and resumes one that is', () => {
    const fresh = hubCards();
    expect(card(fresh, 'climb').action).toMatchObject({ label: 'Start a climb', to: 'climb' });
    expect(card(fresh, 'season').action).toEqual({ label: 'Start a season', to: 'season', opts: { action: 'new' } });
    expect(card(fresh, 'dynasty').action.label).toBe('Start a dynasty');
    expect(card(fresh, 'pvp').action.label).toBe('Find a game');
    const going = hubCards({ run: camped(), pvp: { roomCode: 'ABCD', myRole: 'A' } });
    expect(card(going, 'climb').action.label).toBe('Resume');
    expect(card(going, 'pvp')).toMatchObject({ status: 'In room ABCD', action: { label: 'Resume', to: 'pvp' } });
  });

  it('claims nothing while the saves load', () => {
    const cards = hubCards({ run: camped(), loading: true });
    expect(card(cards, 'climb').status).toBeNull();
    expect(card(cards, 'climb').action.label).toBe('Open');
    expect(card(cards, 'season').action).toEqual({ label: 'Open', to: 'season', opts: undefined });
  });

  it('opens the one season in progress straight away, and the list for several', () => {
    const row = { kind: 'solo', id: 's1', title: 'Short season · 8 teams', record: '3–1', next: { home: false, opponent: 'Lakers' } };
    expect(seasonStatus([row])).toBe('Short season · 8 teams · 3–1 · next: at Lakers');
    expect(card(hubCards({ seasons: [row] }), 'season').action).toEqual({ label: 'Resume', to: 'season', opts: { seasonId: 's1' } });
    expect(card(hubCards({ seasons: [{ ...row, kind: 'league', id: 'L1' }] }), 'season').action.opts).toEqual({ leagueId: 'L1' });
    expect(card(hubCards({ seasons: [row, { ...row, id: 's2' }] }), 'season')).toMatchObject({ status: '2 in progress', action: { opts: undefined } });
  });

  it('counts dynasties and tournaments still going, never finished or cancelled ones', () => {
    expect(dynastyStatus([{ phase: DPHASE.done, name: 'Old' }])).toBeNull();
    expect(dynastyStatus([], [{ kind: 'dynasty', status: 'live', name: 'Friday League' }])).toBe('Friday League · with friends');
    expect(dynastyStatus([{ phase: DPHASE.season, name: 'A' }], [{ kind: 'dynasty', status: 'lobby', name: 'B' }])).toBe('2 in progress');
    const leagues = [{ kind: 'tournament', status: 'live', name: 'Bracket' }, { kind: 'tournament', status: 'cancelled', name: 'Gone' }];
    expect(card(hubCards({ leagues }), 'tournament')).toMatchObject({ status: 'Bracket', action: { label: 'Resume' } });
  });
});

describe('a climb in a line', () => {
  it('says where the run stands', () => {
    expect(climbStatus(null)).toBeNull();
    expect(climbStatus(start())).toBe('Training Camp next');
    const r = camped();
    expect(climbStatus(r)).toBe('Act I: floor 1 ahead');
    const stop = openStops(r)[0].id;
    expect(climbStatus(chooseStop(r, stop))).toBe('Act I, a floor 1 game under way');
    const won = recordResult(chooseStop(r, stop), { stopId: stop, won: true, margin: 5 });
    expect(climbStatus(won)).toMatch(/^A reward to choose · pot \d+/);
    expect(climbStatus({ ...won, status: 'map' })).toMatch(/^Act I: floor 1 cleared · pot \d+/);
  });
});
