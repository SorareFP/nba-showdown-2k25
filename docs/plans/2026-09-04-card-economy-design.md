# The card economy: mint ledger, supply-driven packs, P2P market, lock-on-collect

Design only. Nothing here is built yet.

These arrived as four requests over one session, and they are not four features.
They are one data model seen from four sides:

- *"Each card minted has an ID and that ID can be posted on the market."*
- *"Cards' appearances in packs should grow and shrink as they're minted."*
- *"Legendary 2 gets minted twice, it drops to a lower percentage."*
- *"When you add a card to your collection, you can no longer burn it or post
  it on the market. If you have 10 copies and collected one, you can burn the
  other 9."*

Every one of those is a statement about **a copy of a card and where it is**.
Today the app has no such concept: a collection entry is a COUNT.

```js
users/{uid}/collection/{cardKey} = { type, count, acquiredAt, locked }
```

A count cannot be listed, cannot be sold, and cannot distinguish the copy you
collected from the nine you would burn. Everything below follows from replacing
it with an instance.

---

## 1. The shape

```
supply/current                     { counts: { <cardKey>: circulating } }
users/{uid}/copies/{copyId}        { cardKey, mintedAt, source, state }
users/{uid}/collection/{cardKey}   { count, collectedCopyId }
listings/{listingId}               { cardKey, copyId, seller, price, listedAt }
```

**`copies` is the ledger.** One document per physical card in the game. `state`
is `collected`, `spare`, `listed` or `earned`.

**`collection` stays, as an index.** It is derived from `copies` and exists so
the collection screen and the goal tracker can read one document per card
instead of one per copy. It is a cache; `copies` is the truth. Any disagreement
is resolved by recounting from `copies`.

**`supply/current` is what packs read.** One document, one read per pack open.
See §5 for why it is one document and when that stops being true.

**`listings` is flat and global,** because the market is a place buyers browse,
not something scoped to a seller.

### Why copies live under the owner

A top-level `copies/{copyId}` collection would be simpler to reason about and
much worse to read: the collection screen wants "everything I own", which under
a flat collection is a query, and under `users/{uid}/copies` is a subtree. The
market needs the opposite — "everything for sale" across all owners — which is
what `listings` is for, and it stays small because most copies are not listed.

---

## 2. Lock-on-collect

The user's rule, exactly: *"The lock from burning should be a mechanism that
happens automatically by collecting a card."*

- The **first copy** of a card a player receives becomes `collected`. It is
  recorded as `collectedCopyId` on the collection index.
- A `collected` copy can not be burned and can not be listed. There is no
  button for either, and the write path refuses both.
- Every further copy is `spare`. Spares can be burned or listed freely.
- **Team rewards are `earned`** and are neither burnable nor tradable, ever.
  They are the payoff for a collection; a market for them would make the whole
  difficulty ladder purchasable.

This replaces the manual lock toggle built earlier. That toggle was the right
mechanic asked the wrong way round — it made the player protect their own
collection by hand, when the game already knows which copy is the collection.

**The `locked` field is retired.** Anything reading it should read
`state === 'collected' || state === 'earned'` instead.

---

## 3. Supply-driven pack weights

The band stays fixed. `PACK_WEIGHTS` still decides whether a pull is common or
legendary, so the rate the whole economy is balanced on does not move. What
changes is WHICH card comes out of the band.

Today that choice is uniform, and it produces a distortion nobody chose: the
Rookie set holds three legendaries, so each of them is five times easier to pull
than a base-set legendary and fourteen times easier than a Super Season one. The
scarcest set has the most reachable apex cards.

Under the new rule a card's weight within its band decays as copies enter
circulation:

```
weight(card) = baseShare(card) x decay(circulating[cardKey])
decay(n)     = 1 / (1 + n / 5)
```

- `baseShare` is the special-set split already built: base cards take
  `1 - SPECIAL_BAND_SHARE` of a band, special-set cards take the rest, uniform
  within each side. That is unchanged and still measured at 25%.
- The `/5` is the user's pick over a sharper `1/(1+n)`: a card should get scarce
  over a season, not within one session.

### There is no floor, and that is the point

The obvious instinct is a minimum share so nothing becomes unobtainable. It is
wrong, and the user said so directly: a saturated card *should* effectively stop
appearing, *"until other cards start to catch up to it or the distribution
becomes more even."*

Normalisation already does exactly that, because a share is relative. Measured
on the fourteen base-set legendaries:

| card A minted | others at | A's share | each other card |
|---|---|---|---|
| 0 | 0 | 7.14% | 7.14% |
| 50 | 0 | **0.69%** | 7.64% |
| 50 | 25 | 4.03% | 7.38% |
| 50 | 50 | **7.14%** | 7.14% |
| 50 | 100 | **12.80%** | 6.71% |

Opened hard, A falls under 1%. When the rest catch up it returns to exactly even
without anything being reset. When they pass it, A becomes the scarce one and
rises above them. A floor would prop up the over-minted card and flatten all of
that into noise.

`1/(1+n/5)` is never zero, so no card is ever truly unobtainable — it is just
very unlikely while it is saturated, which is the intended feeling.

`circulating` is mints minus burns, not lifetime mints. A burned card really is
gone and the pool should feel it.

> **Watch this:** burning to make a card rarer is a real loop. Burning pays a
> twentieth of market price, so it is not obviously profitable, but if listing
> prices ever exceed twenty times burn value for a card someone holds in bulk,
> the loop opens. Worth measuring once real prices exist rather than designing
> against it now.

### Cost of making `generatePack` supply-aware

Cheap. It has two real call sites, both in `CollectionTab`; the other nineteen
references are tests. Supply arrives as an option:

