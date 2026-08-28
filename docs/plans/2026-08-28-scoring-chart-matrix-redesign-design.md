# Scoring Chart Matrix Redesign — Design

**Date:** 2026-08-28
**Status:** Approved

## Problem

The current 306-card scoring chart data (`src/game/rawCards.js`) produces too much guaranteed scoring at the low end of the roll range. As of 2026-08-28:

- 70 of 306 cards (23%) score points even on the worst possible roll (natural 1).
- Only 7 of 306 cards (2%) have a second non-scoring tier above the bottom one.
- 168 of 306 cards (55%) have a true 0pt/0reb/0ast bottom tier — the rest land somewhere between "0 points but still gets a rebound/assist" and "scores regardless."

For the upcoming season's new card batch (a fully new player pool, not a refresh of the existing 306), every card should guarantee at least one true 0pts/0reb/0ast outcome, with a second non-scoring tier as the norm rather than the rare exception.

## Background: the original methodology (source recovered 2026-08-28)

The spreadsheet that originally generated `rawCards.js` (referenced only in a code comment: "Generated from Final Cards spreadsheet") was not on Google Drive, but **was found as local files in Downloads** and copied into `card-data/source-recovered/` in this repo (gitignored — the repo is public on GitHub, this data is not). That folder contains the literal `Final Cards.csv`, the matchup-matrix outputs, and — critically — a "Chart playground" sheet (in `Corrected_Speed_and_Power_Attributes.xlsx`) with **live, working Excel formulas** for the scoring-chart derivation, plus real individual game logs used to calibrate it. A separate corrupted master workbook (`NBA Showdown 2K25-DESKTOP-VFORBTS.xlsx`) was recovered byte-for-byte via raw zip-part extraction and contains a ~557-player season stat dump (Per36/Per100/Advanced). Full detail in `memory/scoring_chart_methodology.md`.

Verified method (from live formulas, not just recollection):

1. Start from individual real game logs (PTS/REB/AST + minutes), not season averages.
2. Normalize each game to a minutes basis: `PTS_norm = (PTS * (36/minutes)) / minutes` — note this divides by minutes **twice**, not the standard single-division per-36 rate. Flagged as unconfirmed whether intentional; the implementation plan includes a task to test both variants against a real player's known published chart.
3. Cut the normalized distribution at the 10th/33rd/50th/66th/90th percentiles via `PERCENTILE.EXC(FILTER(...), p)`; each band's magnitude value is `ROUNDDOWN(threshold * 4, 1)`.
4. Roll-range **width** per band comes from counting how many historical games fell at/below each threshold (`COUNTIFS`), then scaling those counts proportionally against a **25-slot total** — a band with more historical games gets more roll slots.
5. Steps 2-4 are done independently for PTS, REB, AST, then reconciled onto one shared roll-range table.

Philosophy (confirmed via the user's own extended writeup, see `memory/card_design_philosophy.md`): probability × magnitude, not a flat average — a card is a statistical fingerprint of how often a player reaches each performance level and what that level is worth, not "he averages 25, give him 3 every roll." Speed/Power/Shot Line/bonuses are a separate system (a matchup-matrix-derived budget split by position), built independently and merged only at the final card. This redesign does not touch that system.

## Why the zero floor doesn't emerge naturally

Real rotation players essentially never post a literal 0-point game, so the pure percentile magnitude cut (step 4) rarely produces a 0 at the bottom of the chart on its own — which is exactly why so few of the existing 306 cards have one. The zero floor has to be an intentional rule layered on top of the statistical method, not something we wait for the stats to produce.

## Constraints

- Card art (Canva) does not need to change — confirmed the chart numbers are rendered by the app as text over the card image (`PlayerCard.jsx`, `CardLightbox.jsx`), not baked into the art. This is a pure data change.
- Output must stay compatible with the existing `chart: [[lo, hi, pts, reb, ast], ...]` shape consumed by `cards.js` / `engine.js` / `lookupChart()` — no changes needed to game logic.
- Formula-driven generation is preferred over hand-curating 300+ cards again, with a lightweight way to nudge individual players afterward.

## Design

### 1. Data input — two separate needs, two separate sources

The scoring chart (this redesign) needs a **real distribution of individual games per player** — a single point-estimate isn't enough to cut percentile bands from. The Speed/Power/defBoost layer (out of scope here) needs the opposite: a single point-estimate per player. Don't conflate the two:

- **Scoring chart input — real per-game box scores.** Primary: the dunksandthrees.com API once available ("shortly," per a contact who can provide it). Fallback: Basketball-Reference per-game logs. Some amount of modeling will still be needed where full game-log coverage isn't available for a given player — not a pure lookup for all 300+ players.
- **Speed/Power/defBoost input (future pass, not built here) — EPM and DEF EPM point-estimates**, scraped today from the public, server-rendered `https://dunksandthrees.com/epm` leaderboard (no documented export/endpoint yet) until the real API ships. Recorded for the next design pass in `memory/dunks_and_threes_stats_source.md` and `memory/speed_power_methodology.md`.
- Ingestion is a source-agnostic interface (one normalized game-log record shape in, regardless of provider) so a second data source can be added later without touching the percentile/magnitude logic downstream.

### 2. Frequency + magnitude bands

Implements the verified formula from the Background section: `PERCENTILE.EXC` cuts at 0.1/0.33/0.5/0.66/0.9 on the normalized per-game distribution set each band's magnitude (`ROUNDDOWN(threshold * 4, 1)`), and proportional counts at/below each threshold (scaled to a 25-slot total) set each band's roll-range width — computed independently for PTS/REB/AST, reconciled onto one shared roll-range table per player. The minutes-normalization formula's single- vs. double-division question (see Background) gets resolved empirically as the first implementation task, against a known player's real published chart in `Final Cards.csv`.

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
