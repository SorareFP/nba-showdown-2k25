# Friend trades: design

Phase 2 of Friends (`docs/plans/2026-10-11-friends-design.md`). Status: draft for
the user's review, 2026-11-02.

## Why

Two friends cannot move a card between them. The market is the only route, which
is why a card made for a friend needed an admin tool (Send to… in the Studio's
request queue). The user wants a direct trade, but has been clear since 10-08
that it must not replace the market: "I want the market to matter still."

So a trade is an exchange of real value between friends, never a gift. The user,
2026-11-02: "Card for card is good, but it should be card(s) for card(s). I think
there should be some sort of salary/rarity buffer so someone isn't just trading
commons for legendaries."

## What the player does

The user: "Start with cards from his collection."

1. Friends → a friend → **Trade**.
2. The screen opens on the friend's spares. Cards you need for a collection sort
   first and carry the market's "you need this" mark. Pick up to five for
   **You get**.
3. Switch to your own spares and pick up to five for **You give**. A meter shows
   both sides' value and whether the offer is allowed.
4. **Send offer**. It appears on the friend's Friends page and on their Home.
5. The friend sees both sides as card art, and accepts or declines. An offer you
   sent can be cancelled until then. An open offer lapses after three days.
6. On accept the server swaps every card in one transaction.

There is no free-text message and no counter-offer. Declining and sending a new
offer does the same job.

## The rules

**Value.** Each card is worth the game's market value for its rarity today
(`MARKET_PRICES`: common 40, uncommon 100, rare 600, super rare 2,000, legendary
5,000; `notionalPrice`). The lower side must be at least **60%** of the higher.

| Offer | Value | Share | Allowed |
|---|---|---|---|
| 5 commons for a rare | 200 vs 600 | 33% | No |
| 5 uncommons for a rare | 500 vs 600 | 83% | Yes |
| 2 rares for a super rare | 1,200 vs 2,000 | 60% | Yes |
| 2 super rares for a legendary | 4,000 vs 5,000 | 80% | Yes |
| 5 rares for a legendary | 3,000 vs 5,000 | 60% | Yes |
| 1 rare for a super rare | 600 vs 2,000 | 30% | No |
| 4 rares for a legendary | 2,400 vs 5,000 | 48% | No |

The user approved these verdicts. Quick-sell values were tried first and could
not allow 5 uncommons for a rare without allowing worse deals.

**Size.** One to five cards a side, both sides required. Without the cap, enough
commons would match anything. An offer may hold two copies of one card, if the
owner has two spares of it. One card cannot be on both sides of an offer.

**Spares only.** The copy must be in state `spare`, the same rule as selling.
Collected, earned (rewards and gifts) and listed copies cannot be offered. A
player's only copy of a card is a spare until they collect it, so it can appear;
the person accepting sees "your last copy" on it.

**Friends only, a week in.** Both players must be friends, and have been for at
least seven days. That is the guard against a second account feeding free
starter-pack cards to a main. Friendships from before this ships have no date
and count as old enough.

**Nothing is held.** An open offer does not lock its cards. Either player can
still sell, burn or collect them, and the offer then fails at accept with the
reason. Holding cards would let one offer freeze a friend's spares.

**Checked twice.** Every rule runs when the offer is sent and again at accept,
inside the transaction. Live cards change rarity nightly, so an offer that was
fair on Monday may not be on Tuesday; it fails with the reason, and nothing moves.

**Limits.** Five open offers sent per player. A sixth asks you to cancel one.

## What the server does

All of it is server-only, like the market and Friends: a new top-level
`trades/{id}` collection that the rules' closing match already refuses to
clients, so **no rules deploy**.

    trades/{id}: { from, to, fromName, toName, give: [cardKey], get: [cardKey],
                   status, createdAt, expiresAt, answeredAt, failedWhy }

`status` is `open`, `accepted`, `declined`, `cancelled` or `failed`. An `open`
offer past `expiresAt` reads as expired; no scheduled job is needed.

Callables, in `functions/index.js`:

- `friendSpares({ friendUid })`: the friend's spare player cards as
  `[{ cardKey, count }]`. Refused unless you are friends. This is the first time
  a friend can see more than your needs, and it shows spares only, never the
  rest of a collection.
- `sendTrade({ friendUid, give, get })`
- `answerTrade({ id, accept })`: the recipient only.
- `cancelTrade({ id })`: the sender only.
- `myTrades()`: your open offers both ways, and recent results.

Accepting follows `buyListing`: for each card, find a spare with `findSpares`,
delete it, create a copy for the other player (`state: spare`, keeping `mintedAt`
and `source`, adding `tradedFrom`), and move the collection counts by one each way.
Supply does not change: a trade moves copies that already exist. It runs
`refreshLive()` first, so Live values are tonight's.

`befriend` starts recording when a friendship began (`since: { [uid]: ms }` on
`friends/{uid}`), which the week rule reads. Removing a friend does not touch an
open offer; it fails at accept, because the two are no longer friends.

The value rule is one pure function, `tradeProblem(give, get)`, added to
`src/game/marketRules.js` so the client's meter and the server cannot disagree.
That file is already shared with functions.

## What the player sees

- **Friends page:** a Trade button on each friend, and an Offers section above
  the list: offers for you with Accept and Decline, and offers you sent with
  Cancel. Every card opens the whole card (`ZoomImg`).
- **Trade screen:** the friend's spares and yours on tabs, using the Team
  Builder's filter row, beside a slip with You get, You give and the meter. It
  follows the whole-screen rule: check at 2560x1100 and 1830x900.
- **Home:** a line in From your friends when an offer is waiting.
- **Results:** a toast, and the offer shown as accepted or failed with its reason.

`How to Play`, the Rulebook and a NEWS item move the day it ships. Player-facing
text says they/them.

## Not in this version

Gifts and reserved sales (ruled out 2026-10-08), trading with anyone who is not a
friend, trading coins, counter-offers, and a public trade board.

## Decisions for the user

1. Strategy cards: player cards only, or both? Strategy cards have no market
   value table, and their quick-sell values sit far below a player's at the same
   rarity, so including them needs a value of their own. Assumed: player cards
   only for now.

## Calls made in the design

Three-day expiry, five open offers, no free-text message, no counter-offer, no
holds on offered cards, and spares-only visibility of a friend's collection.
