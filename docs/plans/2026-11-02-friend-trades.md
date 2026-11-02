# Friend Trades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Friends trade card(s) for card(s): offer, counter, accept, decline, with a value rule that keeps the market worth using.

**Architecture:** One pure rule in `src/game/marketRules.js`, shared by the client's meter and the server. Five server-only callables over a new `trades/{id}` collection, swapping copies in one transaction the way `buyListing` does. A trade screen and an Offers section on the Friends page.

**Tech Stack:** React, Firebase callables (firebase-functions v2), Firestore transactions, vitest with the in-memory Firestore harness.

**Spec:** `docs/plans/2026-11-02-friend-trades-design.md`

## Global Constraints

- Value: `notionalPrice` (common 40, uncommon 100, rare 600, super rare 2,000, legendary 5,000); the lower side at least 60% of the higher.
- One to five cards a side, both sides required, player cards only, spares only.
- Friends of at least seven days; a friendship with no date counts as old enough.
- Offers last three days; five open offers sent per player; a counter does not count.
- No holds on offered cards; nothing moves unless everything can.
- A friend's spares show only on the trade screen.
- No rules deploy: `trades` stays server-only. No new shared module: functions tests mock each one, so the rule goes in `marketRules.js`.
- Player-facing text says they/them. Card art uses `ZoomImg`. New screens checked at 1830x900 and 2560x1100.

## Review Focus

1. Accepting when one card of several has just gone: nothing moves, the offer shows failed with the reason. Test in Task 2.
2. A double tap on Accept: the second answer is refused and no card moves twice. Test in Task 2.
3. An offer naming two copies of a card the owner has one spare of: refused at send and at accept. Test in Task 2.
4. Removing a friend, then adding them again: the week starts over. Test in Task 2.
5. Countering an offer that expired or is not yours: refused, and the old offer is untouched. Test in Task 2.

---

### Task 1: The rule

**Files:**
- Modify: `src/game/marketRules.js`
- Test: `src/game/marketRules.test.js`

**Interfaces:**
- Produces: `TRADE_MAX_CARDS = 5`, `TRADE_MIN_SHARE = 0.6`, `TRADE_OFFER_DAYS = 3`, `TRADE_OPEN_MAX = 5`, `TRADE_FRIEND_DAYS = 7`; `tradeValue(keys) -> number`; `tradeShare(give, get) -> number` (0 to 1); `tradeProblem(give, get) -> string | null`; `pickTradeCard(list, key, available) -> string[]`; `friendsLongEnough(myDoc, otherUid, now) -> boolean`.

- [ ] Write the failing tests: every row of the spec's table through `tradeProblem`; empty sides; six cards; a card on both sides; a strategy key; `pickTradeCard` adding, capping at the copies and at five, and removing; `friendsLongEnough` with no date, six days and seven days.
- [ ] Run `npx vitest run src/game/marketRules.test.js`; expect failures.
- [ ] Implement. Compare in whole numbers (`low * 100 >= high * 60`).
- [ ] Run again; expect all pass. Commit.

### Task 2: The server

**Files:**
- Modify: `functions/index.js`
- Test: `functions/trades.test.js`

**Interfaces:**
- Consumes: Task 1.
- Produces, as callables: `friendSpares({ friendUid }) -> { theirs, mine, opensAt }` (each `[{ cardKey, count }]`; `opensAt` is ms or null); `sendTrade({ friendUid, give, get, counterOf? }) -> { id }`; `answerTrade({ id, accept }) -> { status, why? }`; `cancelTrade({ id }) -> { status }`; `myTrades() -> { incoming, outgoing, recent }`, each row `{ id, from, to, name, give, get, counter, status, why, expiresAt }`, where `give` is what `from` gives.

- [ ] Write the failing tests: the spares call refused for a stranger, spare player cards only (no collected, earned, listed or strategy copies); send refused for a stranger, a week-young friend, an uneven offer, a card the owner lacks, and a sixth open offer; accept swaps every copy and moves both collection counts with supply untouched; decline; cancel by the sender only; expiry reads as gone; a counter closes the old offer, carries `counterOf`, is exempt from the limit; and the five Review Focus cases.
- [ ] Run `npx vitest run functions/trades.test.js`; expect failures.
- [ ] Add `since` to `befriend` and strip it in `removeFriend`.
- [ ] Implement the callables. `answerTrade` returns a failure rather than throwing, so the `failed` status and its reason are committed. `refreshLive()` before send and answer. Every read before any write.
- [ ] Run again, then `npx vitest run functions`; expect all pass. Commit.

### Task 3: The screens

**Files:**
- Create: `src/components/TradeScreen.jsx`, `src/components/TradeScreen.module.css`, `src/components/TradeScreen.test.jsx`, `src/components/TradeOffers.jsx`
- Modify: `src/firebase/friends.js`, `src/firebase/FriendsProvider.jsx`, `src/components/FriendsPanel.jsx`, `src/components/FriendsPanel.module.css`, `src/components/CollectionTab.jsx`, `src/components/HomeTab.jsx`, `src/components/PackOpeningDemo.jsx`, `src/App.jsx`

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: `TradeScreen({ friend, needKeys, counter, onClose, onSent, load, send })`; `TradeOffers({ trades, onAnswer, onCounter, onCancel, busy })`; `useFriends().trades`.

- [ ] Write the failing render tests: the screen opens on the friend's spares with needed cards first; the meter's verdict; Send disabled until fair; a counter opens filled in from the counterer's side; a young friendship says when trading opens; offers show Accept, Counter and Decline for you and Cancel for yours.
- [ ] Run; expect failures.
- [ ] Build them. Filters are `PoolFilters`. `?demo=trade` shows the screen.
- [ ] Run; expect pass. Check in the browser at 1830x900, 2560x1100 and phone width. Commit.

### Task 4: The words

**Files:**
- Modify: `src/game/home.js`, `src/components/HowToPlay.jsx`, `src/components/RulebookTab.jsx`

- [ ] Add a NEWS item (`to: 'friends'`), a line in How to Play and the Rulebook's rules.
- [ ] Run `npx vitest run`; expect all pass. Commit and push.
