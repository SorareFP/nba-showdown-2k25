# Dynasty staff — a draft for the user (2026-09-23)

The user: "I'm thinking something like the way dynasty points are used for support staff in College Football 27." So a staff layer bought with **Franchise Points**, the points a dynasty already banks at the turn of each year and spends on card imports — role trees with tiers, the way a College Football coach spends points on abilities. Nothing here is built. It is a proposal to react to.

## The budget it has to fit

FP a season is `(finish + 3 × playoff series won + 10 × title) × the rung's pay factor` (`fpEarned`), finish running 10 for first to 0 for last. Roughly:

| Year | FP at Prince (1×) | at Deity (1.5×) |
| --- | --- | --- |
| Mid-table, no playoffs | 5 | 8 |
| A playoff run of two series | 14 | 21 |
| A title | 32 | 48 |
| Ten years, a good team | ~90 | ~135 |

Imports cost 2 / 4 / 8 / 16 / 32 by rarity and compete for the same points. Staff tiers are priced **3 / 6 / 12** — a full role 21, all five roles 105 — so nobody maxes everything and an import is always a real alternative to a hire. Tiers are bought in order, any time (each perk says when it kicks in), and are permanent for the dynasty. Points spent are gone.

## The five roles

### 1. Head Scout — the draft

| Tier | FP | Perk | Hook |
| --- | --- | --- | --- |
| 1 · Scouting Department | 3 | The class is graded the moment it forms: every prospect's rarity band and salary show before the lottery, and the AI's own board (`aiDraftChoice`) shows as a mock draft. | `buildDraftClass`, the draft panel |
| 2 · Ping-Pong Balls | 6 | Your lottery weight is +25% (`lotteryWeights`) — a sixth seed drawing like a fourth. | `lotteryOdds`, `drawLottery` |
| 3 · Second-Round Steal | 12 | Once a draft, after the last pick, take one prospect nobody drafted — an extra pick you never owned. | `draftAvailable`, `draftPick`, `finishDraft` |

### 2. Cap Strategist — contracts

| Tier | FP | Perk | Hook |
| --- | --- | --- | --- |
| 1 · Read the Room | 3 | Every free agent's personality and hidden floor are shown in the offer dialog: you see what he will take before you haggle. | `negotiate` |
| 2 · Hometown Discount | 6 | Your own expiring players re-sign 10% under their ask. | `closeResign` (the human's re-signs) |
| 3 · Luxury Apron | 12 | Your apron rises 115 → 125 DP. The cap (100) does not move; the room to exceed it does. | `apronFor`, `fitsCap` |

### 3. Sports Science — aging (an aging dynasty only; greyed otherwise)

| Tier | FP | Perk | Hook |
| --- | --- | --- | --- |
| 1 · Load Management | 3 | Your players' retirement risk starts a year later (35 → 36). | `retireChance`, `RETIRE_FROM` per team |
| 2 · Prime Extension | 6 | Name one player a season: he skips that year's retirement roll. | the turn-of-year retirement pass in `endSeason` |
| 3 · Fountain of Youth | 12 | The whole retirement window shifts two years for your team (35–40 → 37–42). | `retireChance` per team |

The rule that age is retirement risk only, never a decline, stands: none of these change a card's numbers.

### 4. Assistant Coach — on the court (the one role that touches the games)

| Tier | FP | Perk | Hook |
| --- | --- | --- | --- |
| 1 · Film Session | 3 | Your timeout search shows two crunch cards and you keep one. | `searchCrunchCard` |
| 2 · Deep Bench | 6 | Your hand holds eight, not seven. | `drawCards`' cap |
| 3 · Mulligan | 12 | Once a game, redraw your opening hand. | a new pre-deal move in the engine |

**The question mark.** These change the card game itself, which is what College Football's tactician abilities do — but the rung already prices a dynasty game by its difficulty, and in a friends dynasty a perk one human bought plays against another who did not. The opportunity is symmetric (everyone banks FP the same way), but say whether you want on-court perks at all. If not, this role becomes a fourth front-office one (a coin-payout bump, see 5).

### 5. Front Office — points and money

| Tier | FP | Perk | Hook |
| --- | --- | --- | --- |
| 1 · Booster Club | 3 | +1 FP a season, on top of the finish. Pays for itself in three years. | `fpEarned` |
| 2 · Reputation | 6 | The spurned premium (×1.25 on a player you passed over) is waived. | the spurned rule in `negotiate` |
| 3 · Long Game | 12 | Imports sign for three years instead of two, and the dynasty's coin payout factor rises 1.15 → 1.20 for your games. | `IMPORT_YEARS` per team; `DYNASTY_GAME_FACTOR`, which the server verifies — the one perk that needs a functions change |

## The AI's staff

Recommended for v1: AI teams hire nobody. The rung's cap multiplier is already their edge, and "difficulty never degrades the human's side" stays simple. If you want the ladder to feel the staff, the cheap version is King and Deity AI teams holding tier 1 of Cap Strategist and Sports Science.

## Where it lives

- **Data:** `d.staff[teamId] = { scout: 2, cap: 1, ... }` on the dynasty document; `hireStaff(d, teamId, role)` in `dynasty.js` beside `importCard` (checks FP, the tier order, the aging toggle for Sports Science).
- **Friends dynasty:** a `hire` move (`FRIEND_MOVES`), the server asserting the FP the way `import` asserts ownership.
- **UI:** Front Office → a Staff panel beside Import: five rows, three tier chips each (price, effect, owned / next / locked), the FP balance, and a one-line "in effect now" under each row.
- **Rules:** a Rulebook and How to Play bullet, and a NEWS item the day it ships.

## Open questions

1. On-court perks (the Assistant Coach) — in or out?
2. Prices 3 / 6 / 12 against imports at 2–32 — the right scale? Cheaper makes staff the default spend; dearer makes them a title team's luxury.
3. Permanent hires, or contracts that lapse after N seasons and have to be renewed?
4. AI teams hire, or not?
5. Anything specific from College Football 27's support staff you want mirrored exactly — the role names, how points are earned, what a tier feels like. This draft is modelled on the coach-abilities point trees as I know them; 27's own staff screen I have not seen.
