# Free Agents: requested cards

Status: design, 2026-09-10. All open points decided the same day (see "Decided after the first draft"). Not built.

## What the user decided

- **Always buy, any rarity.** Every requested card comes back to the requester as a free-agent offer at its price. No card is free by default.
- **Gift override.** An admin can gift a requested card instead. A gifted copy is locked the way reward copies are (state `EARNED`): playable anywhere, never sold or burned, and it counts as collected.
- **Price.** For the requester, between the rarity price table and the pack-odds cost, leaning toward the table.
- **Collections are automatic.**
  - A rookie season joins Rookie.
  - A playoff-only run joins Summer Standouts.
  - A season that meets the Super Season bar joins Super Season.
  - Dissonance is an admin call.
  - Everything else goes to a new catch-all set, **Throwbacks**, with its own design.
- **The requester enters only a player and a season.** They get back a salary, a rarity and an invoice cost. The rest of the card stays a surprise.
- **Three open requests per player.** Asking is free.
- **Everyone else gets it from packs.** Once a request is fulfilled, its card goes into packs by its set and rarity.

## The one constraint: the quote is precomputed

The generator cannot run inside the site. It reads a 325 MB stats archive (`card-data/cache`) and fetches Basketball-Reference game logs. It also uses the dunksandthrees API key, which must never reach the site.

So "the algorithm runs on site" becomes: **run the generator ahead of time for every player-season in the archive, and ship only the answers.**

- `scripts/cardgen/buildQuoteIndex.mjs` runs `buildSet` / `buildHistoricalCard` over the archive's player-seasons:
  - 24,153 NBA rows, 1976–77 and 1985–2026;
  - the WNBA tables;
  - EPM for 2002–2026, regular season (st2) and playoffs (st4).
- It writes `card-data/generated/quote-index.json`. That is about 28,000 rows of `player id, name, season, kind (regular|playoffs), salary, rarity, set, price`, roughly 300 KB compressed.
- The site loads it only when the request form opens. `functions/shared` copies it, so the server prices a request itself and a client can't fake a quote.
- A season that already has a card is marked `carded`, and the form says where the card lives. That covers the current base set, a special set, or a reward. There is no second card of the same season.
- Rebuild the index whenever card pricing moves. It becomes step 4 of the generation pipeline (see the cardgen pipeline order).
- Pricing uses real game logs where they are cached, and the season-level path otherwise. The season-level path runs high for stars.

**Quote vs invoice (decided): the invoice is the finished card's price.** The quote is an estimate. The final card is rebuilt with real game logs at fulfilment and can move either way (stars usually go down).

## Classification (which set a request lands in)

Applied in this order, with the rules the existing sets already use:

1. **Playoffs** requested → **Summer Standouts**, built from the playoff table (`summerStandouts.js`, with the BPM bridge before 2002).
2. **The player's first season** with at least 20 games and 600 minutes (`ROOKIE_MIN_GAMES`, `ROOKIE_MIN_MINUTES`) → **Rookie**. Seasons at the archive's window edge cannot be proven debuts (the 1978–84 gap), so they fall through to the next rules.
3. **The player's best season** on the BPM + VORP composite, with the `BEST_SEASON_MIN_*` games and minutes → **Super Season**. It prints BEST SEASON if it lands under `SUPER_SEASON_MIN_SALARY`, as today.
4. **Anything else** → **Throwbacks**.
5. **Dissonance** is never automatic. The Studio has a toggle for it.

## Price

`price = table^(1-w) × packOdds^w`, where:
- `table` is `MARKET_PRICES[rarity]`;
- `packOdds` is the expected coins to pull that exact card from its cheapest qualifying pack, computed with the per-card pull odds `collectionDifficulty.js` uses.

| Pack-odds weight `w` | Common | Uncommon | Rare | Super Rare | Legendary |
|---|---|---|---|---|---|
| 0 (table only) | 40 | 100 | 600 | 2,000 | 5,000 |
| 0.1 | 60 | 160 | 810 | 2,750 | 6,750 |
| **0.2 (decided)** | 100 | 260 | 1,100 | 3,780 | 9,100 |

Rookie cards come out slightly cheaper at the same weight (Rare 970 at 0.2), because their pack is cheaper. The literal pack-odds cost is far above any of these: a base Rare costs about 12,500 coins through the NBA Booster, and a Super Season Legendary about 1.8 million through its own pack. **Decided: `w = 0.2`.**

## Packs and collections

- **Throwbacks** joins `SPECIAL_SETS_IN_PACKS`. Boosters draw from it by rarity, under the existing `SPECIAL_BAND_SHARE` cap. A Team Pack draws the franchise's throwbacks through `currentFranchise`, the Kawhi-in-Toronto rule.
- A request that lands in Rookie, Super Season or Summer Standouts goes wherever that set already goes, and joins that set's completion goal. Anyone who had finished the goal sees it reopen; their claim stays paid (claims are receipts).
- **Throwbacks has no completion goal (decided).** It grows with every request, so a goal would keep reopening.
- **The Throwbacks look (decided): "somewhere between vintage and base."** The 2026-27 layout with vintage touches. It is mocked up for the user's approval before shipping.

## Flow

1. **Request, in the app.** The player picks a player and a season (and regular season or playoffs) and sees the quote: salary, rarity, price. Submitting calls `requestCard`. The server re-prices it from the index, refuses a `carded` season, and enforces three open requests. It writes `cardRequests/{id}` with `{ uid, playerId, season, kind, quote, status: 'requested', createdAt }`.
2. **Card Studio.** Admins sign in with Google, checked against the same `ADMIN_EMAILS` the dev callables use, so no service-account key is needed. A Requests tab lists the queue. For each request:
   - it generates the card with real logs, fetched for that player, and checks `provisional`;
   - the admin confirms the set (Dissonance toggle), adds a photo and exports the face;
   - the card is written into its set's generated JSON.
3. **Deploy**, by the user: Pages plus Functions. The server has to know the card before it can mint one.
4. **Fulfil**, from the Studio. `fulfillCardRequest` (admin) refuses a card the live server cannot find, which means "deploy first". Otherwise it sets `status: 'invoiced'` with the invoice price and writes a notice for the requester. `giftRequestedCard` (admin) mints one `EARNED` copy instead.
5. **Sign**, in the app. The notice shows on Home and in Collection. `signFreeAgent` checks the coins, deducts the price and mints a normal spare in one transaction, and counts it in supply like any mint.

## Server and rules

- Callables:
  - `requestCard` and `signFreeAgent`, for players;
  - `fulfillCardRequest` and `giftRequestedCard`, admin-only through `ADMIN_EMAILS`.
- `firestore.rules`: `cardRequests` can be read by its owner and by admins, and is written only by the server.
- Deploy needs Functions, the Firestore rules and Pages.

## Build order

1. The quote index and classification, offline, with tests.
2. `requestCard` and the request form, with the quote.
3. The Studio's Google sign-in, the Requests tab and the per-request generator.
4. Fulfil, gift, the invoice notice and `signFreeAgent`.
5. The Throwbacks set, its card design and its pack wiring.

## Decided after the first draft (2026-09-10)

- **Invoice:** the finished card's price; the quote is an estimate.
- **Price weight:** `w = 0.2` (Common 100, Uncommon 260, Rare 1,100, Super Rare 3,780, Legendary 9,100).
- **Throwbacks:** no completion collection.
- **Throwbacks look:** between vintage and the base design, mocked up for approval first.
