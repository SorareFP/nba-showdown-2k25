// THE LEAGUE SCREENS, RENDERED ONCE EACH without a browser or a sign-in.
//
// The tournament and shared-season screens sit behind Google sign-in, which
// no automated check here can do, so this is the smoke that catches what a
// build cannot: a prop read off the wrong shape, a helper that is not what
// the import says it is, a branch that throws on the state it was written
// for. Static markup only — effects do not run, so nothing here touches
// Firebase; the modules that would are mocked at the boundary.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Host Person' }, loading: false }),
}));
vi.mock('../../ui/dialogs.jsx', () => ({
  useDialogs: () => ({ ask: async () => true, toast: () => {} }),
}));

import LeagueLobby from './LeagueLobby.jsx';
import LeagueBracket from './LeagueBracket.jsx';
import LeagueMatch from './LeagueMatch.jsx';
import TournamentTab from '../TournamentTab.jsx';
import SeasonTab, { SeasonDashboard } from '../SeasonTab.jsx';
import { newLeague, entrantFor, addEntrant, startTournament, startSeason, applyResult, openFixtures } from '../../game/modes/league.js';
import { createSeason } from '../../game/modes/season.js';
import { seasonOfLeague, seasonForStart } from '../../firebase/leagues.js';
import { CARDS } from '../../game/cards.js';
import { cardKey } from '../../game/cardSets.js';

const roster = n => CARDS.slice(n * 10, n * 10 + 10);
const entrant = (uid, name, n) => entrantFor(uid, { name, roster: roster(n).map(cardKey) });
const seeded = (s = 3) => () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
const html = el => renderToStaticMarkup(el);

function tournamentLobby() {
  let l = newLeague({ id: 'T1', kind: 'tournament', name: 'Friday Bracket', hostUid: 'u1', settings: { size: 4, fee: 100 }, entrant: entrant('u1', 'Host Team', 0), joinCode: 'QWE789', now: 1 });
  l = addEntrant(l, entrant('u2', 'Second Team', 1), 2);
  return l;
}
function seasonLobby() {
  let l = newLeague({ id: 'S1', kind: 'season', name: 'Our League', hostUid: 'u1', settings: { size: 6, fee: 0, length: 'short' }, entrant: entrant('u1', 'Host Team', 0), joinCode: 'ABC123', now: 1 });
  l = addEntrant(l, entrant('u2', 'Second Team', 1), 2);
  return l;
}

describe('LeagueLobby', () => {
  it('shows the code, the entrants, the pool and the host\'s reason it cannot start yet', () => {
    const out = html(<LeagueLobby league={tournamentLobby()} uid="u1" onStart={() => {}} onCancel={() => {}} onLeave={() => {}} onBack={() => {}} />);
    expect(out).toContain('QWE789');
    expect(out).toContain('Host Team');
    expect(out).toContain('Second Team');
    expect(out).toContain('Prize pool · 400 coins');
    expect(out).toContain('Needs 2 more');
    expect(out).toContain('Cancel tournament');
  });

  it('gives a member Leave and a refund note instead of Start', () => {
    const out = html(<LeagueLobby league={tournamentLobby()} uid="u2" onStart={() => {}} onCancel={() => {}} onLeave={() => {}} onBack={() => {}} />);
    expect(out).toContain('Leave (refunds 100)');
    expect(out).not.toContain('Deal the bracket');
  });

  it('tells a season lobby how many AI teams will fill it', () => {
    const out = html(<LeagueLobby league={seasonLobby()} uid="u1" onStart={() => {}} onCancel={() => {}} onLeave={() => {}} onBack={() => {}} />);
    expect(out).toContain('4 AI teams');
    expect(out).toContain('Start the season');
  });
});

describe('LeagueBracket and LeagueMatch', () => {
  it('names the entrants in a dealt bracket and seats the home side as the room host', () => {
    let l = tournamentLobby();
    l = addEntrant(l, entrant('u3', 'Third Team', 2), 3);
    l = addEntrant(l, entrant('u4', 'Fourth Team', 3), 4);
    l = startTournament(l, { rng: seeded(), now: 5 });
    const out = html(<LeagueBracket league={l} uid="u1" />);
    expect(out).toContain('Semifinals');
    expect(out).toContain('Final');
    for (const n of ['Host Team', 'Second Team', 'Third Team', 'Fourth Team']) expect(out).toContain(n);

    const f = openFixtures(l).find(x => x.home === 'h:u1' || x.away === 'h:u1');
    const homeUid = f.home.slice(2);
    const asHome = html(<LeagueMatch league={l} fixture={f} uid={homeUid} onOpenRoom={() => {}} />);
    expect(asHome).toContain('Open the room');
    const awayUid = f.away.slice(2);
    const asAway = html(<LeagueMatch league={l} fixture={f} uid={awayUid} onOpenRoom={() => {}} />);
    expect(asAway).toContain('opens the room');
    expect(asAway).not.toContain('Open the room');
  });

  it('reads the attached room code once a room exists', () => {
    let l = tournamentLobby();
    l = addEntrant(l, entrant('u3', 'Third Team', 2), 3);
    l = addEntrant(l, entrant('u4', 'Fourth Team', 3), 4);
    l = startTournament(l, { rng: seeded(), now: 5 });
    const f = openFixtures(l)[0];
    const withRoom = { ...l, rooms: { [f.id]: { code: 'ROOM42', hostUid: f.home.slice(2), at: 6 } } };
    const out = html(<LeagueMatch league={withRoom} fixture={f} uid={f.away.slice(2)} onOpenRoom={() => {}} />);
    expect(out).toContain('ROOM42');
  });
});

