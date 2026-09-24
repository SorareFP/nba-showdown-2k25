# The Super Season is the player's most valuable season

The user, 2026-09-23, on Maya Moore: her requested 2016 card cost more than her Super Season (2014). "I'd like to know why the correct SS years were not allocated correctly." And on 2026-09-24: re-pick on value, and "if there is something already made that should be a super season, just swap it out."

## Why the years were wrong

Four causes stacked up:

1. **The pick and the price measured different things.** Super Season years were chosen by a box-score rating: z(BPM) + z(VORP) against the season's league for the NBA, and the fitted-BPM z for the WNBA. A card's salary prices what its finished chart, Speed/Power, Shot Line, 3PT/Paint Bonus and Defense are worth in this game. The two disagree when a season's shape differs from its box score.
2. **Nothing compared a Super Season with the player's other seasons.** Those seasons were never built. The only guards compared it with the current base card (BEATEN_BY_BASE) and the Rookie card (BEATEN_BY_ROOKIE).
3. **A card's price depended on its batch** (fixed in 2cb684eb). The model's team term averaged assists and rebounds over the cards priced together. Maya 2016 read $1,410 in the requests file and about $1,440 priced alone. A whole set inflated or deflated its own prices, with Super Season about $12 high and Rookie about $14 low.
4. **The WNBA shooting scale depended on the batch too** (fixed here). The Shot Line and 3PT scale was fitted over the pool plus the cards being built. Maya 2016 came out Line 14 / 3PT +2 built alone and Line 15 / 3PT +3 inside the legends' batch. It is now anchored on the pool rows (`referenceCount`), as the NBA special sets already were.

The salary model's currency rates were also stale (fixed in e55a187c): it priced a rebound above an assist.

## The rule now

- **Candidates.** Every season of a Super Season player that clears the box-score rule's own eligibility floors (`eligibleSeasons` in history.js; `legendEligibleSeasons` for the WNBA) is built in the set's batch and priced on the base field. The base season and the player's rookie season stay out, because the base-card and Rookie rules still decide those.
- **Real logs only.** A candidate whose chart would be synthetic does not compete; synthetic charts price about 60% high. `--list-missing-logs` writes the plausible ones (quoted within two noise widths) for `fetchSpecialGameLogs.mjs --only-file` or `wnba/fetchWnbaGameLogs.mjs --only-file`.
- **The pick.** The most valuable season wins. A tie keeps the declared season: the box-score pick, a legend's named season, or a standout.
- **Retired seasons.** A season that shipped as a Super Season and is no longer one becomes a Throwback (`<id>_<season>`, `demotedFrom`). It is kept in `card-data/super-season-retired.json` (WNBA: `wnba-super-season-retired.json`), so it is emitted on every later run. "Shipped" means the Super Season file or the demoted file as they stand before the run, so restore both before a dev re-run.
- **Swaps.** A winning season that already exists as a requested (Free Agents) or curated (Throwbacks) card is absorbed. The Super Season records `migratedFrom`, the old copy leaves its set, and its key aliases to the Super Season (`DERIVED_ALIASES` in cardSets.js).
- **Rewards.** A built reward whose season is now the Super Season migrates from it and wears the gold, as John Wall's does. A reward that migrates from a Super Season whose season moved re-points to the retired Throwback, as David Robinson's does.
- **Best everywhere.** The Free Agents classifier, the reward identity and the badge audit judge a player with a Super Season card against the season that card carries (`superSeasonMap` in rewardIdentity.js). They fall back to the box-score rule for players with no card.

## Pipeline

`generateSpecialSets` (with `--list-missing-logs` when new seasons may matter) → fetch the logs → `generateSpecialSets` → `wnba/generateWnbaLegends` → `wnba/generateWnbaRookies` → `auditSuperSeasonBadges --fix` → `generateCuratedCards` → `generateTeamRewards` → `wnba/generateWnbaRewards` → `generateSetRewards` → audit again → `scripts/studio/superSeasonArt.py --apply` → `migrateRewardArt` → `freeAgentQuotes` → `generateAwards` / `wnba/generateWnbaAwards` → `functions/prepare.mjs`.

## Still open

- **Base-season players.** A player whose box-score best is the current season is excluded before any value pick, so an older, more valuable season of his is never weighed against his base card.
- **Lockout seasons.** The flat 58-game floor keeps every 1998-99 season (50 games) out of the running, Shaquille O'Neal's included. The WNBA floor is a share of the schedule; the NBA's is not.
