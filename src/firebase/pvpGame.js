// NBA Showdown 2K25 — PvP Game Initialization & Turn Logic

import { rtdb } from './config.js';
import { ref, get } from 'firebase/database';
import { newGame } from '../game/engine.js';
import { CARD_MAP } from '../game/cards.js';
import { startGame } from './pvpRoom.js';

// Snake draft order: A, B, B, A, A, B, B, A, A, B
const DRAFT_ORDER = ['A', 'B', 'B', 'A', 'A', 'B', 'B', 'A', 'A', 'B'];

// ── Turn Logic ────────────────────────────────────────────────────────────

/**
 * Map a team key ('A' or 'B') to 'host' or 'guest' based on hostIs.
 */
function mapTeamToRole(teamKey, hostIs) {
  return (teamKey === 'A') === (hostIs === 'A') ? 'host' : 'guest';
}

/**
 * Determine whose turn it is based on the current game phase.
 * Returns 'host', 'guest', 'both', or null.
 */
export function getWhoseTurn(game) {
  if (game.done) return null;

  switch (game.phase) {
    case 'draft': {
      const teamKey = DRAFT_ORDER[game.draft.step];
      return teamKey ? mapTeamToRole(teamKey, game.hostIs) : null;
    }

    case 'matchup_strats': {
      return mapTeamToRole(game.matchupTurn, game.hostIs);
    }

    case 'scoring': {
      // Rolling open — both players can act
      if (game.scoringPasses >= 99) return 'both';

      // Pending shot check — opponent may play Close Out
      if (game.pendingShotCheck) {
        const opponentKey = game.pendingShotCheck.teamKey === 'A' ? 'B' : 'A';
        return mapTeamToRole(opponentKey, game.hostIs);
      }

      return mapTeamToRole(game.scoringTurn, game.hostIs);
    }

    default:
      return null;
  }
}

// ── Private Data Extraction ───────────────────────────────────────────────

/**
 * Extract private data (hand & draft pool) for a given team key.
 */
export function extractPrivateData(game, teamKey) {
  return {
    hand: game[teamKey === 'A' ? 'teamA' : 'teamB'].hand || [],
    draftPool: teamKey === 'A' ? (game.draft?.aPool || []) : (game.draft?.bPool || []),
  };
}

// ── Strip Private Data ────────────────────────────────────────────────────

/**
 * Return a copy of the game state with private data removed.
 * Hands are emptied, decks become counts, draft pools are emptied.
 */
export function stripPrivateData(game) {
  const pub = JSON.parse(JSON.stringify(game));

  pub.teamA.hand = [];
  pub.teamB.hand = [];
  pub.teamA.deck = Array.isArray(game.teamA.deck) ? game.teamA.deck.length : game.teamA.deck;
  pub.teamB.deck = Array.isArray(game.teamB.deck) ? game.teamB.deck.length : game.teamB.deck;

  if (pub.draft) {
    pub.draft.aPool = [];
    pub.draft.bPool = [];
  }

  pub.whoseTurn = getWhoseTurn(pub);

  return pub;
}

// ── Game Initialization ───────────────────────────────────────────────────

/**
 * Initialize a PvP game: read team selections from RTDB, build game state,
 * separate private data, and write to Firebase via startGame.
 */
export async function initializePvpGame(code, hostUid, guestUid) {
  // 1. Read team selections from RTDB
  const [hostSnap, guestSnap] = await Promise.all([
    get(ref(rtdb, `rooms/${code}/hostTeam`)),
    get(ref(rtdb, `rooms/${code}/guestTeam`)),
  ]);

  const hostTeam = hostSnap.val();
  const guestTeam = guestSnap.val();

  // 2. Map roster playerIds to card objects
  const hostRoster = hostTeam.roster.map(id => CARD_MAP[id]);
  const guestRoster = guestTeam.roster.map(id => CARD_MAP[id]);

  // 3. Randomly assign host to Team A or B
  const hostIsA = Math.random() < 0.5;
  const hostIs = hostIsA ? 'A' : 'B';

  const rosterA = hostIsA ? hostRoster : guestRoster;
  const rosterB = hostIsA ? guestRoster : hostRoster;
  const deckConfigA = hostIsA ? hostTeam.deckConfig : guestTeam.deckConfig;
  const deckConfigB = hostIsA ? guestTeam.deckConfig : hostTeam.deckConfig;

  // 4. Create the game state
  const game = newGame(rosterA, rosterB, deckConfigA, deckConfigB);

  // 5. Set team names
  game.teamA.name = hostIsA ? hostTeam.teamName : guestTeam.teamName;
  game.teamB.name = hostIsA ? guestTeam.teamName : hostTeam.teamName;

  // 6. Tag with hostIs
  game.hostIs = hostIs;

  // 7. Extract private data for each player
  const hostTeamKey = hostIs;
  const guestTeamKey = hostIs === 'A' ? 'B' : 'A';

  const hostPrivate = extractPrivateData(game, hostTeamKey);
  const guestPrivate = extractPrivateData(game, guestTeamKey);

  // 8. Build public game state
  const publicGame = stripPrivateData(game);

  // 9. Write to Firebase
  await startGame(code, publicGame, hostUid, guestUid, hostPrivate, guestPrivate);

  // 10. Return the public game state
  return publicGame;
}