```js
generatePack(packType, { ...options, supply })
```

`supply = {}` reproduces today's uniform behaviour exactly, so the function
stays pure and synchronous, every existing test keeps passing, and the feature
can be built behind a caller that does not pass it yet.

---

## 4. The market

- **Listing** moves a spare to `listed` and creates a `listings` document. The
  copy does not leave the seller's subtree; it is escrowed by state.
- **Buying** is a transaction: verify the listing still exists, move the copy to
  the buyer, delete the listing, move the coins. If any part fails, none of it
  happens.
- **Buying mints nothing.** `supply` is untouched by a trade — the card already
  exists, it changed hands. This is the whole reason `buyCard` has to go: it
  currently CREATES a card from coins, which is minting by another name and
  would make every scarcity number here a lie.
- **Delisting** returns the copy to `spare`.

`getMarketPrice` and `MARKET_PRICES` stay, but demoted from a price to a
**suggestion** — the anchor a seller sees when choosing what to ask. Actual
price is whatever a buyer pays.

---

## 5. The single-document supply counter

`supply/current` holding a map of card key to count is one read per pack open,
which is what makes supply-driven weights affordable at all. One pack open is
also one WRITE to it, and Firestore sustains roughly one write per second to a
single document.

**That ceiling is further away than it sounds.** One write per second is ~86,400
pack opens a day. At thirty packs per active player per week that is about
twenty thousand weekly actives on perfectly flat traffic, or three to four
thousand once evening peaks are allowed for. It is a success problem, not a
scale problem, and it announces itself gently — contended writes retry, they do
not fail hard.

So: do not shard, and do not build for sharding. Do ONE thing, because it costs
a few lines now and is irritating to unpick later — have the read side **merge
whatever documents it finds under `supply/`** rather than reading `supply/current`
by name. The day the ceiling matters, shards are new documents and nothing else
changes.

## 6. The honest problem: the client mints its own cards

`generatePack` runs **in the browser**, and `addCardsToCollection` writes
whatever the client hands it. Today that is only a fairness question. Under this
design it is a supply question, and supply is the thing every price and every
pull rate depends on.

Anyone who can open the console can mint themselves a legendary, and no rule
written above can stop them, because all of them run on the attacker's machine.

This does not block the work — the model is the same either way — but it means
the ledger is only as trustworthy as the client until pack generation moves to a
**Cloud Function**. That is the right eventual home for: opening a pack, buying
a listing, claiming a goal reward. All three move currency or create cards.

Sequencing suggestion: build the model client-side, get the mechanics right,
then move those three writes server-side before anyone but the owner plays it.
Firestore security rules can meanwhile refuse the obvious things — writing your
own currency, writing a copy whose `source` is not a real pack purchase.

---

## 7. Decisions

All taken. Recorded here because the reasons matter more than the values.

Nothing is open. Everything below is decided.

### Settled

- **Burning removes a card from supply.** `circulating = minted - burned`. A
  burned card really is gone and the pool feels it, which is what makes burning
  a sink rather than a shrug. The burn-to-make-rare loop in §3 stays a thing to
  measure once real prices exist, not to design against now.

- **Decay `1/(1 + n/5)`.** Scarce over a season, not within a session.
- **No floor.** The relative share self-corrects; see §3.
- **Set-scoped packs concentrate, deliberately.** A Rookie pack's three
  legendaries stay far easier than a base-set legendary because the pool is only
  rookies. *"That's fine if those are more achievable"* — it is what a targeted
  pack is for, and it is what set-pack pricing should charge for.

---

## 8. Order of work

1. ~~`copies` ledger + lock-on-collect.~~ **DONE.** Retired the manual lock
   toggle; the first copy of a card is the collection copy and only spares burn.
2. ~~`supply/current` written on mint; `generatePack` accepts it and weights
   within band.~~ **DONE (2026-09-04).** `decay(n) = 1/(1 + n/5)` in
   packEngine.js, applied in `pickBySupply` inside each side of the
   special/base split — never to the split itself, and never to the BAND, so
   PACK_WEIGHTS still decides how often a legendary appears at all.
   `CollectionTab` reads supply once alongside the collection rather than at
   purchase time, so opening a pack stays instant and a failed read degrades to
   uniform. **The starter pack deliberately opts out** — it is everyone's first
   twenty cards and should be the same draw for a player who arrives late.
   Strats opt out too: a fixed 51-card deck nobody is chasing.
   Pinned by src/game/packSupply.test.js, including the self-correcting share
   table from §3 as arithmetic — if those stop holding, the no-floor argument
   is gone.
3. ~~Listings, then buying, then delisting.~~ **DONE (2026-09-04).**
   `src/firebase/market.js` — `listCard` escrows a SPARE by state (the copy
   never leaves the seller's subtree, so an unsold listing needs no repair),
   `buyListing` moves it inside a `runTransaction` that RE-READS the listing,
   `delistCard` returns it to spare. Nothing in the file touches `supply/`, and
   `market.test.js` pins that at source level because it is the one failure that
   would be silent — no emulator here, and a duplicated copy does not throw, it
   just makes every printed pull rate wrong. Lock-on-collect applies to a bought
   card: your first copy of anything arrives `collected` and is immediately
   unsellable. `getMarketPrice` survives demoted to a seller's anchor, shown on
   the market only when it disagrees with the ask by more than 15%.
   UI: a `Market` view beside the Pack Shop (deliberately separate — the shop
   mints, the market does not) and a Sell action beside Burn on spares only.
4. Set-pack repricing, once the dynamics are observable.
5. Cloud Functions for the three writes that matter.

Steps 1-3 are each independently shippable and each leaves the game working.
