# Collection, Pack Opening & Coin Economy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a full card collection system with pack opening, coin economy, and ownership enforcement so players collect cards through gameplay and build teams/decks from owned cards only.

**Architecture:** Client-side pack generation using weighted random selection against the card pool. Firestore stores user collection, currency, and pack history. Coin rewards calculated at game end and written to Firestore. CollectionTab expanded with Pack Shop, Pack Opening screen, and My Collection grid.

**Tech Stack:** React, Vite, Firebase Firestore, CSS Modules, existing game engine

---

### Task 1: Add Rarity to Strategy Cards

**Files:**
- Modify: `src/game/strats.js`

**Step 1: Add `rarity` field to every strategy card definition**

Assign tiers based on game impact. Locked/high-impact cards = rare, moderate = uncommon, basic = common.

```javascript
// Rare (high-impact, game-changing)
'switch_everything', 'this_is_my_house', 'green_light', 'coaches_challenge',
'heat_check', 'and_one', 'cross_court_dime', 'you_stand_over_there',
'pin_down_screen', 'elevator_doors'

// Uncommon (moderate impact, conditional)
'power_move', 'stagger_action', 'chip_on_shoulder', 'defensive_stopper',
'bully_ball', 'drive_the_lane', 'uncontested_layup', 'back_to_basket',
'rimshaker', 'burst_of_momentum', 'from_way_downtown', 'catch_and_shoot',
'anticipate_pass', 'cold_spell', 'flare_screen', 'putback_dunk'

// Common (everything else)
'high_screen_roll', 'second_wind', 'ghost_screen', 'energy_injection',
'crowd_favorite', 'delayed_slip', 'overhelp', 'burned_switch',
'offensive_board', 'rebound_tap_out', 'offensive_foul', 'dogged',
'turnover', 'go_under', 'fight_over', 'veer_switch', 'close_out'
```

Add `rarity: 'common' | 'uncommon' | 'rare'` to each card object in the STRATS array.

**Step 2: Commit**

```bash
git add src/game/strats.js
git commit -m "feat: add rarity tiers to strategy cards"
```

---

### Task 2: Create Rarity Utility Module

**Files:**
- Create: `src/game/rarity.js`

**Step 1: Create rarity helpers**

```javascript
// src/game/rarity.js
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';

// Player rarity derived from salary
export function getPlayerRarity(card) {
  const s = card.salary || 0;
  if (s >= 900) return 'super-rare';
  if (s >= 600) return 'rare';
  if (s >= 410) return 'uncommon';
  return 'common';
}

// Strategy rarity from the rarity field added in Task 1
export function getStratRarity(strat) {
  return strat.rarity || 'common';
}

// Get all player cards by rarity
export function getPlayersByRarity(rarity) {
  return CARDS.filter(c => getPlayerRarity(c) === rarity);
}

// Get all strat cards by rarity
export function getStratsByRarity(rarity) {
  return STRATS.filter(s => getStratRarity(s) === rarity);
}

// Pack weight config
export const PACK_WEIGHTS = {
  common: 0.65,
  uncommon: 0.25,
  rare: 0.08,
  'super-rare': 0.02,
};

// Rarity display config (colors, labels)
export const RARITY_CONFIG = {
  'common':     { label: 'Common',     color: '#94A3B8', bg: 'rgba(148,163,184,0.15)' },
  'uncommon':   { label: 'Uncommon',   color: '#4ADE80', bg: 'rgba(74,222,128,0.15)' },
  'rare':       { label: 'Rare',       color: '#60A5FA', bg: 'rgba(96,165,250,0.15)' },
  'super-rare': { label: 'Super Rare', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)' },
};

// Burn values
export const BURN_VALUES = {
  'common': 2,
  'uncommon': 5,
  'rare': 45,
  'super-rare': 100,
};
```

**Step 2: Commit**

```bash
git add src/game/rarity.js
git commit -m "feat: add rarity utility module with weights, config, burn values"
```

---

### Task 3: Create Collection Firebase CRUD

**Files:**
- Create: `src/firebase/collection.js`

**Step 1: Create collection CRUD following savedDecks.js pattern**

