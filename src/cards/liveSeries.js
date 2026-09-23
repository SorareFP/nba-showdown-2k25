// THE LIVE SERIES' SWITCH (2026-09-23), on its own so the server can read it.
//
// The pack engine and the collection goals both gate the `live` set on
// LIVE_SERIES_ON, and both ship to Cloud Functions (functions/prepare.mjs).
// sets.js does not ship — it drags badges.js, fieldTheme.js and treatments.js
// behind it — so the switch cannot live there. This module imports nothing.
// sets.js re-exports both names, so the app reads them from either place.

export const LIVE_SET = 'live';

// The launch switch. Off until the NBA season starts and the season mode of
// scripts/cardgen/generateLive.js is wired (docs/plans/2026-09-23-live-series-
// design.md). While off, the set exists in the model — the Studio can preview
// and export it, the generator can run — but no pack deals it and no
// collection goal asks for it.
export const LIVE_SERIES_ON = false;
