// THE TRADE SCREEN and the offers (2026-11-02). docs/plans/2026-11-02-friend-trades-design.md
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/friends.js', () => ({ friendSpares: vi.fn(), sendTrade: vi.fn() }));
const { TradeBoard, tradeVerdict, spareRows, stillHeld } = await import('./TradeScreen.jsx');
const { default: TradeOffers } = await import('./TradeOffers.jsx');
const { CARDS } = await import('../game/cards.js');
const { cardKey } = await import('../game/cardSets.js');
const { getPlayerRarity } = await import('../game/rarity.js');
const { DEFAULT_FILTERS } = await import('../game/teamRules.js');

const keys = rarity => CARDS.filter(c => getPlayerRarity(c) === rarity).map(cardKey);
const [R1, R2, R3] = keys('rare');
const [U1] = keys('uncommon');
const [S1, S2] = keys('super-rare');
const friend = { uid: 'alex', name: 'Alex', needs: [] };
const spares = { theirs: [{ cardKey: R1, count: 1 }, { cardKey: S1, count: 2 }, { cardKey: U1, count: 1 }], mine: [{ cardKey: R2, count: 1 }, { cardKey: R3, count: 1 }], opensAt: null };
const board = props => renderToStaticMarkup(<TradeBoard friend={friend} spares={spares} needKeys={new Set()} onClose={() => {}} onSend={() => {}} {...props} />).replaceAll('&#x27;', "'");
const cardsShown = html => [...html.matchAll(/data-trade-card="([^"]+)"/g)].map(m => m[1]);
const sendButton = html => html.match(/<button[^>]*data-send[^>]*>/)[0];

describe('the trade screen', () => {
  it("opens on the friend's spares, dearest first, with the slip empty", () => {
    const html = board();
    expect(cardsShown(html)).toEqual([S1, R1, U1]);
    expect(html).toContain('Trade with Alex');
    expect(html).toContain('0 of 5');
    expect(html).toContain("Pick from Alex's spares, then from yours.");
  });

  it('puts the cards you need first, with the mark', () => {
    const html = board({ needKeys: new Set([U1]) });
    expect(cardsShown(html)).toEqual([U1, S1, R1]);
    expect(html).toContain('YOU NEED');
  });

  it('shows how many spares of a card there are', () => {
    expect(board()).toContain('×2');
  });

  it('holds Send until the offer is fair', () => {
    expect(sendButton(board())).toContain('disabled');
    expect(sendButton(board({ counter: { id: 't', give: [R2], get: [S1] } }))).toContain('disabled');
    expect(sendButton(board({ counter: { id: 't', give: [R2, R3], get: [S1] } }))).not.toContain('disabled');
  });

  it('says when a new friendship can trade, and holds Send', () => {
    const html = board({ spares: { ...spares, opensAt: new Date(2026, 10, 9).getTime() }, counter: { id: 't', give: [R2], get: [R1] } });
    expect(html).toMatch(/You and Alex can trade from Nov 9/);
    expect(sendButton(html)).toContain('disabled');
  });

  it('has something to say when a friend has no spares', () => {
    expect(board({ spares: { ...spares, theirs: [] } })).toContain('Alex has no spare cards right now.');
  });
});

describe('a counter', () => {
  const counter = { id: 't', give: [R2], get: [R1] };

  it('opens filled in from the side of the player countering', () => {
    const html = board({ counter });
    expect(html).toContain("Countering Alex's offer. Change anything, then send it back.");
    expect(html).toContain('Send counter');
    expect(html.match(/data-slot="get"[^>]*data-key="([^"]+)"/)[1]).toBe(R1);
    expect(html.match(/data-slot="give"[^>]*data-key="([^"]+)"/)[1]).toBe(R2);
  });

  it('leaves out a card that is no longer a spare', () => {
    expect(stillHeld([R1, R3], [{ cardKey: R1, count: 1 }])).toEqual([R1]);
    expect(stillHeld([R1, R1], [{ cardKey: R1, count: 1 }])).toEqual([R1]);
  });
});

