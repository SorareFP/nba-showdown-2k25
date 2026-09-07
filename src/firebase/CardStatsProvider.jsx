// THE LIFETIME TRACKER, loaded once per sign-in and refreshed after a claim.
//
// `users/{uid}/cardStats/{cardKey}` holds a card's running totals — games,
// wins, points, rebounds, assists, minutes, threes — written by
// claimGameReward. The card lightbox reads them to show totals and per-game
// averages; GameOver asks for a refresh once its claim has landed. Read-only
// here: the rules let nobody but the server write a stat line.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { loadCardStats } from './collection.js';

const Ctx = createContext({ stats: {}, refresh: () => {} });

export function useCardStats() {
  return useContext(Ctx);
}

export function CardStatsProvider({ children }) {
  const { user } = useAuth();
  const [stats, setStats] = useState({});
  const refresh = useCallback(async () => {
    if (!user) { setStats({}); return; }
    try {
      setStats(await loadCardStats(user.uid));
    } catch (e) {
      console.warn('card stats failed to load', e);
    }
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  return <Ctx.Provider value={{ stats, refresh }}>{children}</Ctx.Provider>;
}
