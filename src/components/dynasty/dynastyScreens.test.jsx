// THE DYNASTY SCREENS, RENDERED ONCE EACH PHASE without a browser or a
// sign-in — the same smoke as league/leagueScreens.test.jsx: a prop read off
// the wrong shape, a helper that is not what the import says, a branch that
// throws on the state it was written for. Static markup; effects do not run.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { uid: 'u1', displayName: 'Alex Person' }, loading: false }),
}));
vi.mock('../../ui/dialogs.jsx', () => ({
  useDialogs: () => ({ ask: async () => true, toast: () => {} }),
}));

import DynastyTab, { DynastyView, DynastySetup, SeasonsPanel } from '../DynastyTab.jsx';
import { Negotiator, TradeDesk, soloMoves } from './DynastyScreens.jsx';
import {
  createDynasty, simDraft, draftPick, aiDraftChoice, onClock, finishDraft, closeSigning, nextFaDay,
  startSeason, endSeason, closeResign, drawLottery, fillRoster, rightsOf, freeAgentKeys, HUMAN_ID, DPHASE,
  tradeDeadlineRound, draftAvailable, passPick, closeRookies,
} from '../../game/modes/dynasty.js';
import { rookieScale, APRON_DP } from '../../game/modes/dynastyMarket.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE, createSeason } from '../../game/modes/season.js';
import { buildAiLeague } from '../../game/modes/aiTeams.js';

const seeded = (s = 5) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const html = el => renderToStaticMarkup(el);
const view = d => html(<DynastyView d={d} uid="u1" commit={() => {}} onPlayFixture={() => {}} onBack={() => {}} onAbandon={() => {}} />);
const solo = soloMoves(() => null, 'you');

function fantasy(seed = 3) {
  return createDynasty({ id: 'F', size: 4, length: 'short', startMode: 'fantasy-full', rng: seeded(seed), human: { name: 'Alex Team' } });
}
function drafted(rng) {
  let x = fantasy();
  for (let g = 0; g < 200; g += 1) {
    x = simDraft(x, { rng });
    const c = onClock(x);
    if (!c) break;
    x = draftPick(x, c.teamId, aiDraftChoice(x, c.teamId, rng));
  }
  return x;
}
function finish(d) {
  let s = d.season;
  for (let r = 0; r < totalRounds(s); r += 1) {
    for (const f of roundFixtures(s)) if (!f.result) s = recordResult(s, { fixtureId: f.id, home: f.home, away: f.away, homeScore: 100, awayScore: 90 });
    s = advance(s);
  }
  for (let g = 0; g < 20 && s.phase !== PHASE.done; g += 1) {
    const m = s.bracket.matches.find(x => !x.winner && x.a && x.b);
    s = recordResult(s, { fixtureId: m.id, home: m.a, away: m.b, homeScore: 120, awayScore: 100 });
  }
  return { ...d, season: s };
}

describe('the tab', () => {
  it('renders its first paint', () => {
    expect(html(<DynastyTab teamA={[]} collection={{}} />)).toContain('Loading dynasties');
  });

  it('setup offers the three starts and shows the fantasy nerf on the coins', () => {
    const out = html(<DynastySetup teamA={[]} collection={{}} uid="u1" onStart={() => {}} onCancel={() => {}} />);
    for (const t of ['Bring your team', 'Fantasy draft', 'random pool']) expect(out).toContain(t);
    expect(out).toContain('Fantasy draft ×0.5');
    expect(out).toContain('To the draft room');
  });

  it('lists a season in progress under One season, with the way back into it', () => {
    const roster = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const s = createSeason({ humans: [{ id: 'you', name: 'Alex Team', roster }], size: 4, length: 'online', rng: seeded(2) });
    const out = html(<SeasonsPanel seasons={[s]} leagues={[]} uid="u1" onOpen={() => {}} />);
    for (const t of ['One season', 'Resume', 'New season', 'Join a shared season', 'All seasons']) expect(out).toContain(t);
  });
});

