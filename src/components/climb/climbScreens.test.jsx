// THE CLIMB'S SCREENS (docs/plans/2026-10-18-the-climb.md, Task 9), as static
// markup from real runs (run.js). The click-through is checked in the browser
// at ?demo=climb; here, what each screen shows for a given run.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import { ClimbStart, TrainingCamp, ClimbMap, RewardPicker, RestDay, RunOver, practiceTiles } from './ClimbScreens.jsx';
import { baseId } from '../../game/strats.js';
import { newRun, chooseCamp, chooseStop, recordResult, bossTeam } from '../../game/modes/run.js';
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

describe("the start screen's saved fives", () => {
  it('offers a five that still works, and says why one does not', () => {
    const owned = FIVE.map(c => ({ key: cardKey(c), card: c, count: 1 }));
    const good = { id: 't1', name: 'Bench Mob', climb: true, players: FIVE.map(cardKey), salary: 2000 };
    const sold = { id: 't2', name: 'Old Guard', climb: true, players: [...FIVE.slice(0, 4).map(cardKey), 'gone:Nobody'], salary: 1900 };
    const out = html(<ClimbStart owned={owned} saved={[good, sold]} onStart={noop} onSaveFive={noop} />);
    expect(out).toContain('Your Climb fives');
    expect(out).toMatch(/data-five="t1"(?![^>]*disabled)/);
    expect(out).toMatch(/data-five="t2"[^>]*disabled/);
    expect(out).toContain('no longer exists');
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
    expect(out).toContain(`Boss · ${bossTeam(camped()).name}`);
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

// THE PRACTICE SCREEN (the user, 2026-10-19): "the practice option should
// show all the cards in your deck, and you should be able to look at them,
// and there should be a checkbox that toggles the photos to show their
// 'practiced' versions."
describe('the Practice screen', () => {
  const restRun = () => ({
    ...camped(), status: 'rest', restAt: '2-0',
    deck: { ...camped().deck, catch_and_shoot: 1, 'catch_and_shoot+': 1, green_light: 1 },
  });

  it('lays out every card in the deck once, plain by default and practiced on the toggle', () => {
    const r = restRun();
    const plain = practiceTiles(r, false);
    expect(plain.map(t => t.id).sort()).toEqual([...new Set(Object.keys(r.deck).map(baseId))].sort());
    expect(plain.find(t => t.id === 'catch_and_shoot')).toMatchObject({ count: 2, plusCount: 1, canPractice: true, upgradeable: true, faceId: 'catch_and_shoot' });
    expect(plain.find(t => t.id === 'green_light')).toMatchObject({ canPractice: false, upgradeable: false, faceId: 'green_light' });
    const up = practiceTiles(r, true);
    expect(up.find(t => t.id === 'catch_and_shoot').faceId).toBe('catch_and_shoot+');
    expect(up.find(t => t.id === 'green_light').faceId).toBe('green_light');
    expect(practiceTiles({ ...r, deck: { 'catch_and_shoot+': 2 } }, false)[0]).toMatchObject({ count: 2, plusCount: 2, canPractice: false });
  });

  it('shows a face per card, the toggle, Rest, and Practice only where a plain kit copy is left', () => {
    const r = restRun();
    const out = html(<RestDay run={r} onRest={noop} onPractice={noop} />);
    expect(out).toContain('Show practiced versions');
    expect(out).toContain('type="checkbox"');
    expect(out.match(/data-practice-tile=/g)).toHaveLength(practiceTiles(r, false).length);
    expect(out).toContain('/cards/thumbs/strats/catch_and_shoot.webp');
    expect(out).toMatch(/data-practice="catch_and_shoot"/);
    expect(out).not.toMatch(/data-practice="green_light"/);
    expect(out).toContain('no upgrade yet');
    expect(out).toContain('>Rest<');
    expect(out).not.toMatch(/smith/i);
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

// A LOOK FROM THE REST DAY (the user, 2026-10-19): the map read-only, you at
// the Rest Day, the stops after it outlined, the way back, nothing tappable.
const atRestDay = () => {
  const r = camped();
  const stops = r.map.floors.flat();
  const rest = stops.find(s => s.kind === 'rest' && s.floor >= 2 && stops.some(p => p.next.includes(s.id)));
  const from = stops.find(p => p.next.includes(rest.id));
  return { ...r, status: 'rest', at: from.id, cleared: [from.id], restAt: rest.id };
};

describe('the map from a Rest Day', () => {
  it('marks you at the Rest Day and outlines what comes next, with nothing tappable', () => {
    const r = atRestDay();
    const out = html(<ClimbMap run={r} onBack={noop} />);
    expect(out).not.toContain('data-open="true"');
    expect(out).toContain(`data-stop="${r.restAt}" data-open="false" data-here="true"`);
    const next = r.map.floors.flat().find(s => s.id === r.restAt).next;
    expect(out.match(/data-ahead="true"/g)).toHaveLength(next.length);
    for (const id of next) expect(out).toContain(`data-stop="${id}" data-open="false" data-ahead="true"`);
    expect(out).toContain('Back to the Rest Day');
    expect(out).toContain('Rest Day on floor');
    expect(out).not.toContain('Retire and bank the pot');
  });

  it('fades the stops the run can no longer reach, never the path behind it', () => {
    const r = atRestDay();
    const out = html(<ClimbMap run={r} onBack={noop} />);
    expect(out).toContain('data-far="true"');
    expect(out).not.toContain(`data-stop="${r.at}" data-open="false" data-far`);
    expect(html(<ClimbMap run={camped()} onGo={noop} onRetire={noop} onFreeRest={noop} />)).not.toContain('data-far="true"');
  });

  it('is offered from the Rest Day, and the free Rest Day goes back to the map', () => {
    const r = atRestDay();
    expect(html(<RestDay run={r} onRest={noop} onPractice={noop} onViewMap={noop} />)).toContain('See the map and what comes next');
    expect(html(<RestDay run={camped()} free onRest={noop} onPractice={noop} onViewMap={noop} />)).toContain('Back to the map');
    expect(html(<RestDay run={r} onRest={noop} onPractice={noop} />)).not.toContain('data-view-map');
  });
});