```javascript
// src/firebase/collection.js
import { db } from './config.js';
import {
  collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
  serverTimestamp, query, orderBy, writeBatch, increment,
} from 'firebase/firestore';

function collRef(uid) {
  return collection(db, 'users', uid, 'collection');
}

function histRef(uid) {
  return collection(db, 'users', uid, 'packHistory');
}

// Load entire collection
export async function loadCollection(uid) {
  const snap = await getDocs(collRef(uid));
  const items = {};
  snap.forEach(d => { items[d.id] = d.data(); });
  return items; // { [cardId]: { type, count, acquiredAt } }
}

// Add cards to collection (from pack opening)
// cards: [{ id, type: 'player'|'strat' }]
export async function addCardsToCollection(uid, cards, packType, cost) {
  const batch = writeBatch(db);

  // Group by cardId and count
  const counts = {};
  cards.forEach(c => {
    if (!counts[c.id]) counts[c.id] = { type: c.type, add: 0 };
    counts[c.id].add++;
  });

  // Upsert each card
  for (const [cardId, info] of Object.entries(counts)) {
    const ref = doc(db, 'users', uid, 'collection', cardId);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      batch.update(ref, { count: increment(info.add) });
    } else {
      batch.set(ref, { type: info.type, count: info.add, acquiredAt: serverTimestamp() });
    }
  }

  // Deduct currency
  if (cost > 0) {
    const userRef = doc(db, 'users', uid);
    batch.update(userRef, { currency: increment(-cost) });
  }

  // Add pack history
  const historyRef = doc(histRef(uid));
  batch.set(historyRef, {
    packType,
    cards: cards.map(c => c.id),
    cost,
    openedAt: serverTimestamp(),
  });

  await batch.commit();
}

// Burn a card for coins
export async function burnCard(uid, cardId, burnValue) {
  const ref = doc(db, 'users', uid, 'collection', cardId);
  const snap = await getDoc(ref);
  if (!snap.exists() || snap.data().count < 1) throw new Error('Card not owned');

  const batch = writeBatch(db);
  const newCount = snap.data().count - 1;
  if (newCount <= 0) {
    batch.delete(ref);
  } else {
    batch.update(ref, { count: increment(-1) });
  }
  // Add coins
  const userRef = doc(db, 'users', uid);
  batch.update(userRef, { currency: increment(burnValue) });
  await batch.commit();
}

// Add coins to user
export async function addCoins(uid, amount) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, { currency: increment(amount) });
}

// Get user currency
export async function getUserData(uid) {
  const ref = doc(db, 'users', uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

// Update user fields (starterPackOpened, daily tracking, etc.)
export async function updateUserFields(uid, fields) {
  const userRef = doc(db, 'users', uid);
  await updateDoc(userRef, fields);
}
```

**Step 2: Commit**

```bash
git add src/firebase/collection.js
git commit -m "feat: add collection Firestore CRUD (load, add, burn, coins)"
```

---

### Task 4: Create Pack Generation Engine

**Files:**
- Create: `src/game/packEngine.js`

**Step 1: Create pack policies and generation logic**

