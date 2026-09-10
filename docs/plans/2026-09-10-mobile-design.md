# Mobile layout — design

2026-09-10. The user: "I find the mobile version of the game to be borderline unusable … at least be able to build teams, buy packs, navigate menus, start seasons etc. But the gameplay is too much for the current screen. The strategy cards may be good where they are, folded at the top, lighting up when able to be played." Approved choices: fit one section of the board on screen, a bottom tab bar, compact card rows with the full card on tap. Then: "I trust you to just work ahead on the mobile site."

## What was wrong, measured

On a 375px-wide phone viewport, before any change:

| Screen | Problem |
|---|---|
| Every screen | ~330px of header and banners before content; seven tabs wrapped to three rows of 11px pills |
| Game board | Court started 593px down, under a 127px scoreboard, the log and analytics, an 83px phase bar and a 232px hand; all of it scrolled away with the court |
| Scoring slots | 163px tall each; the Roll button was 16px |
| Team Builder | 5,877 pieces of text under 12px, 723 tap targets under 36px, the pool an inner 360px scroller |
| Collection | 5,075px for forty cards |
| Pack Shop | 3,608px, one tall tile per pack |

Nothing overflowed horizontally. The layouts reflowed; they were long, dense and small.

## Shape of the fix

- **One breakpoint**, `(max-width: 768px)`, exported as `PHONE_QUERY` from `src/ui/useIsPhone.js`. Every phone rule is a media query at that width in the module file it belongs to. Desktop is untouched: phone-only elements are `display: none` above it.
- **CSS first.** Card tiles become rows by CSS grid on the same markup — no second component per screen to keep in sync. `useIsPhone()` exists for the places where markup must differ; so far none have needed it.
- **Fixed heights as variables** in `src/index.css`: `--phone-header-h: 48px`, `--phone-score-h: 56px`. Every sticky offset is a sum of these.

## Shell

- Header: one 48px row (logo, sound, account).
- Bottom tab bar, 52px targets, safe-area padded (`viewport-fit=cover`). Signed in: Play, Team, Season, Cards, More; More opens a sheet with Tournament, PvP, Rules. A guest gets both their tabs and no More. The split is `phoneNavTabs()` in `src/ui/phoneNav.js`.
- Banners keep one line and their button; toasts lift above the bar.

## Browsing screens

- **PlayerCard** (both team builders): thumbnail; name, team, salary; Speed, Power, Line; actions on the right. Boosts and the roll chart are in the lightbox the row opens.
- **Collection**: thumbnail, name, rarity; count and Collect on the right; Burn and Sell (or the open form) as a full-width row beneath. Placed with explicit grid rows — auto-placement stacked Collect on top of Burn and Sell.
- **Market, Pack Shop**: rows with the price and Buy on the right.
- **Filters** stick under the header as one sideways-scrolling row; inputs at 16px so iOS does not zoom.
- **Collection's six sections** scroll sideways in one row.

## Board

- Scoreboard: a 56px strip pinned under the header (scores, quarter and section, assist and rebound tracks).
- Phase bar: pinned under the scoreboard, one line, controls at 40px.
- Strategy hand: a 94px sideways strip; playable cards glow orange, the rest are dimmed with their reason. This is the user's own steer.
- Analytics moves below the court; the one-line game log stays above as the latest event.
- Scoring slots: the art band is hidden and the player's name opens the card instead; stats on one line; boosts and the per-player box score hidden (the spend buttons print the needed roll, which folds the boosts in); the defender's DEF badge shares the advantage line; the roll result is one line; Roll is a 36px target.
- The announced-check banner sticks below the phase bar.
- Tutorial tooltip: full width above the bottom bar.

## Not done, on purpose

No native app, no gesture navigation, no separate mobile routes, no redesign of card faces. The lineup-selection and placement screens were checked but not restyled beyond what they inherit. Feedback from real phone users decides the next pass.
