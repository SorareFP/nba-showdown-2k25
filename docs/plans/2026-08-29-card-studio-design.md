# Card Studio — Design

**Date:** 2026-08-29
**Status:** Approved

## Problem

The existing 306 player cards were built one at a time by hand in Canva. The new season's set is ~331 players (see `memory/new_season_player_pool.md`), needs new team logos/colors, and needs stats from the regenerated `scripts/cardgen/` pipeline. Rebuilding that by hand is not viable, and it has to be repeatable every season rather than a one-time effort.

Two explicit constraints from the user:

1. **No cookie-cutter look.** A rigid template stamped 331 times is the failure mode to avoid.
2. **No generative-AI card art.** Past attempts looked bad. Ruled out for player imagery.

## What the current cards actually are

Verified by inspecting the assets, not assumed:

- `public/cards/players/*.png` and the source folder `C:\Users\hoops\OneDrive\Pictures\NBA Showdown 2K25\` hold the **same fully-composed cards** — photo, frame, team colors, logos, *and* the stat table all flattened into one PNG. There is no separate raw-photo library.
- Dimensions are **843×1181 at 337 DPI = exactly 2.5″×3.5″**, standard trading-card size. These were built for print.
- Stats exist in two places: baked into the PNG pixels, and rendered again as live text by the app (`PlayerCard.jsx:43-51`, `CardLightbox.jsx:105-108`). So a stat change today silently staleness the card art.
- The template is **identical on every card**. What makes the set feel handmade is the *photography* — LeBron holding the MVP trophy vs. Anthony Edwards dunking on John Collins. The frame contributes almost no variety, and doesn't need to.

That last point is the key insight: the part that creates the handmade feel (photo selection) is manual anyway; the part that's tedious (laying out frame, table, logos, colors 331 times) is exactly what automates well.

## Decisions made

**Photo strategy: curated action photos.** Considered and rejected: official NBA headshots for everything (verified working at `https://cdn.nba.com/headshots/nba/latest/1040x760/{PERSON_ID}.png` — transparent background, current uniform, free, covers 319/331), and a hybrid headshot-floor/action-photo-upgrade. The user chose curated action photos for the whole set, matching the existing style. Headshots are retained only as a **render fallback** so a player without a curated photo still produces a complete card instead of a hole.

**Approach: programmatic compositing via HTML/CSS, driven by an interactive local tool.** Considered: Canva Bulk Create (stays in a familiar tool, but photos are still placed by hand, exporting 331 pages is painful, and regeneration after a stat change means redoing the run), and a hybrid Canva-frame + scripted-fill (inherits downsides of both). Chose HTML/CSS because it gives real typography and layout control, iterates live in a browser, and regenerates the full set in minutes. Canva remains a fallback if this proves wrong.

**Shape: a Card Studio, not a blind batch script.** Since photo curation is manual, it needs a visual loop. A headless script alone would mean guessing crops and re-running to check.

## Design

### Card Studio

A **dev-only route** (e.g. `/studio`) inside the existing repo, excluded from the production build. Reuses the project's existing React + Vite setup and reads generated card data directly. Nothing extra to deploy or host; it never ships with the game.

What it does:

1. **Player list** — all ~331, showing photo status, so set-wide progress is visible.
2. **Photo drop** — drag a file onto a player; saved to `card-art/photos/{playerId}.jpg`.
3. **Crop/position** — pan and zoom the photo within the card's photo window. Saves **metadata** (focal point, zoom, offset), never modifies the source image. Re-cropping later doesn't require re-sourcing, and a template change doesn't destroy existing crops.
4. **Live preview** — the real card with real stats, updating as adjustments are made.
5. **Team template editor** — edit a team's colors/accent treatment once; every player on that team updates.

### Single source of truth

**One React card component renders both the live preview and the exported PNG.** There is no separate design file that can drift from what gets exported — what the studio shows is literally what gets written to disk.

### Data inputs

Three, kept separate:

1. **Card data** — from the existing `scripts/cardgen/` pipeline (name, team, position, speed/power, boosts, salary, roll chart).
2. **Player photos** — curated, one per player, plus crop metadata.
3. **Team table** — new file: 30 teams × `{name, primary color, secondary color, logo file}`. Logos to be sourced and added locally by the user.

### Export

A batch command renders all players through the same component at 843×1181 and writes to `public/cards/players/{playerId}.png` — the exact path and naming the app already expects, so no app changes are required. Re-runnable: if stats change, re-export and every card is current, with crops and team colors preserved.

## Prerequisite data fix: fake team codes

**45 of 331 players (14%) have `2TM`/`3TM` as their team** — Basketball-Reference's multi-team aggregate rows, not real teams. Includes James Harden, Jaren Jackson Jr., Ivica Zubac, Darius Garland, Bennedict Mathurin, CJ McCollum. A logo and team colors cannot be assigned to "2TM", and it conflicts with showing players in their current uniform.

**Resolution source: `https://www.nba.com/players`.** The page embeds a `__NEXT_DATA__` JSON blob with all 581 active players including `TEAM_ABBREVIATION`, `TEAM_CITY`, `TEAM_NAME`, `PERSON_ID`, `JERSEY_NUMBER`, and `POSITION`. Verified: **319/331 pool players match** by normalized name, and every `2TM`/`3TM` player resolves to a real current team.

The **12 unmatched** players are retired or unsigned free agents — Russell Westbrook (confirmed retired by the user), Bobby Portis, GG Jackson II, Cam Thomas, Vince Williams Jr., Walter Clayton, Ron Holland, Robert Williams, Ochai Agbaji, Guerschon Yabusele, Jonas Valančiūnas, Drew Eubanks. They won't appear on an active-roster source by definition and need teams assigned manually in the studio.

`PERSON_ID` from the same blob is also what makes the headshot-fallback URL work.

## Anti-cookie-cutter levers

Variety is placed where it's visible, rather than avoided by working slower:

- **Per-team palettes** — not one navy for all 30 teams.
- **Curated action photography** — the primary driver, as in the current set.
- **Focal-point-aware crops** — per-player positioning rather than one fixed crop box.

Deferred: tier/rarity treatments (stars framed differently from role players). Worth revisiting once the base set exists.

## Out of scope

- **Photo sourcing/search inside the studio.** Drag-and-drop from local files only for now.
- Arbitrary drag-anywhere element positioning, a layer system, per-card one-off layout overrides — design-tool rabbit holes.
- Generative AI for player imagery — ruled out.
- Team logo sourcing — the user will add logo files locally.
- Changes to the game app itself; output paths are unchanged, so no app changes are needed.