```javascript
// src/game/packEngine.js
import { CARDS } from './cards.js';
import { STRATS } from './strats.js';
import { getPlayerRarity, getStratRarity, PACK_WEIGHTS } from './rarity.js';

// NBA divisions and conferences for themed packs
const CONFERENCES = {
  East: ['ATL','BOS','BKN','CHA','CHI','CLE','DET','IND','MIA','MIL','NYK','ORL','PHI','TOR','WAS'],
  West: ['DAL','DEN','GSW','HOU','LAC','LAL','MEM','MIN','NOP','OKC','PHX','POR','SAC','SAS','UTA'],
};
const DIVISIONS = {
  Atlantic: ['BOS','BKN','NYK','PHI','TOR'],
  Central: ['CHI','CLE','DET','IND','MIL'],
  Southeast: ['ATL','CHA','MIA','ORL','WAS'],
  Northwest: ['DEN','MIN','OKC','POR','UTA'],
  Pacific: ['GSW','LAC','LAL','PHX','SAC'],
  Southwest: ['DAL','HOU','MEM','NOP','SAS'],
};

// Pack type definitions
export const PACK_TYPES = {
  starter:       { name: 'Starter Pack',       players: 20, strats: 30, price: 0,    guaranteedSR: 1, srCap: 2, once: true },
  booster:       { name: 'Booster Pack',        players: 5,  strats: 2,  price: 100,  guaranteedSR: 0 },
  deluxe:        { name: 'Deluxe Booster',      players: 5,  strats: 2,  price: 200,  guaranteedRare: 1 },
  super:         { name: 'Super Booster',       players: 5,  strats: 2,  price: 300,  guaranteedRarePlayer: 1 },
  rare_deluxe:   { name: 'Rare Deluxe',         players: 3,  strats: 1,  price: 750,  allRarePlus: true },
  super_deluxe:  { name: 'Super Deluxe',        players: 3,  strats: 1,  price: 1500, guaranteedSR: 1 },
  mega_deluxe:   { name: 'Mega Deluxe',         players: 3,  strats: 1,  price: 3000, allSR: true, rareStrat: true },
  booster_box:   { name: 'Booster Box (36)',     players: 0,  strats: 0,  price: 3000, box: 36 },
};

// Weighted random pick from an array using rarity weights
function weightedPick(cards, getRarityFn, excludeRarities) {
  const pool = excludeRarities
    ? cards.filter(c => !excludeRarities.includes(getRarityFn(c)))
    : cards;
  if (pool.length === 0) return cards[Math.floor(Math.random() * cards.length)];

  const weighted = pool.map(c => ({
    card: c,
    weight: PACK_WEIGHTS[getRarityFn(c)] || PACK_WEIGHTS.common,
  }));
  const totalW = weighted.reduce((s, w) => s + w.weight, 0);
  let r = Math.random() * totalW;
  for (const w of weighted) {
    r -= w.weight;
    if (r <= 0) return w.card;
  }
  return weighted[weighted.length - 1].card;
}

// Pick a card of specific rarity or higher
function pickByRarity(cards, getRarityFn, minRarity) {
  const order = ['common', 'uncommon', 'rare', 'super-rare'];
  const minIdx = order.indexOf(minRarity);
  const eligible = cards.filter(c => order.indexOf(getRarityFn(c)) >= minIdx);
  if (eligible.length === 0) return cards[Math.floor(Math.random() * cards.length)];
  return eligible[Math.floor(Math.random() * eligible.length)];
}

// Pick N random strats with phase balance for starter pack
function pickPhaseBalancedStrats(count) {
  const phases = ['matchup', 'scoring', 'reaction', 'pre_roll', 'post_roll'];
  const result = [];
  // Guarantee at least some from each phase
  const perPhase = Math.floor(count / phases.length); // 6 each for 30
  phases.forEach(phase => {
    const pool = STRATS.filter(s => s.phase === phase);
    for (let i = 0; i < perPhase && result.length < count; i++) {
      result.push(weightedPick(pool, getStratRarity));
    }
  });
  // Fill remainder randomly
  while (result.length < count) {
    result.push(weightedPick(STRATS, getStratRarity));
  }
  return result;
}

// Generate a pack
export function generatePack(packType, options = {}) {
  const def = PACK_TYPES[packType];
  if (!def) throw new Error('Unknown pack type: ' + packType);

  // Booster box: generate 36 boosters
  if (def.box) {
    const allCards = [];
    for (let i = 0; i < def.box; i++) {
      allCards.push(...generatePack('booster'));
    }
    return allCards;
  }

  const result = [];
  let playerPool = [...CARDS];
  let stratPool = [...STRATS];

  // Apply team/conference/division filters
  if (options.conference) {
    const teams = CONFERENCES[options.conference] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }
  if (options.division) {
    const teams = DIVISIONS[options.division] || [];
    playerPool = playerPool.filter(c => teams.includes(c.team));
  }

  // Player cards
  let srCount = 0;
  const srCap = def.srCap || 999;

  // Guaranteed super-rare players
  if (def.guaranteedSR) {
    for (let i = 0; i < def.guaranteedSR; i++) {
      const card = pickByRarity(playerPool, getPlayerRarity, 'super-rare');
      result.push({ id: card.id, type: 'player' });
      srCount++;
    }
  }

  // Guaranteed rare player
  if (def.guaranteedRarePlayer) {
    const card = pickByRarity(playerPool, getPlayerRarity, 'rare');
    result.push({ id: card.id, type: 'player' });
  }

  // Guaranteed rare (player or strat)
  if (def.guaranteedRare) {
    // 50/50 player or strat
    if (Math.random() < 0.5) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'rare').id, type: 'player' });
    } else {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
  }

  // All rare+ packs
  if (def.allRarePlus) {
    for (let i = result.length; i < def.players; i++) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'rare').id, type: 'player' });
    }
    for (let i = 0; i < def.strats; i++) {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
    return result;
  }

  // All super-rare packs
  if (def.allSR) {
    for (let i = result.length; i < def.players; i++) {
      result.push({ id: pickByRarity(playerPool, getPlayerRarity, 'super-rare').id, type: 'player' });
    }
    if (def.rareStrat) {
      result.push({ id: pickByRarity(stratPool, getStratRarity, 'rare').id, type: 'strat' });
    }
    return result;
  }

  // Fill remaining player slots with weighted random
  const playersFilled = result.filter(c => c.type === 'player').length;
  for (let i = playersFilled; i < def.players; i++) {
    const card = weightedPick(playerPool, getPlayerRarity);
    if (getPlayerRarity(card) === 'super-rare') {
      if (srCount >= srCap) {
        // Re-pick without super-rare
        const fallback = weightedPick(playerPool, getPlayerRarity, ['super-rare']);
        result.push({ id: fallback.id, type: 'player' });
        continue;
      }
      srCount++;
    }
    result.push({ id: card.id, type: 'player' });
  }

  // Fill strat slots
  if (packType === 'starter') {
    // Phase-balanced for starter
    const strats = pickPhaseBalancedStrats(def.strats);
    strats.forEach(s => result.push({ id: s.id, type: 'strat' }));
  } else {
    const stratsFilled = result.filter(c => c.type === 'strat').length;
    for (let i = stratsFilled; i < def.strats; i++) {
      result.push({ id: weightedPick(stratPool, getStratRarity).id, type: 'strat' });
    }
  }

  return result;
}

export { CONFERENCES, DIVISIONS };
```

