// A RELOADED GAME IS PAID BY THE TERMS IT WAS DEALT WITH (2026-09-18).
//
// Two farms came from the Play tab re-reading this device when a finished
// game's results screen mounted: `opponent` was never saved and a reload forced
// it back to the coach, so a hotseat game — both benches steered to any score
// — claimed as a win against the coach; and the rung came from this device's
// setting, which the Season tab's Coach picker writes too, so a game played at
// Settler claimed at Deity after a switch and a reload.
//
// Static markup runs the state initializers — which is where the save is read
// — and no effects, so the claim props GameOver would be handed are what this
// reads, off a stand-in that prints them.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/AuthProvider.jsx', () => ({ useAuth: () => ({ user: { uid: 'u1' }, loading: false }) }));
vi.mock('../firebase/savedDecks.js', () => ({ loadDecks: async () => [] }));
vi.mock('../firebase/games.js', () => ({ loadRemoteGame: async () => null, saveRemoteGameIfCurrent: async () => ({ ok: true }) }));
vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ ask: async () => true, toast: () => {} }), notify: () => {} }));
// The last onPaid handed to the results screen, so a test can answer a claim.
const seen = { onPaid: null };
vi.mock('./game/GameOver.jsx', () => ({
  default: props => (seen.onPaid = props.onPaid) && <pre data-claim={JSON.stringify({
    mode: props.mode, aiLevel: props.aiLevel, rungDraw: props.rungDraw, claimId: props.claimId, paid: props.paid ?? null,
    fixtureFrom: props.fixtureFrom ?? null,
  })} />,
}));

import PlayTab from './PlayTab.jsx';
import { makeSave, gameTerms, LOCAL_KEY } from '../game/gameSave.js';

const finished = { done: true, teamA: { name: 'A', score: 150, stats: [], roster: [] }, teamB: { name: 'B', score: 60, stats: [], roster: [] }, log: [] };

let store;
beforeEach(() => {
  store = {};
  globalThis.localStorage = {
    getItem: k => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; },
  };
});
afterEach(() => { delete globalThis.localStorage; });

function claimAfterReload(save, deviceLevel) {
  store[LOCAL_KEY] = JSON.stringify(save);
  store['showdown.aiLevel'] = deviceLevel;
  const html = renderToStaticMarkup(<PlayTab teamA={[]} teamB={[]} />);
  const m = html.match(/data-claim="([^"]*)"/);
  expect(m, 'the results screen should render').toBeTruthy();
  return JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
}

describe('a reloaded finished game', () => {
  it('claims a hotseat game as hotseat — no rung, no "you", whatever the device says', () => {
    const save = makeSave(finished, null, 'hot1', { terms: gameTerms({ opponent: 'human' }) });
    const c = claimAfterReload(save, 'deity');
    expect(c.mode).toBe('hotseat');
    expect(c.aiLevel).toBe(null);
    expect(c.claimId).toBe('game:hot1');
  });

  it('claims at the SAVED rung after the device setting changed', () => {
    const save = makeSave(finished, null, 'set1', { terms: gameTerms({ opponent: 'ai', aiLevel: 'settler', rungDraw: true }) });
    const c = claimAfterReload(save, 'deity');
    expect(c.mode).toBe('ai');
    expect(c.aiLevel).toBe('settler');
    expect(c.rungDraw).toBe(true);
  });

  it('carries a Team Builder Rosters game\'s rungDraw false, so Deity pays it at most 1x', () => {
    const save = makeSave(finished, null, 'tb1', { terms: gameTerms({ opponent: 'ai', aiLevel: 'deity', rungDraw: false }) });
    expect(claimAfterReload(save, 'deity')).toMatchObject({ aiLevel: 'deity', rungDraw: false });
  });

  it('hands a paid game its stamp, so the screen shows it and does not claim again', () => {
    const save = makeSave(finished, null, 'p1', { terms: gameTerms({ opponent: 'ai', aiLevel: 'prince', rungDraw: true }), paid: { coins: 98, breakdown: [] } });
    expect(claimAfterReload(save, 'prince').paid).toMatchObject({ coins: 98 });
  });

  it('gives an old save (no id, no terms) an id and prices it as a custom game against the coach', () => {
    const old = { game: finished, preset: null, at: 1 };
    const c = claimAfterReload(old, 'deity');
    expect(c.claimId).toMatch(/^game:/);
    expect(c.rungDraw).toBe(false);
  });
});

