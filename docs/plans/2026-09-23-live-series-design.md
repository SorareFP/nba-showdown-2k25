# The Live Series — design (2026-09-23)

The user: "I want to wire up the 'Live Series' card. These will be the 26-27
base cards with an electric blue trim like the green of the rookie cards, and
what these are going to do is contain a live export using the expected EPM
page of dunks and threes. This won't be necessary until the start of the NBA
season, but I want to start to get it wired when we have nothing else going.
Those will need a job to run each day that reallocates stats and re-exports
the faces."

Decisions taken the same day (asked, answered):

| Question | Answer |
| --- | --- |
| The feed | dunksandthrees' current-season EPM — the site's `/epm` (the stabilised, "expected" table) and `/epm/actual`, which `scripts/cardgen/sources/dunksAndThrees.js` already reads, and the keyed API for anything the page will not serve. |
| What moves | Everything, daily: Speed, Power and Def Boost from the EPM feed; the shot lines and the roll charts from the last-82 window as this season's game logs replace last season's. |
| What a Live card is | Its own set, `live`, pulled from packs: in the boosters at the special share plus a Live Series Pack, with a collection goal and a market listing. A pulled card's numbers move nightly. |
| Where the job runs | GitHub Actions on a nightly cron (`.github/workflows/live-series.yml`), the API key a repository secret, puppeteer for the faces, a commit and a Pages deploy. |

## What is built (slice one)

- `src/cards/sets.js`: the `live` set (`LIVE_SET`), `kind: 'special'`, badge `LIVE`, treatment `blue-accent`; its photos, crops and team colours are the base set's (`setPaths`). `LIVE_SERIES_ON = false` is the launch switch — declared in `src/cards/liveSeries.js` (which imports nothing and ships to Cloud Functions, because the pack engine and the collection goals read it on the server) and re-exported by sets.js.
- `src/cards/treatments.js`: `blue-accent`, the rookie green's exact shape in electric blue (`BLUE #1E7BFF`).
- `src/cards/badges.js`: the `LIVE` pill, blue on the untreated theme.
- `src/game/cardSets.js`: the set registered from `card-data/generated/cards-live.json`, so a live card can be owned, shown and played.
- `scripts/cardgen/generateLive.js`: **mirror mode** — every base card again with the set, the pill and a `live: { mode, asOf, source }` stamp; `live-status.json` for the whole set. **Season mode refuses** until it is wired (below), so the job cannot ship a mirror as live.
- Packs and goals, gated on `LIVE_SERIES_ON`: `live_pack` (5 + 2 strats, 100 — to be measured against the booster before launch), `live` in `SPECIAL_SETS_IN_PACKS`, a `live` collection goal.
- The Studio lists the set (preview and export only; curate art on the base set). `export.js --set live` writes `public/cards/live/`.
- The nightly workflow, gated on the repository variable `LIVE_SERIES=on`; a manual run works today (mirror).
- **The faces are never committed.** One set's faces are ~230 MB and all 348 change every night, so `public/cards/live` and its thumbs are gitignored: the runner exports them, `npm run deploy` publishes them from `dist/`, and only `cards-live.json` and `live-status.json` are committed, so the app's numbers and the faces on Pages come from the same run. gh-pages keeps whatever a later deploy does not touch, so a local deploy leaves the night's faces alone — as long as no stale local export sits in `public/cards/live` (delete one before deploying). The cost: a local deploy bundles whatever `cards-live.json` the checkout has, so pull before deploying in season, or the numbers lag the faces by a day until the next run.

## What is not built — the season mode

`generateCards.js` reads the whole `card-data/cache` (325 MB, gitignored: Basketball-Reference tables and 2,200 game logs) and a fixed `CURRENT_STATS_SEASON`. A runner has neither. The plan:

1. **A committed basis.** `scripts/cardgen/buildLiveBasis.js` writes `card-data/generated/live-basis-2027.json` from the local cache: for each pool player the last-82 window's game rows in the fields the chart reads (date, minutes, PTS, REB, AST, the shooting splits the shot lines use), the calibration constants, biometrics, positional shares, the EPM basis (`epm-archive.json` already is one). A few MB of derived per-game box lines, not the tables themselves.
2. **A season-parameterised generate.** Factor `generateCards.main` so the season, the EPM rows and the game-log reader are inputs (`generateCardsFrom({ season, rates, actual, logsFor, basis })`); the base set keeps calling it as today.
3. **The nightly inputs.** `fetchLiveInputs.js`: the `/epm` and `/epm/actual` scrapes for 2027 (one request each; the site is courteous-rate-limited) and this season's game logs for the pool from Basketball-Reference (~350 players a night at the site's rate, resumable, cached in the runner between nights via `actions/cache`).
4. **Season mode** in `generateLive.js`: basis + nightly inputs → cards; the window shifts a game at a time from last season into this one, so the numbers move a little every night and a lot by December.
5. **Launch**: flip `LIVE_SERIES_ON`, set the repo variable, measure the Live pack against the booster, add the NEWS item.

Open questions for the user before step 1: whether a compact derived basis of per-game box lines may live in the public repo (the cache is kept out because it is a bulk copy of others' data); and whether early-season cards should lean on last season (the window) or on dunksandthrees' stabilised expected rates alone.
