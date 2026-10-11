# Friends, and the cards they need — design (2026-10-11)

## The ask

The user, 2026-10-08: "Can we add a friends list, and make it so when a friend
is within 2 cards of a collection and you pack a card, when you have My
Collection filtered to 'Spare to sell or burn' have a little dot on any excess
card that says 'A friend needs this card for a collection. List it?' Or maybe
we can have a direct trade function too."

## Decisions (the user's answers)

- **No sale reserved for a friend, and no gifts.** "I don't want to create a
  system where people are just min-listing cards for friends to buy, even
  though that's what my brother and I do now. I want the market to matter
  still." The dot opens the ordinary public sell form.
- **Both, nudge first.** Phase 1 is friends + the dot + the friend's Home and
  market tag. Phase 2 is card-for-card trades between friends, designed when
  phase 1 is in use.
- **Adding a friend: friend code + people you've played.** No player directory
  and no usernames. Display names are the Google account's full name, so a
  searchable directory would let any player look up any player's real name.
- **The friend learns of a listing on Home and by a market tag.**
- **A friend's needs are published by their own app** (approach 1 of 3): a
  small list on their profile, rewritten whenever their collection changes on
  their device. Reading it is one document per friend. The other two (a server
  callable reading every friend's whole collection; the server rewriting it in
  every callable that touches a collection) were turned down for read cost and
  for the number of write sites to keep in step.

## Phase 1

### Data

| Path | Written by | Read by | Holds |
| --- | --- | --- | --- |
| `friendCodes/{code}` | server | server only | `{ uid }` — the account a code belongs to |
| `friends/{uid}` | server | server only (through `myFriends`) | `{ code, uids: [...], names: { uid: name } }` |
| `friendRequests/{from}_{to}` | server | server only (through `myFriends`) | `{ from, to, fromName, toLabel, via: 'code' \| 'league' \| 'pvp', at }` |
| `profiles/{uid}` | the owner (`needs`, `needsAt` only) | the owner; friends through `myFriends` | `{ needs: [...], needsAt }` |
| `users/{uid}/playedWith/{otherUid}` | server | server only (through `myFriends`) | `{ label, via: 'league' \| 'pvp', at }` — a league co-member's team name and league, a PvP opponent's room name |

- **A code** is short and unambiguous (no 0/O/1/I), made on first visit to
  Friends, kept for good. Looking one up goes through a callable, so codes
  cannot be listed or guessed in bulk.
- **`profiles` is owner-read;** a friend's needs reach you through the `myFriends` callable, which
  checks the friendship, so no rule looks one up (refined 2026-10-11). The owner may write only
  `needs` and `needsAt`; names live on the server-only `friends/{uid}.names`, set when the friendship
  forms, so a client cannot rename itself to impersonate.
- **Friends cap: 30** — the most a single Firestore `in` query takes, which is
  how Home finds friends' listings.

### Server (callables)

- `myFriends()` — makes the caller's code if missing; returns the code, friends with their needs (cleaned), requests in and out, and people played.
- `requestFriend({ code } | { uid })` — by code, or one tap from played-with
  (only a uid in the caller's `playedWith` AND with the caller in theirs: a
  forged PvP room records one side only — final review, 2026-10-11). Refuses
  self, an existing friend, a duplicate request, and the cap. A request back
  to someone who asked you first is an acceptance. The recipient sees the
  requester's name and how the request arrived (`via`: their code, a league,
  a head-to-head game), since a token name is the client's to set; the
  requester learns the recipient's name only on accept.
- `answerFriendRequest({ id, accept })` — accept writes both friend lists and
  each side's name for the other (`friends/{uid}.names`); decline deletes the request.
- `removeFriend({ uid })` — both lists, one transaction.
- **Played-with:** a league's members are recorded when it starts
  (`startLeague`); a PvP opponent when a PvP game's reward is claimed — the
  claim key names the room (`pvp:<code>:<createdAt>`), and the room's meta
  names both players. Past PvP games are not recoverable.

### What counts as a need (`src/game/friends.js`, pure)

`needsFromCollection(collection, claims)`: every goal not claimed and 1 or 2
cards short (`goalProgress`), each missing card key the owner holds NO copy of
(a spare waiting to be collected is not a need). Entries
`{ cardKey, goalId, missing }`. The app compares with what it last published
and writes only on a change — after a pack, a purchase, a collect, a claim, and
once on Home/Collection load.

`friendWants(friendProfiles, cardKey)` → the friends who need that card, with
the collection and how many they are short, for the dot's text.

### UI

- **Friends page** (Collection → Friends): your code (copy button), enter a
  code, requests in and out, friends (remove), people you've played (one tap).
- **The dot.** My Collection filtered to "Spare to sell or burn": a spare a
  friend needs carries a dot; hover/tap reads "Sam needs this for the Celtics
  collection (1 to go). List it?" (all of them, if several). "List it" opens
  that tile's existing sell form — same suggested price, same burn-value floor,
  a public listing. Only on a sellable spare: never the collected copy, a
  reward, or a copy already listed.
- **Pack reveal chip.** A pulled card a friend needs shows "Sam needs this one".
- **Home.** "From your friends": a friend's listing of a card you need — "Alex
  listed Jaylen Brown, which you need for the Celtics collection: 120 coins",
  linking to the card in the market. Listings by friends (`seller in` the
  friend uids), filtered to your needs.
- **Market.** A friend's listing is tagged "Your friend", and "Your friend ·
  you need this" when it is one of your needs. Anyone can still buy it.

### Edge cases

- A friend who has not opened the app since a change: their needs are as they
  left them, which is right — their collection only changes when they play.
- A need fills (they bought it elsewhere): their next publish drops it and
  your dot goes.
- A friend removed mid-session: their profile read fails; their dots and Home
  lines go with it.
- Old clients without the feature: they never publish; their friends see no
  needs for them.

### Testing

- `friends.js`: needs from a collection (1–2 short, claimed skipped, held
  spares skipped), the want lookup and its text.
- The dot: rendered only on sellable spares under the spare filter, names the
  friend and collection, opens the sell form.
- Market and Home: the friend tag and the "From your friends" line from fixture
  listings.
- Callables: request by code and by played-with, accept/decline, remove, the
  cap, self and duplicate refusals (the functions test harness).
- Rules: not covered by tests — the repo has no rules emulator harness. The
  `profiles` rule is owner-only read and `needs`/`needsAt`-only write;
  friends read needs through `myFriends`, which is tested.

### Deploy

Firestore rules (three new collections and the `profiles` rule), then
functions, then Pages — the order in `cloud_functions_deploy_order`.

## Phase 2 (later): card-for-card trades between friends

Offer one of your spares for one of theirs; they accept or decline; an offer
expires after a few days; on accept the server swaps both copies in one
transaction. To settle when it is built: whether a trade must be same rarity
for same rarity, so it cannot stand in for the market; and a guard against a
second account feeding free starter-pack cards to a main (for example, only
between friends of a week or more).
