// FRIENDS, loaded once per sign-in (2026-10-11). The overview comes from the
// myFriends callable — friends, their needs, requests, people you've played —
// and `wants` maps each card a friend needs to who needs it (wantsByCard).
// A failure leaves everything empty: My Collection, the reveal, the market and
// Home all read this, and none of them may break because Friends is down.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthProvider.jsx';
import { myFriends, publishNeeds, loadPublishedNeeds } from './friends.js';
import { loadClaims } from './collection.js';
import { syncNeeds, wantsByCard } from '../game/friends.js';

const EMPTY = { overview: null, wants: new Map(), friendNames: new Map(), refresh: () => {}, error: null };
const Ctx = createContext(EMPTY);
export const useFriends = () => useContext(Ctx);

const REFRESH_EVERY_MS = 60_000;

export function FriendsProvider({ children }) {
  const { user } = useAuth();
  const [overview, setOverview] = useState(null);
  const [error, setError] = useState(null);
  const lastAt = useRef(0);
  const refresh = useCallback(async () => {
    if (!user) { setOverview(null); return; }
    lastAt.current = Date.now();
    try {
      setOverview(await myFriends());
      setError(null);
    } catch (e) {
      setError(e?.message ?? String(e));
    }
  }, [user]);
  useEffect(() => { refresh(); }, [refresh]);
  // Back to the tab after a while: a friend may have collected or listed.
  useEffect(() => {
    const onFocus = () => { if (Date.now() - lastAt.current > REFRESH_EVERY_MS) refresh(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);
  const value = useMemo(() => ({
    overview,
    wants: wantsByCard(overview?.friends ?? []),
    friendNames: new Map((overview?.friends ?? []).map(f => [f.uid, f.name])),
    refresh,
    error,
  }), [overview, refresh, error]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * PUBLISH YOUR NEEDS whenever your collection changes (after a pack, a buy, a
 * collect, a claim, and on load), and only when they changed — the first
 * comparison is with what the profile already holds.
 */
export function usePublishNeeds(user, collection) {
  const last = useRef(undefined);
  useEffect(() => {
    if (!user || !collection) return undefined;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const claims = await loadClaims(user.uid);
        if (last.current === undefined) last.current = await loadPublishedNeeds(user.uid);
        if (!live) return;
        // The decision is syncNeeds (src/game/friends.js), tested there.
        const r = await syncNeeds({
          collection, claimedIds: new Set(Object.keys(claims ?? {})), published: last.current,
          publish: next => publishNeeds(user.uid, next),
        });
        last.current = r.last;
      } catch (e) {
        console.warn('needs not published', e?.message ?? e);
      }
    }, 1500);
    return () => { live = false; clearTimeout(t); };
  }, [user, collection]);
}