**Step 2: Commit**

```bash
git add src/game/packEngine.js
git commit -m "feat: add pack generation engine with all pack types and weighted selection"
```

---

### Task 5: Create Coin Reward Calculator

**Files:**
- Create: `src/game/coinRewards.js`

**Step 1: Create reward logic that checks game results for milestones**

```javascript
// src/game/coinRewards.js

const MILESTONES = [
  {
    id: 'triple_double',
    name: 'Triple-Double',
    coins: 50,
    check: (stats) => stats.some(ps => ps.pts >= 10 && ps.reb >= 10 && ps.ast >= 10),
  },
  {
    id: 'fifty_pts',
    name: '50+ pts (single player)',
    coins: 25,
    check: (stats) => stats.some(ps => ps.pts >= 50),
  },
  {
    id: 'kobe_81',
    name: '81+ Team Points (Kobe)',
    coins: 75,
    check: (_, teamScore) => teamScore >= 81,
  },
  {
    id: 'wilt_100',
    name: '100+ Team Points (Wilt)',
    coins: 100,
    check: (_, teamScore) => teamScore >= 100,
  },
];

// Special milestone: 83+ pts with one player = free Bam card (not coins)
const BAM_MILESTONE = {
  id: 'bam_83',
  name: '83+ pts (single player) — Free Bam Adebayo!',
  check: (stats) => stats.some(ps => ps.pts >= 83),
  cardReward: 'Bam_Adebayo',
};

export function calculateRewards(game, isWinner, dailyMilestoneCoinsUsed = 0) {
  const DAILY_MILESTONE_CAP = 200;
  let coins = 0;
  const breakdown = [];
  const milestones = [];

  // Base game completion
  coins += 50;
  breakdown.push({ label: 'Game Completed', coins: 50 });

  // Win bonus
  if (isWinner) {
    coins += 25;
    breakdown.push({ label: 'Victory Bonus', coins: 25 });
  }

  // Milestone checks (check both teams since self-play)
  const allStats = [...game.teamA.stats, ...game.teamB.stats];
  const teamScores = [game.teamA.score, game.teamB.score];
  let milestoneCoins = 0;

  for (const m of MILESTONES) {
    const hit = teamScores.some((score, i) => {
      const stats = i === 0 ? game.teamA.stats : game.teamB.stats;
      return m.check(stats, score);
    });
    if (hit) {
      const available = DAILY_MILESTONE_CAP - dailyMilestoneCoinsUsed - milestoneCoins;
      const award = Math.min(m.coins, Math.max(0, available));
      if (award > 0) {
        milestoneCoins += award;
        coins += award;
        milestones.push({ ...m, awarded: award });
        breakdown.push({ label: m.name, coins: award });
      }
    }
  }

  // Bam check (separate from coin cap)
  let bamReward = false;
  for (let i = 0; i < 2; i++) {
    const stats = i === 0 ? game.teamA.stats : game.teamB.stats;
    if (BAM_MILESTONE.check(stats)) {
      bamReward = true;
      breakdown.push({ label: BAM_MILESTONE.name, coins: 0, special: true });
      break;
    }
  }

  return { coins, milestoneCoins, breakdown, bamReward, bamCardId: 'Bam_Adebayo' };
}

export { MILESTONES, BAM_MILESTONE };
```

