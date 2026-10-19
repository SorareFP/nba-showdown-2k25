// THE PLAY HUB — the Play button's page since 2026-10-19: every game mode as a
// card, with Resume on what is in progress (the user: "the modes as cards, with
// resume buttons for what's in progress"). Dynasty, Tournament and PvP left the
// top bar for it. What each card says is game/playHub.js; this loads the saves
// the same way Home does (the game here or on the account, whichever is newer).
import { useEffect, useState } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadRemoteGame } from '../firebase/games.js';
import { loadActiveRun } from '../firebase/climb.js';
import { listDynasties } from '../firebase/dynasties.js';
import { listSeasons } from '../firebase/seasons.js';
import { listMyLeagues, seasonOfLeague } from '../firebase/leagues.js';
import { readLocalGame, newerSave } from '../game/gameSave.js';
import { seasonsInProgress } from '../game/home.js';
import { hubCards } from '../game/playHub.js';
import s from './PlayHub.module.css';

const liveSave = x => (x?.game && !x.game.done ? x : null);

/** `onGo(to, opts)` is App's homeGo; `pvp` the live PvP room, if any. */
export default function PlayHub({ onGo, pvp = null }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const [saved] = useState(() => { try { return readLocalGame(); } catch { return null; } });
  const [remote, setRemote] = useState(null);
  const [data, setData] = useState(null);

  useEffect(() => {
    // Signed out (the dev route ?demo=modes): nothing on an account to resume.
    if (!uid) { setData({ run: null, dynasties: [], leagues: [], seasons: [] }); return undefined; }
    let live = true;
    loadRemoteGame(uid).then(r => { if (live) setRemote(r); }).catch(() => {});
    Promise.all([
      loadActiveRun(uid).catch(() => null),
      listDynasties(uid).catch(() => []),
      listMyLeagues(uid).catch(() => []),
      listSeasons(uid).catch(() => []),
    ]).then(([run, dynasties, leagues, solo]) => {
      if (!live) return;
      const shared = leagues.filter(l => l.kind === 'season').map(league => ({ league, season: seasonOfLeague(league) }));
      setData({ run, dynasties, leagues, seasons: seasonsInProgress({ solo, shared, uid }) });
    });
    return () => { live = false; };
  }, [uid]);

  const fromOther = newerSave(liveSave(saved), liveSave(remote)) === 'remote';
  const save = fromOther ? remote : liveSave(saved);
  const cards = hubCards({ save, fromOther, ...(data ?? {}), pvp, loading: !data });

  return (
    <div className={s.hub}>
      <h2 className={s.title}>Play</h2>
      <div className={s.grid}>
        {cards.map(c => (
          <section key={c.id} data-mode={c.id} className={`${s.card} ${c.status ? s.live : ''}`}>
            <div className={s.head}>
              <span className={s.icon} aria-hidden="true">{c.icon}</span>
              <h3 className={s.name}>{c.name}</h3>
            </div>
            {c.blurb && <p className={s.blurb}>{c.blurb}</p>}
            {c.status && <p className={s.status}>{c.status}</p>}
            {c.note && <p className={s.note}>{c.note}</p>}
            <button
              type="button"
              className={c.status ? s.primary : s.secondary}
              disabled={Boolean(c.action.disabled)}
              onClick={() => onGo(c.action.to, c.action.opts)}
            >
              {c.action.label}
            </button>
          </section>
        ))}
      </div>
    </div>
  );
}