describe('the verdict', () => {
  it('asks for what is missing', () => {
    expect(tradeVerdict([], [], 'Alex').tone).toBe('idle');
    expect(tradeVerdict([], [R1], 'Alex').text).toBe('Now pick from your spares.');
    expect(tradeVerdict([R1], [], 'Alex').text).toBe("Now pick from Alex's spares.");
  });

  it('gives the share, and never rounds a refusal up to the line', () => {
    expect(tradeVerdict([R2, R3], [S1], 'Alex')).toEqual({ tone: 'ok', text: '60%: a fair trade.' });
    expect(tradeVerdict([R2], [S1], 'Alex')).toEqual({ tone: 'no', text: '30%: too uneven. The lower side needs 60%.' });
  });

  it('says why when the values fit but the offer cannot stand', () => {
    expect(tradeVerdict([R1], [R1], 'Alex').text).toMatch(/both sides/);
  });
});

describe('the rows of spares', () => {
  it('drop a key that is no player card, and follow the filters', () => {
    const rows = spareRows([{ cardKey: 'high_screen_roll', count: 1 }, ...spares.theirs], new Set(), DEFAULT_FILTERS);
    expect(rows.map(r => r.key)).toEqual([S1, R1, U1]);
    const name = CARDS.find(c => cardKey(c) === R1).name;
    expect(spareRows(spares.theirs, new Set(), { ...DEFAULT_FILTERS, search: name }).map(r => r.key)).toContain(R1);
  });
});

describe('the offers', () => {
  const row = over => ({ id: 't1', from: 'alex', to: 'me', name: 'Alex', give: [R1], get: [R2], counter: false, status: 'open', why: null, mine: false, expiresAt: Date.now() + 2.5 * 24 * 60 * 60 * 1000, ...over });
  const offers = trades => renderToStaticMarkup(<TradeOffers trades={{ incoming: [], outgoing: [], recent: [], ...trades }} onAnswer={() => {}} onCounter={() => {}} onCancel={() => {}} busy={null} />);

  it('shows nothing when there are none', () => {
    expect(offers({})).toBe('');
  });

  it('gives an offer for you Accept, Counter and Decline, and shows which side is which', () => {
    const html = offers({ incoming: [row()] });
    for (const word of ['Accept', 'Counter', 'Decline', 'Alex', '3 days left', 'You get', 'You give']) expect(html).toContain(word);
    expect(html).not.toContain('Cancel');
    expect(html.indexOf(`data-side="get"`)).toBeLessThan(html.indexOf(`data-side="give"`));
    expect(html.match(/data-side="get"[\s\S]*?data-key="([^"]+)"/)[1]).toBe(R1);
    expect(html.match(/data-side="give"[\s\S]*?data-key="([^"]+)"/)[1]).toBe(R2);
  });

  it('says when an offer is a counter', () => {
    expect(offers({ incoming: [row({ counter: true })] })).toContain('countered your offer');
  });

  it('gives an offer you sent Cancel, with your cards on the give side', () => {
    const html = offers({ outgoing: [row({ from: 'me', to: 'alex', mine: true })] });
    expect(html).toContain('Cancel');
    expect(html).not.toContain('Accept');
    expect(html.match(/data-side="give"[\s\S]*?data-key="([^"]+)"/)[1]).toBe(R1);
  });

  it('says what happened to the last ones, with the reason a trade failed', () => {
    const html = offers({ recent: [row({ status: 'failed', why: 'A card in this offer is no longer a spare', id: 'a' }), row({ status: 'declined', mine: true, id: 'b' }), row({ status: 'expired', id: 'c' })] });
    expect(html).toContain('A card in this offer is no longer a spare');
    expect(html).toContain('Alex declined your offer');
    expect(html).toContain('offer expired');
  });
});