**Step 2: Commit**

```bash
git add src/game/coinRewards.js
git commit -m "feat: add coin reward calculator with NBA milestone bonuses"
```

---

### Task 6: Build Pack Shop Component

**Files:**
- Create: `src/components/PackShop.jsx`
- Create: `src/components/PackShop.module.css`

**Step 1: Build pack shop grid showing available packs with prices**

PackShop receives `currency` (user's coin balance) and `onBuyPack(packType, options)` callback. Displays a grid of pack tiles with name, contents summary, price, and buy button. Disabled if insufficient funds. Includes themed pack section with conference/division selectors.

Key UI elements:
- Coin balance display at top
- Pack tiles in a responsive grid (2-3 columns)
- Each tile: pack name, contents (e.g. "5 Players + 2 Strats"), guarantee text, price with coin icon
- Buy button disabled when `currency < price`
- Themed packs have a dropdown to pick conference/division

**Step 2: Commit**

```bash
git add src/components/PackShop.jsx src/components/PackShop.module.css
git commit -m "feat: add PackShop component with pack grid and purchase flow"
```

---

### Task 7: Build Pack Opening Screen

**Files:**
- Create: `src/components/PackOpening.jsx`
- Create: `src/components/PackOpening.module.css`

**Step 1: Build the card flip reveal screen**

PackOpening receives `cards` array (the generated pack contents) and `onDone` callback. Shows all cards face-down in a grid. Clicking a card flips it with CSS animation. Rarity determines animation intensity:
- Common: simple flip (0.4s)
- Uncommon: flip + green glow border
- Rare: flip + blue shimmer + slight scale pulse
- Super-Rare: flip + golden burst + particle-like radial gradient + scale

Each card face shows: player name/team or strat name, rarity badge, and basic stats. "Reveal All" button flips remaining cards. "Done" button appears when all revealed.

Use CSS `transform: rotateY(180deg)` with `backface-visibility: hidden` for the flip.

**Step 2: Commit**

```bash
git add src/components/PackOpening.jsx src/components/PackOpening.module.css
git commit -m "feat: add PackOpening component with flip reveal and rarity animations"
```

---

### Task 8: Build My Collection View

**Files:**
- Create: `src/components/MyCollection.jsx`
- Create: `src/components/MyCollection.module.css`

**Step 1: Build collection grid with filters**

MyCollection receives `collection` object and displays owned cards in a filterable grid. Filters: type (player/strat), rarity, team. Each card tile shows: card art thumbnail (if available), name, rarity badge, owned count. Cards with count 0 (not owned) can be toggled visible/hidden. Burn button on each owned card shows confirm dialog with burn value.

Sections:
- Filter bar (type toggle, rarity dropdown, team dropdown, search input)
- Card grid (responsive, 3-5 columns)
- Each card: mini card with rarity-colored border, count badge, burn button

**Step 2: Commit**

```bash
git add src/components/MyCollection.jsx src/components/MyCollection.module.css
git commit -m "feat: add MyCollection component with filters, rarity badges, burn"
```

---

### Task 9: Integrate Collection into CollectionTab

**Files:**
- Modify: `src/components/CollectionTab.jsx`
- Modify: `src/components/CollectionTab.module.css`

**Step 1: Add sub-navigation and new sections**

Add a sub-tab bar at top of CollectionTab: "My Teams" | "My Decks" | "My Collection" | "Pack Shop". Load collection and user data from Firebase on mount. Wire PackShop's `onBuyPack` to: generate pack → save to Firestore → show PackOpening screen → refresh collection. Wire burn from MyCollection to `burnCard()` → refresh.

State additions:
- `view`: 'teams' | 'decks' | 'collection' | 'shop' (default 'teams')
- `collection`: loaded from Firestore
- `userData`: { currency, starterPackOpened, dailyMilestoneCoins, etc. }
- `openingPack`: null | card array (when pack is being opened)

Handle starter pack: if `!userData.starterPackOpened`, show a prominent "Open Your Starter Pack!" banner.

**Step 2: Commit**

```bash
git add src/components/CollectionTab.jsx src/components/CollectionTab.module.css
git commit -m "feat: integrate collection, shop, and pack opening into CollectionTab"
```

---

### Task 10: Enforce Ownership in Team Builder

**Files:**
- Modify: `src/components/TeamBuilderTab.jsx`
- Modify: `src/App.jsx`

**Step 1: Pass collection to TeamBuilderTab and filter available cards**

In App.jsx, load user's collection and pass it to TeamBuilderTab. In TeamBuilderTab, when user is signed in:
- Cards not in collection are greyed out with "Not Owned" badge
- +A / +B buttons are disabled for unowned cards
- Owned cards show "Owned x1" count badge
- When not signed in, all cards remain available (sandbox mode)

**Step 2: Commit**

```bash
git add src/components/TeamBuilderTab.jsx src/App.jsx
git commit -m "feat: enforce card ownership in Team Builder when signed in"
```

---

### Task 11: Enforce Ownership in Deck Editor

**Files:**
- Modify: `src/components/DeckEditor.jsx`

**Step 1: Filter strategy cards by ownership**

Pass collection to DeckEditor. When signed in:
- Unowned strats show count 0 and + button disabled
- Owned strats show available count (owned - already in deck)
- Cannot add more copies than owned
- When not signed in, all strats available (sandbox mode)

**Step 2: Commit**

```bash
git add src/components/DeckEditor.jsx
git commit -m "feat: enforce strategy card ownership in Deck Editor when signed in"
```

---

### Task 12: Hook Coin Rewards into Game Completion

**Files:**
- Modify: `src/components/game/GameOver.jsx`
- Modify: `src/components/game/GameOver.module.css`

**Step 1: Calculate and display rewards at game end**

Import `calculateRewards` and `useAuth`. When game ends and user is signed in:
1. Calculate rewards from game state
2. Display reward breakdown in GameOver screen (coins earned, milestones hit)
3. Write coins to Firestore via `addCoins()`
4. Handle daily first win bonus (check/set `dailyFirstWin` on user doc)
5. Handle Bam Adebayo special reward (add card to collection if milestone hit)
6. Show "Rewards Earned" section above the box scores with animated coin counter

Track daily state: compare `dailyMilestoneDate` to today. If different date, reset counters.

**Step 2: Commit**

```bash
git add src/components/game/GameOver.jsx src/components/game/GameOver.module.css
git commit -m "feat: add coin rewards display and Firestore write at game end"
```

---

### Task 13: Migrate Existing Accounts

**Files:**
- Create: `src/firebase/migration.js`
- Modify: `src/firebase/AuthProvider.jsx`

**Step 1: Create migration check that runs on auth**

In AuthProvider's `onAuthStateChanged`, after user doc is confirmed to exist, check if `starterPackOpened` field exists. If not, this is a pre-collection account — set `starterPackOpened: false`, `currency: 0`, `dailyMilestoneCoins: 0`, `dailyMilestoneDate: ''`, `dailyFirstWin: false`. This ensures existing accounts get the starter pack prompt when they visit the Collection tab.

No starter pack is auto-opened — they'll see the "Open Your Starter Pack!" prompt.

**Step 2: Commit**

```bash
git add src/firebase/migration.js src/firebase/AuthProvider.jsx
git commit -m "feat: add account migration for pre-collection users"
```

---

### Task 14: Build, Deploy, and Push

**Step 1: Build**
```bash
npm run build
```

**Step 2: Deploy to GitHub Pages**
```bash
npx gh-pages -d dist
```

**Step 3: Commit and push all remaining changes**
```bash
git add -A
git commit -m "feat: collection system, pack opening, coin economy — priority #10"
git push
```

**Step 4: Verify on live site**
- Sign in → Collection tab → see starter pack prompt
- Open starter pack → flip cards → verify collection populated
- Build team from owned cards only
- Play a game → verify coin rewards at end
- Buy a booster pack with earned coins
