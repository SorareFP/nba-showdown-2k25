// A DYNASTY WITH FRIENDS ON SCREEN — the same smoke as dynastyScreens.test.jsx,
// for what friends add: the pick clock, the ready button, sealed bids, offers
// between coaches, the lobby and the setup. Static markup; effects do not run.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Alex Person' }, loading: false }),
}));
vi.mock('../../ui/dialogs.jsx', () => ({
  useDialogs: () => ({ ask: async () => true, toast: () => {} }),
}));

import { DraftRoom, FreeAgency, TradeDesk, PhaseButton, BidPanel } from './DynastyScreens.jsx';
import { friendsMoves, TradeInbox, FriendsSetup, friendsPreset } from './FriendsDynasty.jsx';
import LeagueLobby from '../league/LeagueLobby.jsx';
import { createDynasty, onClock, DPHASE, rosterKeys, freeAgentKeys, tradeProblems } from '../../game/modes/dynasty.js';
import { runDraftClock, proposeTrade, setReady, advancePhase, PICK_CLOCK_MS } from '../../game/modes/dynastyFriends.js';
import { newLeague, entrantFor } from '../../game/modes/league.js';
import { buildAiLeague } from '../../game/modes/aiTeams.js';

const seeded = (s = 5) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const html = el => renderToStaticMarkup(el);
const A = 'h:a';
const B = 'h:b';
const T0 = Date.now();
/** The dynasty as coach `me` sees it, and the moves their screen gets. */
const as = (d, me) => ({ ...d, humanId: me });
const movesFor = (d, me, extra = {}) => friendsMoves({ d, me, send: async () => null, ...extra });

function fantasy() {
  return createDynasty({ id: 'F', size: 4, length: 'online', startMode: 'fantasy-full', rng: seeded(3), humans: [{ id: A, name: 'Ann' }, { id: B, name: 'Bo' }] });
}
function own() {
  const [ra, rb] = buildAiLeague(2, { rng: seeded(1) }).map(t => t.roster);
  return createDynasty({ id: 'O', size: 4, length: 'online', startMode: 'own', rng: seeded(3), humans: [{ id: A, name: 'Ann', roster: ra }, { id: B, name: 'Bo', roster: rb }] });
}
function toFreeAgency() {
  let d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
  for (let i = 0; i < 40 && d.phase === DPHASE.draft; i += 1) d = runDraftClock(d, { now: T0 + (i + 1) * PICK_CLOCK_MS, rng: seeded(5 + i) });
  return advancePhase(setReady(setReady(d, A), B), { rng: seeded(6) });
}

describe('a dynasty with friends, on screen', () => {
  it('the draft room shows the pick clock and none of the solo sim buttons', () => {
    const d = runDraftClock(fantasy(), { now: T0, rng: seeded(4) });
    const c = onClock(d);
    const out = html(<DraftRoom d={as(d, c.teamId)} moves={movesFor(d, c.teamId)} />);
    expect(out).toContain('You are on the clock');
    expect(out).toMatch(/\d+h \d+m left/);
    expect(out).toContain('twelve hours');
    expect(out).not.toContain('Auto-draft');
    expect(out).not.toContain('Sim to my pick');
  });

  it('a phase button says who the phase is waiting on', () => {
    const d = setReady(own(), A);
    expect(html(<PhaseButton moves={movesFor(d, A)} label="Start Year 1 →" onDone={() => {}} />)).toContain('Waiting on Bo');
    const theirs = html(<PhaseButton moves={movesFor(d, B)} label="Start Year 1 →" onDone={() => {}} />);
    expect(theirs).toContain('ready · Start Year 1');
    expect(theirs).toContain('Everyone else is ready');
  });

  it('free agency is sealed bids — your own bids listed, a bid table in place of haggling', () => {
    const d = toFreeAgency();
    expect(d.phase).toBe(DPHASE.freeAgency);
    const key = freeAgentKeys(d)[0];
    const moves = movesFor(d, A, { bids: [{ key, dp: 5, years: 2 }] });
    const out = html(<FreeAgency d={as(d, A)} moves={moves} />);
    expect(out).toContain('Sealed bids');
    expect(out).toContain('Your sealed bids');
    expect(out).toContain('ready · Next week');
    const panel = html(<BidPanel d={as(d, A)} cardKey={key} moves={moves} />);
    expect(panel).toContain('Your sealed bid: 5 DP');
    expect(panel).toContain('Withdraw my bid');
  });

  it('the trade desk offers a coach a trade, and the inbox answers it', () => {
    // BUILT (2026-09-18): both coaches at 5 DP a man, so the swap is legal
    // whatever the pool dealt them (one card changing team put it past Bo's
    // apron) and only the desk and the inbox are under test.
    const d0 = own();
    const d = { ...d0, contracts: Object.fromEntries(Object.entries(d0.contracts).map(([k, c]) => [k, c.teamId === A || c.teamId === B ? { ...c, dp: 5 } : c])) };
    expect(html(<TradeDesk d={as(d, A)} moves={movesFor(d, A)} defaultOpen />)).toContain('Offer it to Bo');
    const deal = { from: A, to: B, give: [rosterKeys(d, A)[0]], get: [rosterKeys(d, B)[0]] };
    expect(tradeProblems(d, deal)).toEqual([]);
    const x = proposeTrade(d, deal, { id: 'o1' });
    const theirs = html(<TradeInbox d={as(x, B)} moves={movesFor(x, B)} />);
    expect(theirs).toContain('Accept');
    expect(theirs).toContain('Decline');
    expect(html(<TradeInbox d={as(x, A)} moves={movesFor(x, A)} />)).toContain('Withdraw');
  });

  it('the lobby says how the dynasty starts; the setup opens a lobby', () => {
    const l = newLeague({
      id: 'dyn', kind: 'dynasty', name: 'Ours', hostUid: 'u1', settings: { size: 4, length: 'online', startMode: 'fantasy-full' },
      entrant: entrantFor('u1', { name: 'Ann' }), joinCode: 'ABC123', now: 1,
    });
    const lobby = html(<LeagueLobby league={l} uid="u1" onStart={() => {}} onCancel={() => {}} onLeave={() => {}} onBack={() => {}} />);
    expect(lobby).toContain('Start the dynasty');
    expect(lobby).toContain('Fantasy draft');
    expect(lobby).toContain('drafted when the dynasty starts');
    expect(html(<FriendsSetup teamA={[]} collection={{}} uid="u1" onCancel={() => {}} onCreated={() => {}} />)).toContain('Open the lobby');
  });
});

// The league's rung plays a game against an AI team with friends too (2026-09-18).
describe("a friends dynasty fixture's rung", () => {
  it("carries the league's rung, and names Prince when the league has none", () => {
    expect(friendsPreset({ aiLevel: 'king' }, 'L1')).toEqual({ returnTab: 'dynasty', leagueId: 'L1', aiLevel: 'king' });
    expect(friendsPreset({ aiLevel: null }, 'L1').aiLevel).toBe('prince');
  });
});
