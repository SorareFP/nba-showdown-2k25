// THE CLIMB'S SCREENS (docs/plans/2026-10-18-the-climb.md, Task 9), as static
// markup from real runs (run.js). The click-through is checked in the browser
// at ?demo=climb; here, what each screen shows for a given run.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));

import { ClimbStart, TrainingCamp, ClimbMap, RewardPicker, RestDay, RunOver, practiceTiles, ClimbHud, deckFaces, EventScreen } from './ClimbScreens.jsx';
import { baseId } from '../../game/strats.js';
import { newRun, chooseCamp, chooseStop, recordResult, bossTeam, presetFor, runFromView } from '../../game/modes/run.js';
import { CARDS } from '../../game/cards.js';
import { cardKey } from '../../game/cardSets.js';
import { getStrat } from '../../game/strats.js';

const html = el => renderToStaticMarkup(el);
const FIVE = [...CARDS].sort((a, b) => a.salary - b.salary || a.id.localeCompare(b.id)).slice(100, 105);
const fresh = () => newRun({ id: 'r1', seed: 42, rung: 'prince', rosterKeys: FIVE.map(cardKey), now: 1 });
// Drops off unless a test is about them (they are chances since 2026-10-19).
const camped = () => ({ ...chooseCamp(fresh(), { playbook: 'speed', boon: fresh().camp.boons[0] }), dropOdds: { player: -1, perk: -1 } });
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

  // The user, 2026-10-20: "We need the same sorting for building a climb 5 as we have for team builder".
  it('has the team builder’s filter row: search, team, position, salary and sort', () => {
    const owned = FIVE.map(c => ({ key: cardKey(c), card: c, count: 1 }));
    const out = html(<ClimbStart owned={owned} onStart={noop} />);
    for (const label of ['Search players', 'Team', 'Position', 'Max salary', 'Sort']) expect(out).toContain(`aria-label="${label}"`);
    expect(out).toContain('Speed ↓');
    expect(out).toContain('Name A-Z');
    // Salary, high to low, until a sort is chosen.
    const order = [...FIVE].sort((a, b) => b.salary - a.salary).map(c => out.indexOf(c.name.replace(/'/g, '&#x27;')));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html(<ClimbStart owned={[]} onStart={noop} />)).not.toContain('aria-label="Sort"');
  });
});

describe("the start screen's saved fives", () => {
  it('offers a five that still works, and says why one does not', () => {
    const owned = FIVE.map(c => ({ key: cardKey(c), card: c, count: 1 }));
    const good = { id: 't1', name: 'Bench Mob', climb: true, players: FIVE.map(cardKey), salary: 2000 };
    const sold = { id: 't2', name: 'Old Guard', climb: true, players: [...FIVE.slice(0, 4).map(cardKey), 'gone:Nobody'], salary: 1900 };
    const out = html(<ClimbStart owned={owned} saved={[good, sold]} onStart={noop} onSaveFive={noop} />);
    expect(out).toContain('Your Climb teams');
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
    expect(out).toContain('16 cards');
    for (const id of r.offers.strats) expect(out).toContain(getStrat(id).name.replace(/&/g, '&amp;'));
    expect(out).toContain('Skip');
    expect(r.offers.players).toEqual([]);
    expect(out).not.toContain('data-player-offer');
  });

  // SIGN AND RELEASE (2026-10-21): a full roster still sees its offer, and
  // each player says a release signs them.
  it('offers a full roster its players, signed by releasing one of yours', () => {
    const r = won();
    const bench = [...CARDS].sort((a, b) => a.salary - b.salary).slice(0, 5).map(cardKey);
    const pricey = [...CARDS].sort((a, b) => b.salary - a.salary).slice(10, 13).map(cardKey);
    const full = { ...r, roster: [...r.roster, ...bench], offers: { ...r.offers, players: pricey } };
    const out = html(<RewardPicker run={full} onPickStrat={noop} onPickPlayer={noop} onSkip={noop} />);
    expect(out).toContain('your roster is full (10)');
    expect(out.match(/Sign and release…/g)).toHaveLength(3);
  });
});

// THE PRACTICE SCREEN (the user, 2026-10-19): "the practice option should
// show all the cards in your deck, and you should be able to look at them,
// and there should be a checkbox that toggles the photos to show their
// 'practiced' versions."
describe('the Practice screen', () => {
  const restRun = () => ({
    ...camped(), status: 'rest', restAt: '2-0',
    deck: { ...camped().deck, catch_and_shoot: 1, 'catch_and_shoot+': 1, twin_towers: 1 },
  });

  it('lays out every card in the deck once, plain by default and practiced on the toggle', () => {
    const r = restRun();
    const plain = practiceTiles(r, false);
    expect(plain.map(t => t.id).sort()).toEqual([...new Set(Object.keys(r.deck).map(baseId))].sort());
    expect(plain.find(t => t.id === 'catch_and_shoot')).toMatchObject({ count: 2, plusCount: 1, canPractice: true, upgradeable: true, faceId: 'catch_and_shoot' });
    expect(plain.find(t => t.id === 'twin_towers')).toMatchObject({ canPractice: false, upgradeable: false, faceId: 'twin_towers' });
    const up = practiceTiles(r, true);
    expect(up.find(t => t.id === 'catch_and_shoot').faceId).toBe('catch_and_shoot+');
    expect(up.find(t => t.id === 'twin_towers').faceId).toBe('twin_towers');
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
    expect(out).not.toMatch(/data-practice="twin_towers"/);
    expect(out).toContain('no upgrade yet');
    expect(out).toContain('>Rest<');
    expect(out).not.toMatch(/smith/i);
  });

  // TWO-A-DAYS (2026-10-20): its practice waits on the map, and the screen it
  // opens is Practice alone — no Rest, no Cut.
  it('offers a Two-a-Days practice from the map, on a practice-only screen', () => {
    const r = { ...restRun(), status: 'map', restAt: null, freePractice: 1 };
    expect(html(<ClimbMap run={r} onGo={noop} onRetire={noop} onFreeRest={noop} />)).toMatch(/data-free-practice="true"/);
    expect(html(<ClimbMap run={{ ...r, freePractice: 0 }} onGo={noop} onRetire={noop} onFreeRest={noop} />)).not.toMatch(/data-free-practice/);
    const out = html(<RestDay run={r} practiceOnly free onRest={noop} onPractice={noop} />);
    // Two-a-Days, Shootaround and Front Office all leave this practice (2026-10-22).
    expect(out).toContain('An extra session');
    expect(out).not.toContain('>Rest<');
    expect(out).not.toMatch(/data-cut=/);
    expect(out).toMatch(/data-practice="catch_and_shoot"/);
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

  // The user, 2026-10-20: "Why on earth would someone quit and give up the
  // pot?" A won pot shows only Bank; Give up is the way out of a bank the
  // server refused (ClimbTab passes onAbandon only then), and it says so.
  it('offers only Bank on a won pot, and Give up only once a bank has failed', () => {
    const w = { ...camped(), status: 'won', cleared: ['1-0', 'boss'] };
    const out = html(<RunOver run={w} onBank={noop} onNew={noop} />);
    expect(out).toContain('The climb is won');
    expect(out).not.toContain('Give up this run');
    const failed = html(<RunOver run={w} onBank={noop} onNew={noop} onAbandon={noop} />);
    expect(failed).toContain('Give up this run');
    expect(failed).toContain('did not go through');
  });

  // THREE ACTS (2026-10-20): "'take what you've earned and quit,' or 'keep
  // going and adding to the pot.'"
  it('ends Acts I and II on both choices, and Act III on the bank', () => {
    const w = { ...camped(), status: 'won', cleared: ['1-0', 'boss'] };
    const one = html(<RunOver run={w} onBank={noop} onNew={noop} onContinue={noop} />);
    expect(one).toContain('Act I complete!');
    expect(one).toMatch(/data-continue="true"[^>]*>Keep climbing to Act II</);
    expect(one).toContain('Take the pot and stop');
    expect(one).toContain('One loss from here loses the whole pot');
    expect(one).toContain('a Rare Deluxe');
    const last = html(<RunOver run={{ ...w, act: 3, cleared: [...w.cleared, 'a2:boss', 'a3:boss'] }} onBank={noop} onNew={noop} onContinue={noop} />);
    expect(last).toContain('You climbed all three acts!');
    expect(last).not.toContain('Keep climbing');
    expect(last).toContain('a Mega Deluxe');
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

// PERKS (2026-10-19): a Rivalry's prize on the reward screen, kept on the map.
describe('perks', () => {
  it('offers each perk with who or what takes it, and lists the run\'s perks on the map', () => {
    const r = won();
    const ids = rosterCardsOf(r);
    const offered = { ...r, offers: { ...r.offers, perks: ['gym_rat', 'film_study'] } };
    const out = html(<RewardPicker run={offered} onPickStrat={noop} onPickPlayer={noop} onPickPerk={noop} onSkip={noop} />);
    expect(out).toContain('data-perk="gym_rat"');
    expect(out).toContain('data-perk="film_study"');
    expect(out).toContain('Skip the perk');
    expect(out).toContain(`${ids[0].name} · Power ${ids[0].power}`);
    expect(out).toContain('Catch &amp; Shoot');   // Film Study lists the deck's cards with a "+"
    const withPerk = { ...r, status: 'map', offers: null, perks: [{ id: 'gym_rat', target: ids[0].id }] };
    const map = html(<ClimbMap run={withPerk} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(map).toContain('data-perks="true"');
    expect(map).toContain('Gym Rat');
  });
});
import { rosterCards as rosterCardsFn } from '../../game/modes/run.js';
function rosterCardsOf(run) { return rosterCardsFn(run).cards; }

// WHO A REWARD IS FOR (2026-10-19: "it could glow a little and say 'matches (player)'").
describe('a reward card one of your players fits', () => {
  it('glows and names him; one nobody fits says so; one asking nothing says nothing', () => {
    const base = won();
    // A Speed 12-14 player joins (none of the five is one), and nobody reaches 15.
    const fast = [...CARDS].find(c => c.speed >= 12 && c.speed < 15 && c.power < 15 && !/'/.test(c.name));
    const r = { ...base, roster: [...base.roster, cardKey(fast)] };
    expect(rosterCardsOf(r).some(c => c.speed >= 15 || c.power >= 15)).toBe(false);
    const offered = { ...r, offers: { ...r.offers, strats: ['catch_and_shoot', 'lob_city', 'high_screen_roll'], picks: 1, players: [] } };
    const out = html(<RewardPicker run={offered} onPickStrat={noop} onPickPlayer={noop} onSkip={noop} />);
    expect(out).toContain('data-fits="true"');
    expect(out).toContain(`✓ Matches ${fast.name}`);
    expect(out).toContain('data-fits="false"');
    expect(out).toContain('No player of yours fits it yet');
    expect(out.match(/data-fits=/g).length).toBe(2);   // High Screen & Roll asks nothing fixed
  });
});

// CUTTING (2026-10-19): a Rest Day's third choice, a Cut button on every card.
describe('the Rest Day\'s cut', () => {
  it('offers Cut on every card of the deck when the screen can cut', () => {
    const r = camped();
    const out = html(<RestDay run={r} onRest={noop} onPractice={noop} onCut={noop} />);
    expect(out).toContain('cut one card from your deck for good');
    expect(out.match(/data-cut=/g).length).toBe(Object.keys(r.deck).length);
    expect(html(<RestDay run={r} onRest={noop} onPractice={noop} />)).not.toContain('data-cut=');
  });
});

describe('the map\'s scouting report', () => {
  it('names the boss and its best player from floor 1', () => {
    const r = camped();
    const out = html(<ClimbMap run={r} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(out).toContain('data-scout="true"');
    expect(out).toContain('Scouting the boss');
  });
});

// IN SYSTEM (systemFit.js, 2026-10-20): the playbook pays the players who fit it.
describe('In System on the Climb screens', () => {
  it('prints each playbook\'s line at Training Camp with how many of your five fit', () => {
    const out = html(<TrainingCamp run={fresh()} onChoose={noop} />);
    expect(out.match(/data-system=/g)).toHaveLength(3);
    expect(out).toContain('In System: Speed 12+');
    expect(out).toContain('In System: Power 12+');
    expect(out).toContain('of your five');
  });

  it('glows a player offer who fits the run\'s playbook, and ticks him on the map', () => {
    const base = won();
    const fast = [...CARDS].find(c => c.speed >= 12 && !/'/.test(c.name));
    const slow = [...CARDS].find(c => c.speed < 12 && !/'/.test(c.name));
    const offered = { ...base, offers: { ...base.offers, strats: [], picks: 0, players: [cardKey(fast), cardKey(slow)] } };
    const out = html(<RewardPicker run={offered} onPickStrat={noop} onPickPlayer={noop} onSkip={noop} />);
    expect(out.match(/data-in-system="true"/g)).toHaveLength(1);
    expect(out).toContain('✓ In System');
    const signed = { ...base, roster: [...base.roster, cardKey(fast)] };
    const map = html(<ClimbMap run={signed} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(map).toContain('In System: Speed 12+');
    expect((map.match(/data-in-system="true"/g) ?? []).length).toBe(rosterCardsOf(signed).filter(c => c.speed >= 12).length);
  });
});

// THE CLIMB BAR (the user, 2026-10-20: "You need to be able to look at your
// current map, deck, and player cards at all times in The Climb, no matter the screen").
describe('the Climb bar', () => {
  it('offers the map, the deck and the team, with their counts', () => {
    const r = camped();
    const out = html(<ClimbHud run={r} />);
    expect(out).toContain('data-climb-hud="true"');
    for (const v of ['map', 'deck', 'team']) expect(out).toContain(`data-hud="${v}"`);
    const deck = Object.values(r.deck).reduce((t, n) => t + n, 0);
    expect(out).toContain(`Deck · ${deck}`);
    expect(out).toContain('Team · 5');
    expect(out).not.toContain('data-hud-view');   // closed until asked
    expect(html(<ClimbHud run={null} />)).toBe('');
  });

  it('lays out a practiced copy as its own "+" face', () => {
    const r = { ...camped(), deck: { catch_and_shoot: 1, 'catch_and_shoot+': 1, green_light: 2 } };
    expect(deckFaces(r).map(f => [f.id, f.n])).toEqual([['catch_and_shoot', 1], ['catch_and_shoot+', 1], ['green_light', 2]]);
  });

  it('rides into a run game with the run, its map rebuilt from the seed', () => {
    const r = chooseStop(camped(), '1-0');
    const p = presetFor(r);
    expect(p.climbView.map).toBeUndefined();
    expect(p.climbView.deck).toEqual(r.deck);
    const back = runFromView(JSON.parse(JSON.stringify(p.climbView)));
    expect(back.map).toEqual(r.map);
    expect(back.game.stopId).toBe('1-0');
    expect(runFromView(null)).toBeNull();
    // On the board, the read-only map marks the stop being played.
    const out = html(<ClimbMap run={back} onBack={noop} backLabel="Close the map" />);
    expect(out).toContain('playing floor 1');
    expect(out).toContain('Close the map');
    expect(out).toMatch(/data-stop="1-0"[^>]*data-here="true"/);
  });
});

// THE SECOND WAVE OF PERKS ON SCREEN (2026-10-22).
describe('the new perks on screen', () => {
  const rest = (extra = {}) => ({ ...camped(), status: 'rest', restAt: '2-0', ...extra });

  it('offers a team perk with no one to choose, and a boss\'s marked as one', () => {
    const r = { ...camped(), status: 'reward', offers: { stopId: 'x', strats: [], picks: 0, players: [], perks: ['closers', 'second_chance', 'track_work'] } };
    const out = html(<RewardPicker run={r} onPickStrat={noop} onPickPlayer={noop} onPickPerk={noop} onSkip={noop} />);
    const tile = id => out.slice(out.indexOf(`data-perk="${id}"`), out.indexOf('</button>', out.indexOf(`data-perk="${id}"`)));
    expect(tile('closers')).not.toContain('<select');
    expect(tile('track_work')).toContain('<select');
    expect(tile('track_work')).toMatch(/Speed \d+/);
    expect(out).toMatch(/data-perk="second_chance" data-boss-perk="true"/);
  });

  it('Win-Now Trade takes Rest off the Rest Day; Shootaround says what resting brings', () => {
    const noRest = html(<RestDay run={rest({ perks: [{ id: 'win_now_trade', target: null, at: 0 }] })} onRest={noop} onPractice={noop} onCut={noop} />);
    expect(noRest).toContain('Win-Now Trade');
    expect(noRest).not.toContain('>Rest<');
    const shoot = html(<RestDay run={rest({ perks: [{ id: 'shootaround', target: null, at: 0 }] })} onRest={noop} onPractice={noop} onCut={noop} />);
    expect(shoot).toContain('Shootaround: a practice comes with it.');
  });

  it('Front Office Shake-Up: a cut button on the map, a cut-only screen', () => {
    const r = { ...camped(), status: 'map', freeCut: 2 };
    expect(html(<ClimbMap run={r} onGo={noop} onRetire={noop} onFreeRest={noop} />)).toMatch(/data-free-cut="true"[^>]*>Cut a card \(2\)/);
    const out = html(<RestDay run={r} cutOnly free onRest={noop} onPractice={noop} onCut={noop} />);
    expect(out).toContain('Cut a card');
    expect(out).toMatch(/data-cut=/);
    expect(out).not.toMatch(/data-practice="/);
  });

  it('Travel Day marks the stops off the links and counts what is left', () => {
    const base = camped();
    const from = base.map.floors[0].find(s => s.next.length < 3);
    const r = { ...base, status: 'map', at: from.id, cleared: [from.id], travel: 2, perks: [{ id: 'travel_day', target: null, at: 1 }] };
    const out = html(<ClimbMap run={r} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(out).toMatch(/data-travel="true"/);
    expect(out).toContain('2 left');
  });
});

// A ? STOP (2026-10-25, climbEvents.js): the scene, its player named, and a
// choice that cannot be taken disabled with why.
describe('an event', () => {
  it('shows the scene and its two choices, a closed one saying why', () => {
    const run = { ...camped(), status: 'event', event: { id: 'contract_year', stopId: '2-0', target: FIVE[0].id } };
    const out = html(<EventScreen run={run} onChoose={noop} />);
    expect(out).toContain('data-event="contract_year"');
    expect(out).toContain('Contract Year');
    expect(out).toContain(`${FIVE[0].name.replace(/'/g, '&#x27;')} is playing for a new deal`);
    expect(out).toMatch(/data-choice="pay"/);
    expect(out).toMatch(/data-choice="pass"/);
    // No room for the raise: the choice is closed, and says so.
    const tight = { ...run, cap: 0 };
    expect(html(<EventScreen run={tight} onChoose={noop} />)).toMatch(/data-choice="pay"[^>]*disabled=""[^]*The raise does not fit under the cap/);
    expect(html(<EventScreen run={{ ...run, event: null }} onChoose={noop} />)).toBe('');
  });

  it('marks a ? stop on the map, with no coach or cap of its own', () => {
    const run = { ...camped(), map: { ...camped().map, floors: camped().map.floors.map((f, i) => (i === 1 ? f.map(s => ({ ...s, kind: 'event' })) : f)) } };
    const out = html(<ClimbMap run={run} onGo={noop} onRetire={noop} onFreeRest={noop} />);
    expect(out).toMatch(/data-stop="2-0"[^>]*title="Event"/);
  });
});
