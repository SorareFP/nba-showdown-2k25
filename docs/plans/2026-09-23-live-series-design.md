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
- `scripts/cardgen/generateLive.js`: **mirror mode** — every base card again with the set, the pill and a `live: { mode, asOf, source }` stamp; `live-status.json` for the whole set. **Season mode** — built the same day, below.
- Packs and goals, gated on `LIVE_SERIES_ON`: `live_pack` (5 + 2 strats, 100 — to be measured against the booster before launch), `live` in `SPECIAL_SETS_IN_PACKS`, a `live` collection goal.
- The Studio lists the set (preview and export only; curate art on the base set). `export.js --set live` writes `public/cards/live/`.
- The nightly workflow, gated on the repository variable `LIVE_SERIES=on`; a manual run works today (mirror).
- **The faces are never committed.** One set's faces are ~230 MB and all 348 change every night, so `public/cards/live` and its thumbs are gitignored: the runner exports them, `npm run deploy` publishes them from `dist/`, and only `cards-live.json` and `live-status.json` are committed, so the app's numbers and the faces on Pages come from the same run. gh-pages keeps whatever a later deploy does not touch, so a local deploy leaves the night's faces alone — as long as no stale local export sits in `public/cards/live` (delete one before deploying). The cost: a local deploy bundles whatever `cards-live.json` the checkout has, so pull before deploying in season, or the numbers lag the faces by a day until the next run.

## The season mode (built 2026-09-23)

The two questions were answered the same day — "Yes, and the latter": a compact basis may live in the repo, and the early season leans on dunksandthrees' stabilised expected rates alone. The latter made the basis unnecessary: nothing of last season's is read. What the runner needs is the committed generated files (calibration, biometrics, positional shares, the EPM archive, the pool's Basketball-Reference ids in `pool-gamelogs-index.json`), two page reads, one keyed API call and this season's game-log pages.

**Every layer reads the expected page** (`/epm`, `toSeasonRate`), composed with the actual page's counts by `liveActualRow`:

| Layer | Source |
| --- | --- |
| Speed / Power / Def Boost | the expected EPM triple (a predictive figure — it differs from the actual page's by 0.72 EPM on average over 2025-26), through the archive-scaled composite of `speedPower.js`. EW per game, the composite's volume term, is **modelled** from EPM and minutes (`EW_PER_GAME_MODEL`: fitted on the 452 2025-26 rows with 20+ games, R² 0.9986) rather than read, because in October the real figure is a season total divided by three games. |
| Shot Line / Paint / 3PT | the expected shooting splits and attempt rates, handed to the shooting layer with a full season's volume behind them (`minutes = expected MPG × 82`): dunksandthrees has already regressed them toward a prior, and shrinking them again by ten games of attempts would flatten every card to the mean. |
| The chart | this season's real games (`realGames.js`, `liveRowsFromLog`: opponent-adjusted, minutes-damped, winsorized, no floor, capped at the last 82) **plus synthetic games from the expected per-100 rates for the rest of the 82** (`generateCards.js`, `fillGames`, evenly sampled through the synthetic log). Real games replace synthetic ones one at a time. |
| Salary | the play-value price against the live field, as the base set is priced. |
| Team | the expected page's — a traded player's live card moves with him; the photo stays the base set's. |

A base card whose player has no usable expected row is **mirrored** (the base numbers, repriced against the live field) and stamped with why. Every card carries `live: { mode, asOf, source, season, status, games: { real, synthetic } }`.

**The fill is calibrated to the base set's own scale** (`scripts/cardgen/calibrateLiveFill.js` → `card-data/generated/live-fill-calibration.json`). The variance model's level and spread in `card-calibration.json` were fitted against the *published* 2025-26 cards; the base set's charts are cut from *real-log rows* through `realGames.js`, and the two are not one scale: a pure-synthetic build came out 1.26× the base on points, 1.65× on rebounds and 2.03× on assists, with one or two extra printed rows on 137 of 348 cards. The fill therefore takes its level from the base set's real rows (the minutes-weighted mean normalized value over the predicted per-4-minute rate, one log-log line per stat), its spread from the same rows (`fitSpreadShape`, read with `sections: false`), and a per-stat scale that matches the synthetic bands' expected value to the real bands' through `computeStatBands`. Measured after: pure-synthetic over base 0.995 / 1.004 / 0.986 on PTS / REB / AST, the same distribution of printed rows, the top tier identical on 268–299 of 348 cards. Re-run the calibration after any change to `realGames.js` or to the base windows.

**Dry runs** on the cached 2025-26 season (`--offline --season 2026 --as-of …`): as of December 1 (334 players with ~20 real games) chart expected values match the base set's means to 0.01 and correlate 0.80–0.89; over the whole season 0.88–0.93 with salary at 0.935; the 50 players on a full real window reproduce their base charts to 0.05 a roll. Speed+Power correlates 0.89 — the expected EPM's view of a player, not the windowed actual's (Jokić, whose expected DEF EPM is above the archetype cut, keeps his S10/P20 instead of the base set's S5/P20 hole).

**Nightly inputs** (`fetchLiveInputs`): both dunksandthrees pages re-read (`force`), the playoff table when the site has one, the team-EPM series through the keyed API (`fetchTeamEpm`, `DUNKSANDTHREES_API_KEY`; without a key the games go unadjusted and the status says so), and Basketball-Reference game-log pages **only for players whose game count on dunksandthrees has moved past the cached page** — at the polite spacing, at most 220 a night (about twenty minutes), a failure leaving that player on the expected rates for the night. The runner keeps `card-data/cache` between nights with `actions/cache`. The season mode refuses until dunksandthrees serves the season asked for (`LIVE_SEASON` = 2027), so the scheduled job cannot run early by accident.

## Launch checklist

1. Once dunksandthrees flips to 2026-27: run the workflow by hand with `mode: season` and read `live-status.json` (rows matched, logs current, team-EPM refreshed). Whether Basketball-Reference serves an Actions runner is **unverified** — if it refuses, every chart stays on the expected rates and the status file says so.
2. Flip `LIVE_SERIES_ON` in `src/cards/liveSeries.js`, set the repository variable `LIVE_SERIES=on` and the `DUNKSANDTHREES_API_KEY` secret.
3. Measure the Live Series Pack against the booster before the price stands (100 is a placeholder).
4. Add the NEWS item (`src/game/home.js`) and the rules line.
