# Scoring Chart Matrix Redesign — Design

**Date:** 2026-08-28
**Status:** Approved

## Problem

The current 306-card scoring chart data (`src/game/rawCards.js`) produces too much guaranteed scoring at the low end of the roll range. As of 2026-08-28:

- 70 of 306 cards (23%) score points even on the worst possible roll (natural 1).
- Only 7 of 306 cards (2%) have a second non-scoring tier above the bottom one.
- 168 of 306 cards (55%) have a true 0pt/0reb/0ast bottom tier — the rest land somewhere between "0 points but still gets a rebound/assist" and "scores regardless."

For the upcoming season's new card batch (a fully new player pool, not a refresh of the existing 306), every card should guarantee at least one true 0pts/0reb/0ast outcome, with a second non-scoring tier as the norm rather than the rare exception.

## Background: the original methodology (recovered, not documented anywhere else)

The spreadsheet that originally generated `rawCards.js` (referenced only in a code comment: "Generated from Final Cards spreadsheet") could not be located — checked the repo, `docs/plans/`, and Google Drive including the project's own folder and Rulebook doc. The method below was reconstructed from the user's direct recollection on 2026-08-28 and is now the canonical record (see `memory/scoring_chart_methodology.md` and `memory/speed_power_methodology.md` in this project's Claude memory for the full write-up):

1. Start from individual real game logs (PTS/REB/AST), not season averages.
2. Normalize each game to a common minutes basis.
3. Cut the normalized distribution at the 10th/30th/50th/75th/90th percentiles to set **roll-range width** per band — proportional to how many historical games actually landed there (probability).
4. Cut a separate ~10th/33rd/50th/66th/90th percentile of production to set **each band's value** (magnitude), scaled into the game's point framework and floored to integers.
5. Do steps 3-4 independently per stat (PTS, REB, AST), then reconcile onto one shared roll-range table.

Philosophy: probability × magnitude, not a flat average — a card is a statistical fingerprint of how often a player reaches each performance level and what that level is worth, not "he averages 25, give him 3 every roll." Speed/Power/Shot Line/bonuses are a separate system (a matchup-matrix-derived budget split by position), built independently and merged only at the final card. This redesign does not touch that system.

## Why the zero floor doesn't emerge naturally

Real rotation players essentially never post a literal 0-point game, so the pure percentile magnitude cut (step 4) rarely produces a 0 at the bottom of the chart on its own — which is exactly why so few of the existing 306 cards have one. The zero floor has to be an intentional rule layered on top of the statistical method, not something we wait for the stats to produce.

## Constraints

- Card art (Canva) does not need to change — confirmed the chart numbers are rendered by the app as text over the card image (`PlayerCard.jsx`, `CardLightbox.jsx`), not baked into the art. This is a pure data change.
- Output must stay compatible with the existing `chart: [[lo, hi, pts, reb, ast], ...]` shape consumed by `cards.js` / `engine.js` / `lookupChart()` — no changes needed to game logic.
- Formula-driven generation is preferred over hand-curating 300+ cards again, with a lightweight way to nudge individual players afterward.

## Design

### 1. Data input — source-agnostic ingestion, dunksandthrees.com as the concrete source

Build an ingestion layer that isn't hard-wired to one provider, since the promised dunksandthrees.com API isn't live yet:

- **Interim source (usable now):** `https://dunksandthrees.com/epm` is a public, server-rendered leaderboard (full table in the HTML, not behind a client-side fetch) exposing, per player: EPM, MPG, USG, PTS, TS%, 2PA/2P%, 3PA/3P%, FTA/FT%, ORB, DRB, AST, TOV, STL, BLK, OFF/DEF component splits, all with percentile rankings. No documented export/endpoint, so this means a scrape rather than a clean API call — scrape it courteously (cache results locally, don't re-pull on every run).
- **Primary source (once available):** the dunksandthrees.com API, expected "shortly." Same logical data, cleaner access — swap-in replacement for the scrape, not a separate pipeline.
- **Prefer Estimated Skills over raw box scores** as the statistical input where available. Skills are already decay-weighted and de-noised per-stat (they solve the small-sample problem the original raw-game-log method had to handle manually via minutes-normalization). This is a genuine improvement on the original method, not just a substitution.
- Ingestion output is a normalized intermediate format (one record per player: id, per-stat skill/percentile values, EPM) that the rest of the pipeline consumes — this is the seam where a future second data source plugs in without touching anything downstream.

### 2. Frequency + magnitude bands

Unchanged from the original method: percentile cuts on the normalized input define roll-range width (how often) and a separate percentile cut defines each band's value (how much), computed independently for PTS/REB/AST and reconciled onto one shared roll-range table per player.

### 3. Zero-floor rule

Two parts:

- **Hard floor:** roll of natural 1 is unconditionally 0pts/0reb/0ast for every card. No exceptions, not derived from stats — a true safety net.
- **Statistically-driven expansion:** beyond that hard floor, the magnitude percentile cuts from step 2 get recalibrated (shifted/added lower cut point) so that more bands legitimately round to zero on their own merits. The goal is that most cards end up with 2+ zero tiers because the stats support it, not because a second tier is forced independent of the player's actual profile. A high-volume, high-floor scorer may still only get the guaranteed single zero tier; a low-usage or bench player may get three.

### 4. Manual overrides

A small, sparse override file keyed by player ID, applied as the final step after generation. Only players that have actually been tweaked appear in it — regenerating the full pool never wipes an override, and there's nothing to comb through for the untouched majority of the pool.

### 5. Output

Same shape the app already reads (`[lo, hi, pts, reb, ast]` tuples) — no changes required to `cards.js`, `engine.js`, or `lookupChart()`.

## Out of scope for this pass

- Speed/Power attribute generation and player-pool selection for the new roster — these reuse the existing matchup-matrix budget methodology (documented in memory) and aren't being redesigned here. EPM is a plausible future input to that system but isn't being wired in as part of this change.
- The exact recalibrated percentile cut-points for the "statistically-driven expansion" in step 3 — these get tuned empirically once real data is flowing, not hard-coded as part of this design.

## Future Work

- Swap the interim leaderboard scrape for the real dunksandthrees.com API once it ships.
- Evaluate EPM as an input to the Speed/Power matchup-budget system.
- Additional stat-source integration once identified.
