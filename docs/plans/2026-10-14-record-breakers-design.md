# Record Breakers — design

2026-10-14. From Ryan's suggestion ("a dissonance card for breaking lebrons all
time scoring record") and the user's direction the same day: "I want the badge
to say 'Record Breakers' and I think it'd be good to make a different set of
cards for these … maybe not the throwback motif."

## Decisions (the user's)

- **What earns a card:** career records (the season a player took the all-time
  lead, even if since passed) and single-season records (current holders only).
  Seasons the archive holds (1976, 1977, 1983, 1985 on).
- **A record season that already has a card keeps it** and gains the plaque; the
  set is made of seasons nobody has carded.
- **Feat cards come only from feats** (never packs). Blocks and steals records,
  which the game cannot track as feats, are dealt in packs like any special set.
- **A collection goal, coins only:** "Does not need to have a reward card."
- **The look: the Lit plaque** (chosen from mockups): platinum frame and pills,
  and a lit LED plate on the photo carrying the record.
- **Built as its own set from a curated list** (approach 1).
- Robert Parish is out ("You can skip Parish").

## The roster (12 new cards, 3 plaques on existing cards)

| Season | Player | Plaque | How it is earned |
|---|---|---|---|
| 2022-23 | LeBron James | 38,388 · ALL-TIME PTS | feat: career points |
| 2010-11 | Ray Allen | 2,561 · ALL-TIME 3PM | feat: career threes (N₁) |
| 2021-22 | Stephen Curry | 2,974 · ALL-TIME 3PM | feat: career threes (N₂ > N₁) |
| 2020-21 | Russell Westbrook | 182 · ALL-TIME TRIPLE-DOUBLES | feat: career triple-doubles |
| 2000-01 | Karl Malone | 8,532 · ALL-TIME FTM | feat: career free throws made |
| 1990-91 | John Stockton | 1,164 · AST | feat: assists in one season |
| 2008-09 | José Calderón | 98.1% · FT | feat: FT% in one season, min attempts |
| 2009-10 | Kyle Korver | 53.6% · 3PT | feat: 3PT% in one season, min attempts |
| 1995-96 | John Stockton | 2,311 · ALL-TIME STL | packs |
| 1995-96 | Hakeem Olajuwon | 3,190 · ALL-TIME BLK | packs |
| 1984-85 | Mark Eaton | 456 · BLK | packs |
| 1985-86 | Alvin Robertson | 301 · STL | packs |

Plaque only, on cards that exist: Curry 2015-16 Super Season (402 · 3PM),
Westbrook 2016-17 Super Season (42 · TRIPLE-DOUBLES), Stockton 1994-95 Super
Season (9,922 · ALL-TIME AST).

Verified 2026-10-14: Stockton's steals (Feb 20, 1996), Westbrook's 182nd
(May 10, 2021), Karl Malone's free throws (Mar 24, 2001). Hakeem's 3,190th
block (one source: Apr 21, 1996) is confirmed against Basketball-Reference's
season totals before his row is built. Every season record is checked against
the season's own numbers by the builder, which refuses a row that disagrees.

## The face

- **Set treatment `platinum`** (treatments.js, beside gold foil and the trims):
  the team field as every set, plus a platinum outer frame (new to the
  template, the one structural addition) and platinum pills. No foil sheen.
- **Badge:** RECORD BREAKERS (badges.js `RECORD_BREAKERS_BADGE`).
- **The lit plaque** (new CardTemplate piece, any set): a platinum-rimmed black
  LED panel on the photo's lower edge; the number in amber digits, the record's
  name smaller beneath, RECORD BREAKER engraved on the rim. Read from a
  generated `card-data/generated/card-records.json` keyed by set and card id,
  the way awards are. A one-line record prints on the number line alone.
- The three Super Seasons keep their foil and pill and gain the plaque.
- The REC award mark added this morning is removed (the plaque replaces it);
  `manual-awards.json` and its reader stay for future one-off marks, empty.

## Data and build

- `card-data/record-breakers.json`: one row per record: bbrefId, name, season,
  `plaque` { number, label }, `earn` ("pack" or a feat id), `why`; a plaque-only
  row names its existing card (`card: "super-season:Stephen_Curry"`) instead.
- `scripts/cardgen/generateRecordBreakers.js` builds each new row through the
  Free Agents builder (real game log, priced against the base), checks season
  records against the log or season table, and writes
  `cards-record-breakers.json` (set `record-breakers`) and `card-records.json`.
  Runs after generateCuratedCards in the pipeline.
- `sets.js` row: id `record-breakers`, name "Record Breakers", kind special,
  badge, treatment `platinum`, shows season. cardSets joins the file.
- LeBron 2022-23 leaves `curated-cards-2026.json`; its photo and crop move to
  `card-art/sets/record-breakers/`. Nobody holds it (never deployed), so no
  alias or settlement is needed.
- Every new card is `photoWanted`, so the Photo Hunt lists the ones without a
  photo. The dormant rule (dormantThrowbacks.mjs) extends to this set's file:
  a card with no photo is in no pack and no goal until its photo lands, so a
  blank face is never dealt or required.

## Packs and collections

- `record-breakers` joins SPECIAL_SETS_IN_PACKS; `poolFor` drops every card
  whose `earn` is a feat, so only the four pack cards are ever dealt (boosters'
  special share, their franchise's team packs).
- Collections: a `set-record-breakers` goal (all 12), in COINS_ONLY_GOALS.

## Feats

- Granted by the server, once per account (`users/{uid}/feats/{featId}`),
  minting the card through the existing `recordMints`; the player sees it like
  a reward chip on Home and in the results screen.
- **Career feats** are judged in `claimGameReward` after the lifetime card
  stats are updated, in the same transaction: any one card crossing the line.
  The lifetime tracker gains `ftm` and `td` (a per-game triple-double, at the
  game's own scale — defined from the measurement below).
- **Season feats** are judged when a season's regular season ends (and on any
  later claim from it): one player's season line, with at least G games played.
  Read from `users/{uid}/seasons/{id}`, the same client-written data the box
  score already trusts, sanitized server-side.
- **Thresholds (N, N₁, N₂, X, M, G) are measured, not guessed:** simulated games
  give how fast each stat accumulates; each feat is set to take about as many
  games as finishing a collection whose reward is worth about the card. The
  numbers go to the user for approval before the feats ship.

## Order of work

1. The face: `platinum` treatment, frame, pill, lit plaque, on LeBron's real
   card in the Studio; exported for the user to judge before anything else.
2. The set: data file, generator, sets.js, cardSets, Studio source, LeBron's
   move, the roster built and photographed through the hunt.
3. Packs and the coins-only goal.
4. Feats: tracker fields, measurement, thresholds (user approves), server
   grant, client display.
5. News item, How to Play / Rulebook lines, memory.

## Testing

Unit tests for: the plaque join and render (renderToStaticMarkup), the
generator's record checks (a wrong number refuses), poolFor never dealing a
feat card over many packs, the goal's contents and coin-only payout, each feat
predicate at, below and above its line, the once-per-account grant, and the
season feat's minimum-games rule. The functions harness covers the grant inside
claimGameReward. Faces checked by eye on the exported PNGs.

## Not in this

Single-game feats (Kobe's 81), steals tracking, a reward card, a Record
Breakers pack of its own, WNBA records (later rows in the same file).
