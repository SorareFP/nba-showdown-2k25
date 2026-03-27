# Card Viewer System — Design Document

## Problem
- Strategy card hover-to-zoom doesn't work (CSS overflow/z-index issues)
- No way to view full card art for player or strategy cards anywhere in the app
- Clicking a strategy card in hand immediately executes it with no confirmation, causing misclicks

## Solution

### 1. CardLightbox Component (`src/components/CardLightbox.jsx`)

Shared modal component used across the entire app.

**Player card mode:**
- Left: card art image (~60% width)
- Right: full stat block — name, team, salary, SPD/PWR/LINE, boosts, full scoring chart
- Magnifying glass icon in top-right opens image-only at native resolution (borderless overlay)
- Cards without images show placeholder with player name

**Strategy card mode:**
- Left: card art image
- Right: name, phase badge, offense/defense badge, lock icon, copies count, full description
- Color accent from card definition
- Magnifying glass icon for full-res image
- Cards without art (cross_court_dime, veer_switch, close_out, cold_spell, energy_injection) show placeholder

**Dismiss:** click backdrop, Escape key, or X button.

### 2. Lightbox Wiring

| Location | Trigger | Opens |
|---|---|---|
| Cards Tab grid | Click PlayerCard | Player lightbox |
| Strats Tab grid | Click strat card | Strategy lightbox |
| Game board hand | Eye icon on card | Strategy lightbox |
| Game board matchup | Eye icon or tap name | Player lightbox |
| Team Builder pool/roster | Click player name | Player lightbox |

### 3. Hand Panel UX Rework

**Current:** click card = immediate execution.

**New flow:**
- Each card gets two icon buttons: eye (view) and play (stage)
- Click play icon or card body → card becomes "staged" (highlighted, slight expand)
- Staged card shows "Confirm Play" button at bottom
- Confirm triggers existing `onExecCard` (target selection modals etc.)
- Click elsewhere or Escape cancels staged card
- Dimmed/unplayable cards: eye still works, play hidden/disabled
- Remove broken CSS hover-to-zoom code

### 4. Future Features (not this PR)

- Team & deck builder with save (Firebase Firestore free tier)
- PvP real-time multiplayer (Firebase Realtime Database)
- Pack opening / collection system
