# Saved Teams & Deck Building — Design

**Date:** 2026-03-27
**Priority:** #9 on roadmap
**Approach:** C — New Collection tab + Firebase backend

## Overview

Add Firebase Auth (Google sign-in) and Firestore to support saving teams and strategy card decks. A new "Collection" tab houses all account-related features. Team Builder gets Save/Load buttons. Everything works without sign-in (guest mode) — Firebase is purely additive.

## Firebase Setup

- Add `firebase` npm package
- `src/firebase.js` — initialize app, export `auth` and `db`
- Config via Vite env vars (`VITE_FIREBASE_API_KEY`, etc.)
- Firebase Auth with Google sign-in provider
- Firestore security rules: users can only read/write their own data

## Data Model (Firestore)

```
users/{uid}
  displayName, email, photoURL, createdAt
  currency: 0          // future: in-game economy
  collection: {}       // future: owned cards

users/{uid}/teams/{teamId}
  name: string
  players: string[]    // 10 card IDs
  salary: number       // computed total
  createdAt, updatedAt

users/{uid}/decks/{deckId}
  name: string
  cards: { cardId: count }  // cardId -> quantity (1-8)
  totalCards: number         // sum of counts, max 50
  maxPerCard: 8              // enforced cap
  linkedTeamId: null | string  // future: link deck to team
  createdAt, updatedAt
```

Card IDs reference client-side data (CARDS, STRATS). No duplication of card definitions in Firestore.

## Auth Flow

- `AuthProvider` context wraps the app: exposes `user`, `loading`, `signIn()`, `signOut()`
- Header: small auth button top-right. Signed out = "Sign In". Signed in = avatar + name + sign out
- Collection tab only visible when signed in. Clicking while signed out prompts sign-in
- Guest mode: all existing features work without sign-in

## Collection Tab

Three sections:

### My Teams
- List: name, salary total, player count, last updated
- Click to expand/view roster
- Actions: Edit (load into Team Builder), Delete, Load to A / Load to B (for local play)

### My Decks
- List: name, total cards, last updated
- Click to expand and see card breakdown
- Actions: Edit (opens deck editor), Delete

### Deck Editor
- Available strategy cards from STRATS with +/- quantity controls (0-8 per card)
- Current deck contents with running total (X/50)
- Save validates total ≤ 50
- Future: will validate against owned collection instead of full pool

## Team Builder Integration

- Save button: saves current roster as new or updated team (prompts for name)
- Load button: modal listing saved teams, pick to replace Team A or B
- Only visible when signed in

## Deck Rules

- Max 50 cards per deck
- Max 8 copies of any single card
- When draw pile is empty, shuffle discard pile into fresh draw pile
- Players can discard unwanted cards; played/discarded cards stay in discard until full reshuffle

## Future Considerations

- `collection` field on user for owned cards (pack opening, priority #10)
- `currency` field for in-game economy (earned by playing/winning)
- Starter pack + boosters for new users (enough for 1 team + basic deck)
- Deck editor will eventually validate against owned cards
- Teams will eventually be single-owner (for PvP/tournament entry)