describe('the tabs', () => {
  it('TournamentTab renders its first paint for a signed-in coach', () => {
    const out = html(<TournamentTab teamA={[]} collection={{}} />);
    expect(out).toContain('Loading tournaments');
  });

  it('SeasonTab renders its first paint', () => {
    const out = html(<SeasonTab teamA={[]} collection={{}} />);
    expect(out).toContain('Loading seasons');
  });

  it('the season Dashboard in league mode shows the league, the AI-sim button for the host, and no solo tools', () => {
    let l = seasonLobby();
    const humans = l.entrants.map(e => ({ id: e.id, name: e.name, uid: e.uid, roster: e.roster.map(k => CARDS.find(c => cardKey(c) === k)), deck: null, deckName: null }));
    const built = createSeason({ id: l.id, humans, size: 6, length: 'short', rng: seeded(9) });
    l = startSeason(l, seasonForStart(built), { now: 3 });
    const season = seasonOfLeague(l);
    const out = html(
      <SeasonDashboard
        season={season} uid="u1" commit={() => {}} onPlayFixture={() => {}} onBack={() => {}} onAbandon={null}
        league={l} onOpenRoom={() => {}} onSimAi={() => {}} onForfeit={() => {}}
      />,
    );
    expect(out).toContain('Our League');
    expect(out).toContain('Host Team');
    expect(out).toContain('Standings');
    // Player stats sit UNDER the standings, open on the league's leaders, and
    // carry the matchup columns (the user, 2026-09-10).
    expect(out.indexOf('Player stats')).toBeGreaterThan(out.indexOf('Standings'));
    expect(out).toMatch(/<option value="leaders" selected="">/);
    expect(out).toContain('League leaders (matchup +/-)');
    expect(out).toContain('M+/-');
    expect(out).toContain('aria-expanded="true"');
    expect(out).not.toContain('Sim it');
    expect(out).not.toContain('Abandon');
    expect(out).not.toContain('Sim the rest of the round');
    // The host sees the AI-sim button whenever the round holds an AI-vs-AI game.
    const by = new Map(season.teams.map(t => [t.id, t]));
    const aiGame = season.fixtures.some(f => f.round === 1 && !by.get(f.home).human && !by.get(f.away).human);
    if (aiGame) expect(out).toContain('Sim the AI games');

    // A member who is not the host sees the waiting line instead.
    const asMember = html(
      <SeasonDashboard
        season={season} uid="u2" commit={() => {}} onPlayFixture={() => {}} onBack={() => {}} onAbandon={null}
        league={l} onOpenRoom={() => {}} onSimAi={() => {}} onForfeit={() => {}}
      />,
    );
    expect(asMember).not.toContain('Sim the AI games');
    expect(asMember).toContain('Second Team');
  });

  it('the season Dashboard in league mode reports title money from the league\'s payouts when it is over', () => {
    let l = seasonLobby();
    l = { ...l, settings: { ...l.settings, size: 4 } };
    const humans = l.entrants.map(e => ({ id: e.id, name: e.name, uid: e.uid, roster: e.roster.map(k => CARDS.find(c => cardKey(c) === k)), deck: null, deckName: null }));
    const built = createSeason({ id: l.id, humans, size: 4, length: 'short', rng: seeded(9) });
    l = startSeason(l, seasonForStart(built), { now: 3 });
    let guard = 0;
    while (l.status === 'live' && guard++ < 100) {
      const f = openFixtures(l)[0];
      const homeWins = f.home.startsWith('h:') || !f.away.startsWith('h:');
      l = applyResult(l, { fixtureId: f.id, homeScore: homeWins ? 90 : 70, awayScore: homeWins ? 70 : 90, forfeit: f.home.startsWith('h:') && f.away.startsWith('h:') }, { now: 10 + guard }).league;
    }
    const season = seasonOfLeague(l);
    const out = html(
      <SeasonDashboard
        season={season} uid="u1" commit={() => {}} onPlayFixture={() => {}} onBack={() => {}} onAbandon={null}
        league={l} onOpenRoom={() => {}} onSimAi={() => {}} onForfeit={() => {}}
      />,
    );
    expect(out).toMatch(/paid to your account/);
    expect(out).not.toContain('Claim ');
  });
});
