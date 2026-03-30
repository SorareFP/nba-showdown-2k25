# Collection, Pack Opening & Coin Economy Design

**Date:** 2026-03-30
**Priority:** #10 on roadmap
**Depends on:** Firebase Auth + Firestore (completed), Saved Teams & Decks (completed)

## Overview

Players collect player cards and strategy cards by opening packs purchased with in-game currency (coins). Coins are earned by playing games and hitting NBA-history-inspired milestones. No real money. New accounts receive a one-time starter pack to immediately build a team and strategy deck.

---

## 1. Card Rarity

### Player Cards (306 total, derived from salary)

| Tier | Salary Range | ~Count | Pack Weight |
|------|-------------|--------|-------------|
| Common | $10-$400 | ~146 | 65% |
| Uncommon | $410-$599 | ~80 | 25% |
| Rare | $600-$899 | ~55 | 8% |
| Super-Rare | $900+ | ~25 | 2% |

### Strategy Cards (49 total, manually assigned)

Each strategy card gets a rarity tier based on game impact:

- **Common:** Basic utility cards (Overhelp, Ghost Screen, Crowd Favorite, etc.)
- **Uncommon:** Moderate-impact cards (Power Move, Stagger Action, Chip on Shoulder, etc.)
- **Rare:** High-impact cards (Switch Everything, This Is My House, Green Light, Coach's Challenge, etc.)

Strategy cards use the same pack weight percentages as player cards for non-guaranteed slots.

Phase-balanced distribution ensures packs include cards from matchup, scoring, reaction, and pre/post-roll phases.

---

## 2. Pack Types

| Pack | Players | Strats | Guarantee | Price |
|------|---------|--------|-----------|-------|
| Starter | 20 | 30 | 1 guaranteed SR + 19 weighted (cap 2 SR total) | Free (once) |
| Booster | 5 | 2 | Normal weight | 100 |
| Deluxe Booster | 5 | 2 | 1 guaranteed rare (player or strat) | 200 |
| Super Booster | 5 | 2 | 1 guaranteed rare player | 300 |
| Division Themed | 5 (from division) | 2 | Normal weight | 100 |
| Conference Themed | 5 (from conference) | 2 | Normal weight | 100 |
| Conference Super | 5 (from conference) | 2 | 1 guaranteed rare player from conf | 300 |
| Rare Deluxe | 3 (all rare+) | 1 (rare+) | All rare or higher | 750 |
| Super Deluxe | 3 | 1 | 1 guaranteed SR player | 1500 |
| Mega Deluxe | 3 (all SR) | 1 (rare strat) | All super-rare players | 3000 |
| Booster Box | 36 boosters | -- | Bulk discount | 3000 |

### Starter Pack Details

- 1 guaranteed super-rare player
- 19 additional players using normal pack weight, capped at 2 total super-rares
- 30 strategy cards, phase-balanced (guaranteed coverage of matchup, scoring, reaction phases)
- Free on signup, not available in the shop afterward
- Enough to build a legal 10-player roster and a ~30-card strategy deck immediately

### Normal Pack Weight

- Common: 65%
- Uncommon: 25%
- Rare: 8%
- Super-Rare: 2%

---

## 3. Coin Economy

### Earning

| Source | Coins | Notes |
|--------|-------|-------|
| Complete a full game | 50 | Both teams must be from your collection |
| Win bonus | +25 | |
| Daily first win | +50 | Resets at midnight UTC |
| Triple-double (10+ pts/reb/ast) | +50 | Daily milestone cap applies |
| 50+ pts with one player | +25 | Daily milestone cap applies |
| 81+ team total pts (Kobe) | +75 | Daily milestone cap applies |
| 100+ team total pts (Wilt) | +100 | Daily milestone cap applies |
| 83+ pts with one player (Bam) | Free Bam Adebayo card | Special reward, not coins |

**Daily milestone coin cap:** 200 coins (Bam card reward is separate, not counted toward cap)

**Signup bonus:** 0 coins (starter pack only)

### Burning Cards

| Rarity | Burn Value |
|--------|-----------|
| Common | 2 coins |
| Uncommon | 5 coins |
| Rare | 45 coins |
| Super-Rare | 100 coins (= 1 booster) |

Burn rates are intentionally nerfed: 3 rares or 2 rares + 5 commons = 1 booster.

### Economy Pacing

- First game earns 50-125 coins (enough for 1 booster after 1-2 games)
- Mega Deluxe requires ~40+ games of dedicated play
- Self-play (both teams from your collection) earns full rewards since PvP doesn't exist yet

---

## 4. Data Model (Firestore)

### User Document (`users/{uid}`)

Existing fields unchanged. Add:
- `currency: number` (already exists, starts at 0)
- `starterPackOpened: boolean`
- `dailyMilestoneCoins: number` (reset daily)
- `dailyMilestoneDate: string` (YYYY-MM-DD, for reset detection)
- `dailyFirstWin: boolean` (reset daily)

### Collection Subcollection (`users/{uid}/collection/{cardId}`)

```
{
  type: 'player' | 'strat',
  count: number,          // how many owned (duplicates allowed)
  acquiredAt: timestamp   // first acquisition
}
```

### Pack History Subcollection (`users/{uid}/packHistory/{historyId}`)

```
{
  packType: string,       // 'starter', 'booster', 'deluxe', etc.
  cards: string[],        // array of card IDs received
  cost: number,           // coins spent (0 for starter)
  openedAt: timestamp
}
```

### Pack opening runs client-side

Card selection uses the card pool + pack policy weights. Results are written to Firestore in a batch (deduct currency + add collection entries + add history). No Cloud Functions needed.

---

## 5. UI

### Collection Tab Updates

- **My Collection** section: grid of owned cards with count badges, filterable by rarity/team/type
- **Pack Shop** section: pack tiles with prices, current coin balance in header
- **Not owned** cards shown greyed out or hidden (toggle)

### Pack Opening Screen

- All cards laid out face-down
- Click each card to flip/reveal
- Escalating animations by rarity:
  - Common: simple flip
  - Uncommon: flip with subtle glow
  - Rare: flip with golden border shimmer
  - Super-Rare: flip with full particle/burst effect
- Can click through one by one or "reveal all"

### Team Builder Enforcement

- Only owned cards can be added to teams
- Cards show "Owned x1" / "Not Owned" indicator
- Non-owned cards are visible but not selectable

### Deck Editor Enforcement

- Same as team builder: only owned strategy cards can be added
- Shows owned count vs. deck count per card

### Initial Rollout

- Push starter pack to existing accounts (2-3 test accounts)
- Show "Welcome! Open your Starter Pack" notification on first login after migration

---

## 6. Deferred (Future)

- Marketplace / player-to-player trading
- Tournament-specific coin rewards
- Themed pack rotation schedule (seasonal)
- Real-money purchases
- Pack odds transparency page
