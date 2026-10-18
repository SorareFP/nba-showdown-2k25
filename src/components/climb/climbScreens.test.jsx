// THE CLIMB'S SCREENS (docs/plans/2026-10-18-the-climb.md, Task 9), as static
// markup from real runs (run.js). The click-through is checked in the browser
// at ?demo=climb; here, what each screen shows for a given run.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import { ClimbStart, TrainingCamp, ClimbMap, RewardPicker, RestDay, RunOver } from './ClimbScreens.jsx';
import { newRun, chooseCamp, chooseStop, recordResult } from '../../game/modes/run.js';
import { CARDS } from '../../game/cards.js';
import { cardKey } from '../../game/cardSets.js';
import { getStrat } from '../../game/strats.js';

const html = el => renderToStaticMarkup(el);
const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const fresh = () => newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
const camped = () => chooseCamp(fresh(), { playbook: 'speed', boon: fresh().camp.boons[0] });
const won = () => recordResult(chooseStop(camped(), '1-0'), { stopId: '1-0', won: true, margin: 6, endMinutes: { [FIVE[0].id]: 12 } });
const noop = () => {};

describe('the start screen', () => {
  it('offers the rungs and the players who fit a five under the cap, and counts the rest', () => {
    const star = [...CARDS].sort((a, b) => b.salary - a.salary)[0];
    const cheap = FIVE.concat([...CARDS].sort((a, b) => a.salary - b.salary).slice(0, 3));
    const owned = [star, ...cheap].map(c => ({ key: cardKey(c), card: c, count: 1 }));
    const out = html(<ClimbStart owned={owned} onStart={noop} />);
    expect(out).toContain('Prince');
    expect(out).toContain('Deity');
    expect(out).toContain('$2,200');
    expect(out).toContain(FIVE[0].name.replace(/'/g, '&#x27;'));
    expect(out).not.toContain(`>${star.name}<`);
    expect(out).toContain('1 more of your players do not fit');
  });
});

describe('Training Camp', () => {
  it('marks the playbook that fits your five, once, and offers its boons', () => {
    const r = fresh();
    const out = html(<TrainingCamp run={r} onChoose={noop} />);
    expect(out.match(/fits your team/g)).toHaveLength(1);
    expect(out).toContain('Speed');
    expect(out).toContain('Paint');
    expect(out).toContain('Defense');
    expect(out.match(/data-boon=/g)).toHaveLength(3);
  });
});

describe('the map', () => {
  it('opens the three floor-1 stops and nothing else, with the pot and the cap', () => {
    const out = html(<ClimbMap run={camped()} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(out.match(/data-open="true"/g)).toHaveLength(3);
    for (const id of ['1-0', '1-1', '1-2']) expect(out).toContain(`data-stop="${id}" data-open="true"`);
    expect(out).toContain('data-stop="boss"');
    expect(out).toContain('Pot');
    expect(out).toContain('$2,200');
  });

  // THE WAY OUT (final review, 2026-10-18): a run that disagrees with its
  // ledger, or a bank that keeps refusing, must not lock a player out.
  it('offers a way to give the run up', () => {
    expect(html(<ClimbMap run={camped()} onGo={noop} onRetire={noop} onFreeRest={noop} onAbandon={noop} />)).toContain('Give up this run');
  });

  it('shows a player\'s carried fatigue', () => {
    const r = { ...camped(), fatigue: { [FIVE[0].id]: 12 } };
    expect(html(<ClimbMap run={r} onGo={noop} onRetire={noop} onFreeRest={noop} />)).toContain('12 min');
  });
});

describe('the reward screen', () => {
  it('shows the deck line, the three cards and Skip, and no player row when none is offered', () => {
    const r = won();
    const out = html(<RewardPicker run={r} onPickStrat={noop} onPickPlayer={noop} onSkip={noop} />);
    expect(out).toContain('15 cards');
    for (const id of r.offers.strats) expect(out).toContain(getStrat(id).name.replace(/&/g, '&amp;'));
    expect(out).toContain('Skip');
    expect(r.offers.players).toEqual([]);
    expect(out).not.toContain('data-player-offer');
  });
});

describe('the Rest Day', () => {
  it('offers the "+" of a kit card and says a card outside the kits has no upgrade yet', () => {
    const r = { ...camped(), status: 'rest', restAt: '2-0', deck: { ...camped().deck, green_light: 1 } };
    const out = html(<RestDay run={r} onRest={noop} onSmith={noop} />);
    expect(out).toContain('Catch &amp; Shoot+');
    expect(out).toContain('no upgrade yet');
    expect(out).toContain('Rest');
  });
});

describe('the end of a run', () => {
  it('shows a won pot to bank, and a lost one as lost', () => {
    const w = { ...camped(), status: 'won', cleared: ['1-0', 'boss'] };
    const out = html(<RunOver run={w} onBank={noop} onNew={noop} />);
    expect(out).toContain('Booster');
    expect(out).toMatch(/Bank/);
    const lost = html(<RunOver run={{ ...camped(), status: 'lost', cleared: ['1-0'] }} onBank={noop} onNew={noop} />);
    expect(lost).toContain('the pot is lost');
  });
});