describe('each phase', () => {
  it('the draft room puts you on the clock with your running total', () => {
    const d = simDraft(fantasy());
    const out = view(d);
    expect(out).toContain('The fantasy draft');
    expect(out).toContain('You are on the clock');
    expect(out).toContain('Your picks');
    expect(out).toContain('Front office');
  });

  it('signing lists your draftees and the negotiating table', () => {
    const rng = seeded(7);
    const d = finishDraft(drafted(rng), { rng });
    expect(d.phase).toBe(DPHASE.signing);
    const out = view(d);
    expect(out).toContain('Sign your draftees');
    expect(out).toContain('His ask');
    expect(out).toContain('Meet his ask');
  });

  it('free agency shows the day, the market and the rival offers; the preseason the ready check', () => {
    const rng = seeded(8);
    let d = closeSigning(finishDraft(drafted(rng), { rng }), { rng });
    const out = view(d);
    expect(out).toContain('Free agency — week 1 of 3');
    expect(out).toContain('Next week');
    for (let i = 0; i < 3; i += 1) d = nextFaDay(d, { rng });
    const pre = view(d);
    expect(pre).toContain('Preseason');
    expect(pre).toContain('Start Year 1');
  });

  it('the trade desk opens between seasons with both rosters and no verdict until something is picked', () => {
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const d = createDynasty({ id: 'T', size: 4, length: 'online', startMode: 'own', rng: seeded(6), human: { name: 'Alex Team', roster: brought } });
    const out = html(<TradeDesk d={d} moves={solo} defaultOpen />);
    expect(out).toContain('Trades');
    expect(out).toContain('You send');
    expect(out).toContain('Make the trade');
    expect(out).toContain('What would it take?');
    expect(out).not.toContain('Not interested');
    // In season it stays open until the deadline (60% of the regular season), then closes.
    const inSeason = startSeason(d, { rng: seeded(7) });
    expect(html(<TradeDesk d={inSeason} moves={solo} defaultOpen />)).toContain('Trade deadline');
    const late = { ...inSeason, season: { ...inSeason.season, round: tradeDeadlineRound(inSeason.season) + 1 } };
    expect(html(<TradeDesk d={late} moves={solo} defaultOpen />)).toBe('');
  });

  it('a negotiation with a rival bid on the table names the rival', () => {
    const rng = seeded(8);
    const d = closeSigning(finishDraft(drafted(rng), { rng }), { rng });
    const key = Object.keys(d.fa.rivals)[0];
    if (!key) return;
    const out = html(<Negotiator d={d} cardKey={key} moves={solo} />);
    expect(out).toContain('have offered');
  });

  it('the season is Season mode\'s own Dashboard, and the offseason walks the window, the lottery and the draft', () => {
    const rng = seeded(9);
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    let d = createDynasty({ id: 'O', size: 4, length: 'short', startMode: 'own', rng, human: { name: 'Alex Team', roster: brought } });
    expect(view(d)).toContain('Preseason');
    d = startSeason(d, { rng });
    const season = view(d);
    expect(season).toContain('Standings');
    expect(season).toContain('Year 1');
    const closing = view(finish(d));
    expect(closing).toContain('Close out Year 1');

    d = endSeason(finish(d), { rng });
    const window = view(d);
    expect(window).toContain('The years');
    if (rightsOf(d, HUMAN_ID, 'expiring').length) expect(window).toContain('exclusive window');
    d = closeResign(d);
    expect(view(d)).toContain('Draw the lottery');
    d = drawLottery(d, { rng });
    expect(view(d)).toContain('draft');
    expect(freeAgentKeys(fillRoster(d, HUMAN_ID)).length).toBeGreaterThan(0);
  });
  it('the rookie draft prices the slot and keeps a budget to the apron; an unsigned pick follows you into free agency', () => {
    const rng = seeded(9);
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    let d = createDynasty({ id: 'R', size: 4, length: 'short', startMode: 'own', rng, human: { name: 'Alex Team', roster: brought } });
    d = endSeason(finish(startSeason(d, { rng })), { rng });
    d = simDraft(drawLottery(closeResign(d), { rng }), { rng });
    const c = onClock(d);
    expect(c?.teamId).toBe(HUMAN_ID);
    const room = view(d);
    expect(room).toContain(`This slot signs at ${rookieScale(c.n, 4).dp} DP`);
    expect(room).toMatch(new RegExp(`of room to the ${APRON_DP} apron|past the ${APRON_DP} apron`));
    d = draftPick(d, HUMAN_ID, draftAvailable(d)[0]);
    for (let g = 0; g < 20; g += 1) {
      d = simDraft(d, { rng });
      if (!onClock(d)) break;
      d = passPick(d, HUMAN_ID);
    }
    d = finishDraft(d, { rng });
    expect(view(d)).toContain('Sign your picks');
    d = closeRookies(d, { rng });
    expect(rightsOf(d, HUMAN_ID, 'rookie')).toHaveLength(1);
    const fa = view(d);
    expect(fa).toContain('rights until the season starts');
    expect(fa).toContain(`${rookieScale(c.n, 4).dp}</strong> DP × 3`);
  });
});