// A PLAIN SEASON'S FIXTURE NAMES ITS SEASON (2026-09-18). The fixture's ids
// went to GameOver only for a dynasty or a friends league, so a plain season's
// claim reached the server with no seasonId: its rung was never read, a Deity
// season's win paid 1x as a custom game, and a Settler season played with the
// dial higher escaped the league's floor.
describe('a reloaded season fixture', () => {
  const fixture = { key: 's1:r1m1', seasonId: 's1', fixtureId: 'r1m1', home: 'you', away: 'cpu', humanIsHome: true, rosterA: [], rosterB: [] };

  it('hands GameOver its seasonId, keyed by the fixture', () => {
    const save = makeSave(finished, fixture, null, { terms: gameTerms({ opponent: 'ai', aiLevel: 'deity', rungDraw: false }) });
    const c = claimAfterReload(save, 'deity');
    expect(c.claimId).toBe('fixture:s1:r1m1');
    expect(c.fixtureFrom).toEqual({ dynastyId: null, leagueId: null, seasonId: 's1' });
  });

  it('still names the dynasty for a dynasty fixture', () => {
    const save = makeSave(finished, { ...fixture, dynastyId: 'd1', returnTab: 'dynasty' }, null, { terms: gameTerms({ opponent: 'ai', aiLevel: 'king', rungDraw: false }) });
    expect(claimAfterReload(save, 'prince').fixtureFrom).toEqual({ dynastyId: 'd1', leagueId: null, seasonId: 's1' });
  });

  it('names nothing for a sandbox game', () => {
    const save = makeSave(finished, null, 'sb1', { terms: gameTerms({ opponent: 'ai', aiLevel: 'deity', rungDraw: true }) });
    expect(claimAfterReload(save, 'deity').fixtureFrom).toBe(null);
  });
});

// A LATE ANSWER STAMPS ONLY ITS OWN GAME (2026-09-18). The claim's answer can
// land after Play Again and a new deal; PlayTab stamped whatever game was live
// then, so the new game was marked paid and never claimed.
describe('the paid stamp', () => {
  it('lands on the claimed game\'s save, and not on a game with another key', () => {
    const save = makeSave(finished, null, 'g1', { terms: gameTerms({ opponent: 'ai', aiLevel: 'prince', rungDraw: true }) });
    claimAfterReload(save, 'prince');
    expect(typeof seen.onPaid).toBe('function');
    // An answer for some other game — the one before a Play Again.
    seen.onPaid('game:g0', { coins: 77, breakdown: [] });
    expect(JSON.parse(store[LOCAL_KEY]).paid ?? null).toBe(null);
    // This game's answer.
    seen.onPaid('game:g1', { coins: 99, breakdown: [] });
    expect(JSON.parse(store[LOCAL_KEY]).paid).toMatchObject({ coins: 99 });
  });
});

// THE START BUTTONS SAY WHAT THEY PAY (2026-09-18): the picker promises "a
// win pays 150%", and above Prince two of the three starts cannot pay it.
describe('the pre-game screen above Prince', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, salary: 400 }));
  const render = level => {
    store['showdown.aiLevel'] = level;
    return renderToStaticMarkup(<PlayTab teamA={five} teamB={five} />);
  };

  it('says Team Builder Rosters and Quick Match pay at most the standard rate at Deity', () => {
    const html = render('deity');
    expect(html).toContain('You built the coach&#x27;s team: pays at most the standard rate');
    expect(html).toContain('Both teams drawn at the plain cap: pays at most the standard rate');
    expect(html).toMatch(/Only “Team A vs a random opponent” with the default Team B deck pays this rung/);
  });

  it('says nothing of the kind at Prince', () => {
    expect(render('prince')).not.toContain('pays at most the standard rate');
  });
});
