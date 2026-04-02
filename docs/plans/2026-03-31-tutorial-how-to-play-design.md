# Tutorial Mode + How to Play — Design

**Date:** 2026-03-31
**Status:** Approved

## Goals

- Teach new players NBA Showdown through a guided interactive quarter
- Provide a comprehensive rules reference accessible from anywhere in the app
- Build a reusable AI engine that serves tutorial, solo mode, and future sim-to-end

## Audience

Layered for both complete newcomers and experienced board gamers. Core mechanics explained simply; strategic depth available for those who dig deeper.

## Architecture

Three new modules:

| Module | Purpose |
|--------|---------|
| `src/game/ai.js` | Standalone AI decision engine — takes game state + team key, returns an action |
| `src/components/HowToPlay.jsx` | Top-level nav tab with tutorial launcher + accordion rules reference |
| `src/components/game/TutorialOverlay.jsx` | Tooltip/highlight overlay system for guided gameplay |

## AI Engine (`ai.js`)

A decision-making module that evaluates game state and returns actions. Single "competent" difficulty tier initially; difficulty levels can layer on later.

**Decision areas:**

- **Draft:** Evaluate roster needs — balance speed/power/shooting, fill positional gaps, consider fatigue from prior sections.
- **Matchups:** Assign favorable defensive matchups based on attribute advantages.
- **Scoring cards:** Evaluate hand for playable cards, prioritize by impact (shot bonus on best shooters, defensive cards on biggest threats).
- **Passing:** Pass when no high-value plays remain.
- **Rolling:** Roll in priority order (best matchups first when rolling opens).
- **End section:** Always vote to end when all rolls complete.

**Reusability:** Same AI module drives tutorial opponent, future improved solo mode, and sim-to-end feature.

## How to Play Page

Top-level nav tab (`/how-to-play` route) with two zones:

### Hero: Interactive Tutorial

- "Play Tutorial" button with description: "Learn NBA Showdown by playing a guided quarter against the AI"
- Estimated time: ~12-15 minutes
- Can be replayed at any time

### Accordion Rules Reference

Collapsible sections, each with a stable `id` for deep-linking:

1. **Overview & Winning** — game structure (4 quarters x 3 sections), win condition
2. **Building Your Team** — roster construction, salary cap, positions
3. **The Draft Phase** — snake draft, starter selection
4. **Matchup Strategy Phase** — assigning defenders, strategy cards
5. **Scoring Phase** — playing cards, rolling dice, shot checks
6. **Strategy Cards** — categories with card descriptions
7. **Assists, Rebounds & Bonuses** — resource tracking, spending triggers
8. **Fatigue & Substitutions** — minute tracking, rest recovery, bench mechanics
9. **Advanced: Hot/Cold Streaks, And-One, Close Out** — reaction cards, streak effects

## Interactive Tutorial Flow

### Setup

- Two hand-picked balanced rosters that showcase diverse mechanics
- Pre-built decks seeded with specific cards that teach key concepts
- AI opponent uses simple auto-pilot (not scripted moves)

### Section 1 — Learn the Basics

- **Draft:** First 2 picks guided with tooltips explaining rationale. Remaining 3 picks player-controlled with hover tooltips.
- **Matchups:** Tooltip explains attribute advantages, guides first defensive assignment.
- **Scoring:** Tooltip on first card play. Explains shot check mechanics on first roll.
- **End section:** Explains rebound track bonuses.

### Section 2 — Deeper Strategy

- **Draft:** Lighter tooltips (reminders only).
- **Scoring:** Highlight fatigue indicators. Explain defensive card timing. Introduce assist spending with tooltip.
- Less hand-holding, more "did you notice?" contextual callouts.

### Section 3 — Fatigue & Substitutions

- **Draft:** Tooltip flags fatigued players: "Notice Player X has 8 minutes — consider resting them."
- Player makes all decisions independently.
- End-of-quarter summary tooltip explains quarter transitions and halftime reset.

### Tooltip System

- Positioned overlays anchored to specific game elements
- "Got it" dismiss button (no auto-advance)
- "Skip Tutorial" option always visible
- Tooltip content stored as data objects (not hardcoded JSX) for easy editing and future localization

## Contextual "?" Buttons

Small `?` icon buttons placed on key game UI elements, each deep-linking to the relevant accordion section:

| Location | Links to |
|----------|----------|
| PhaseBar | Current phase's rules section |
| HandPanel header | Strategy Cards section |
| PlayerSlot | Scoring / Shot Check section |
| Scoreboard | Overview section |

Clicking opens the How to Play page scrolled/jumped to the target accordion section.

## Navigation

- **Top-level tab** in main nav bar: "How to Play"
- **Contextual "?" buttons** on game board elements deep-link to relevant rules sections
- Both paths lead to the same `HowToPlay.jsx` component

## Future Extensions

- AI difficulty tiers (easy/medium/hard)
- Solo mode uses same AI engine for opponent
- Sim-to-end uses AI for both teams
- Tutorial achievements/progress tracking
