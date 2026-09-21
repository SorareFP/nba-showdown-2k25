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

import DynastyTab, { DynastyView, DynastySetup, SeasonsPanel, dynastyPreset } from '../DynastyTab.jsx';
import { Negotiator, TradeDesk, FreeAgency, TradeInbox, soloMoves } from './DynastyScreens.jsx';
import {
  createDynasty, simDraft, draftPick, aiDraftChoice, onClock, finishDraft, closeSigning, nextFaDay,
  startSeason, endSeason, closeResign, drawLottery, fillRoster, rightsOf, freeAgentKeys, HUMAN_ID, DPHASE,
  tradeDeadlineRound, draftAvailable, passPick, closeRookies, rosterKeys, waive, claimWaiver, tradeValue,
  aiSalaryCap, aiSalaryOf, offerProblems,
} from '../../game/modes/dynasty.js';
import { rookieScale, APRON_DP } from '../../game/modes/dynastyMarket.js';
import { recordResult, roundFixtures, advance, totalRounds, PHASE, createSeason } from '../../game/modes/season.js';
import { buildAiLeague } from '../../game/modes/aiTeams.js';
import { getCardByKey } from '../../game/cardSets.js';

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

  it("an AI team's offer waits in your inbox with its worth to you and whom it would waive to make room", () => {
    // 2026-09-18: the AI proposes to you alone too. Built by hand — two of
    // theirs for one of yours into your full ten — so the relief line shows.
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const dealt = createDynasty({ id: 'T', size: 4, length: 'online', startMode: 'own', rng: seeded(6), human: { name: 'Alex Team', roster: brought } });
    const ai = dealt.teams.find(t => !t.human).id;
    const salary = k => getCardByKey(k).salary;
    // THEIR TEN DEALT BY HAND (2026-09-21): the ten cheapest cards outside
    // the draft, on 5-DP deals, and your books at 5 DP a man. Until today
    // their seeded ten stood, and on the committed free-agent pool "their
    // two they value least for your one they value most" was a deal the AI
    // itself would not make — the inbox rightly showed "have thought better
    // of it" where this test looks for the offer's worth. Two $30 men for
    // your best is a deal they want under any pool; their ceiling (aiSalaryCap,
    // 2026-09-18) has thousands of room; and an offer that is not legal
    // shows why instead of its relief (2026-09-18), so it is asserted legal.
    const cheap = dealt.draftPool.filter(k => getCardByKey(k) && !(dealt.draftClass?.keys ?? []).includes(k))
      .sort((p, q) => salary(p) - salary(q)).slice(0, 10);
    const contracts = Object.fromEntries(Object.entries(dealt.contracts).filter(([, c]) => c.teamId !== ai)
      .map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: 5 } : c]));
    for (const k of cheap) contracts[k] = { teamId: ai, dp: 5, years: 2, since: dealt.year, how: 'fill' };
    const d0 = { ...dealt, contracts, league: [...dealt.league, ...cheap], draftPool: dealt.draftPool.filter(k => !cheap.includes(k)) };
    expect(rosterKeys(d0, HUMAN_ID)).toHaveLength(10);
    expect(rosterKeys(d0, ai).sort()).toEqual([...cheap].sort());
    const give = [...rosterKeys(d0, ai)].sort((p, q) => tradeValue(d0, p, ai) - tradeValue(d0, q, ai)).slice(0, 2);
    const room = aiSalaryCap(d0) - aiSalaryOf(d0, ai) + give.reduce((t, k) => t + salary(k), 0);
    const offer = {
      id: 'ai-test', ai: true, status: 'open', from: ai, to: HUMAN_ID, year: d0.year, phase: d0.phase,
      give,
      get: [...rosterKeys(d0, HUMAN_ID)].filter(k => salary(k) <= room).sort((p, q) => tradeValue(d0, q, ai) - tradeValue(d0, p, ai)).slice(0, 1),
      givePicks: [], getPicks: [],
    };
    expect(offer.get).toHaveLength(1);
    const d = { ...d0, offers: [offer] };
    expect(offerProblems(d, offer)).toEqual([]);
    const out = html(<TradeInbox d={d} moves={solo} />);
    expect(out).toContain('Trade offers');
    expect(out).toContain('Accept');
    expect(out).toContain('Decline');
    expect(out).toContain('to you:');
    expect(out).toContain('To make room, you waive');
    expect(view(d)).toContain('Trade offers');
    expect(typeof solo.respond).toBe('function');
    expect(out).not.toContain('No longer possible');
    // Your man in it waived since: it says why, from your side, and Accept is off.
    const moved = waive(d, HUMAN_ID, offer.get[0]);
    const dead = html(<TradeInbox d={moved} moves={solo} />);
    expect(dead).toContain('No longer possible');
    expect(dead).toContain('under contract with you');
    expect(dead).toMatch(/<button[^>]*disabled[^>]*>Accept<\/button>/);
    // Nothing waiting, nothing shown.
    expect(html(<TradeInbox d={{ ...d0, offers: [] }} moves={solo} />)).toBe('');
  });

  it('a negotiation with a rival bid on the table names the rival', () => {
    const rng = seeded(8);
    const d0 = closeSigning(finishDraft(drafted(rng), { rng }), { rng });
    // BUILT (2026-09-18): the first rival bid the seeded market made was read,
    // and with none the test returned having checked nothing. A bid is put on
    // the table for a chosen free agent by a chosen AI team.
    const key = freeAgentKeys(d0)[0];
    const rival = d0.teams.find(t => !t.human);
    const d = { ...d0, fa: { ...d0.fa, rivals: { ...d0.fa.rivals, [key]: { teamId: rival.id, dp: 7, years: 2, ratio: 1.05 } } } };
    const out = html(<Negotiator d={d} cardKey={key} moves={solo} />);
    expect(out).toContain('have offered');
    expect(out).toContain(`${rival.name} have offered 7 DP`);
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

  it('the front office lists the waiver wire: a claim to put in, one you made, and your own waive (2026-09-18)', () => {
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const d0 = createDynasty({ id: 'W', size: 4, length: 'short', startMode: 'own', rng: seeded(6), human: { name: 'Alex Team', roster: brought } });
    const ai = d0.teams.find(t => !t.human).id;
    const theirs = rosterKeys(d0, ai)[0];
    const mine = rosterKeys(d0, HUMAN_ID)[0];
    // Your books at 1 DP a man, so the claim fits whatever the real deals were; your waive frees the seat.
    const cheap = { ...d0, contracts: Object.fromEntries(Object.entries(d0.contracts).map(([k, c]) => [k, c.teamId === HUMAN_ID ? { ...c, dp: 1 } : c])) };
    const d = waive(waive(cheap, ai, theirs), HUMAN_ID, mine);
    const page = view(d);
    expect(page).toContain('Waiver wire');
    expect(page).toContain('If he is claimed, his DP comes off your books');
    // An open claim — the button is live, not greyed with a reason.
    expect(page).toMatch(/<button(?![^>]*disabled)[^>]*>\s*Claim\s*<\/button>/);
    expect(view(claimWaiver(d, HUMAN_ID, theirs))).toContain('Claimed — withdraw');
    // No wire, no panel.
    expect(view(cheap)).not.toContain('Waiver wire');
  });

  it('a coach of seven with a claim that will land can start the season — the wire resolves first (2026-09-18)', () => {
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const d0 = createDynasty({ id: 'W', size: 4, length: 'short', startMode: 'own', rng: seeded(6), human: { name: 'Alex Team', roster: brought } });
    const ai = d0.teams.find(t => !t.human).id;
    const theirs = rosterKeys(d0, ai)[0];
    // Seven of yours at 1 DP a man; their man overpaid, so no AI team claims him.
    const contracts = { ...d0.contracts };
    for (const k of rosterKeys(d0, HUMAN_ID).slice(7)) delete contracts[k];
    for (const k of rosterKeys({ contracts }, HUMAN_ID)) contracts[k] = { ...contracts[k], dp: 1 };
    contracts[theirs] = { ...contracts[theirs], dp: 60, years: 2 };
    const waived = waive({ ...d0, contracts }, ai, theirs);
    const start = x => html(<FreeAgency d={x} moves={solo} />).match(/<button[^>]*>Start Year 1 →<\/button>/)[0];
    expect(start(waived)).toContain('disabled');
    expect(start(claimWaiver(waived, HUMAN_ID, theirs))).not.toContain('disabled');
  });
});

// THE COACH'S RUNG IN A DYNASTY GAME (2026-09-18): the fixture carries the
// league's rung, so PlayTab (`livePreset?.aiLevel ?? the device setting`)
// plays the coach at it, not at this device's difficulty.
describe("a dynasty fixture's rung", () => {
  it("carries the league's rung, and names Prince when the league has none", () => {
    expect(dynastyPreset({ id: 'x', aiLevel: 'deity' })).toEqual({ returnTab: 'dynasty', dynastyId: 'x', aiLevel: 'deity' });
    expect(dynastyPreset({ id: 'x', aiLevel: null }).aiLevel).toBe('prince');
    expect(dynastyPreset({ id: 'x' }).aiLevel).toBe('prince');
  });

  it("the screens say the AI's card-salary ceiling at this league's rung", () => {
    const brought = buildAiLeague(1, { rng: seeded(1) })[0].roster;
    const d = createDynasty({ id: 'R', size: 4, length: 'online', startMode: 'own', rng: seeded(2), human: { name: 'Me', roster: brought }, aiLevel: 'deity' });
    const desk = html(<TradeDesk d={d} moves={solo} defaultOpen />);
    expect(desk).toContain('$6,160');
    expect(desk).toContain('your side answers to DP alone');
  });
});
