// THE SIGNED-IN HOME PAGE.
//
// A signed-in player used to land on a blank screen: the app opened on
// 'home', and 'home' only rendered the guest's Welcome page. The user
// (2026-09-10): "Can you build a homepage, so that it just doesn't show blank
// on the screen when you navigate to the site? Latest news (like get your
// starter pack, Unethical Hoops), closest collections with a link to the pack
// shop, seasons in progress with your current standing and next opponent,
// player stats, etc."
//
// Everything here is read-only and a link somewhere else; the arithmetic is in
// game/home.js. Each panel loads on its own and shows its own empty state, so
// a slow read never holds up the rest of the page.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { useCardStats } from '../firebase/CardStatsProvider.jsx';
import { useLightbox } from './CardLightbox.jsx';
import { getUserData, loadClaims } from '../firebase/collection.js';
import { listSeasons } from '../firebase/seasons.js';
import { listMyLeagues, seasonOfLeague } from '../firebase/leagues.js';
import { loadRemoteGame } from '../firebase/games.js';
import { myCardRequests } from '../firebase/freeAgents.js';
import { signableCount, signNotice } from '../game/freeAgents.js';
import { collectedKeys, collectableKeys } from '../game/collections.js';
import { readLocalGame, describeSave, newerSave } from '../game/gameSave.js';
import { getPlayerThumbUrl, getPlayerImageUrl, getStratThumbPath, getStratImagePath, fallbackTo } from '../game/cardImages.js';
import { newsFor, closestGoals, seasonsInProgress, careerLeaders, careerTotals } from '../game/home.js';
import Skeleton from '../ui/Skeleton.jsx';
import s from './HomeTab.module.css';

const NEWS_SHOWN = 4;
const fmtDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const one = n => n.toFixed(1);

/**
 * `onGo(to, opts)` moves the app: a tab id, or 'shop' / 'goals' / 'mycards'
 * for a Collection section, or 'season' with `{ seasonId }` / `{ leagueId }`.
 */
export default function HomeTab({ collection = {}, starter = null, onGo = () => {}, onTutorial = () => {} }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { stats } = useCardStats();
  const lightbox = useLightbox();
  const [coins, setCoins] = useState(null);
  const [claimed, setClaimed] = useState(null);
  const [seasons, setSeasons] = useState(null);   // null while loading
  const [allNews, setAllNews] = useState(false);
  const [saved] = useState(() => { try { return readLocalGame(); } catch { return null; } });
  const [remoteSave, setRemoteSave] = useState(null);
  // Free Agents whose card is made and invoiced, waiting for this player to sign.
  const [signable, setSignable] = useState(0);

  useEffect(() => {
    if (!uid) return undefined;
    let live = true;
    getUserData(uid).then(u => { if (live) setCoins(u?.currency ?? 0); }).catch(() => {});
    myCardRequests(uid).then(rs => { if (live) setSignable(signableCount(rs)); }).catch(() => {});
    loadClaims(uid).then(c => { if (live) setClaimed(new Set(Object.keys(c ?? {}))); }).catch(() => { if (live) setClaimed(new Set()); });
    loadRemoteGame(uid).then(r => { if (live) setRemoteSave(r); }).catch(() => {});
    Promise.all([listSeasons(uid).catch(() => []), listMyLeagues(uid).catch(() => [])]).then(([solo, leagues]) => {
      if (!live) return;
      const shared = leagues.filter(l => l.kind === 'season').map(league => ({ league, season: seasonOfLeague(league) }));
      setSeasons(seasonsInProgress({ solo, shared, uid }));
    });
    return () => { live = false; };
  }, [uid]);

  const owned = useMemo(() => collectedKeys(collection), [collection]);
  const waiting = useMemo(() => collectableKeys(collection ?? {}).size, [collection]);
  const goals = useMemo(() => (claimed ? closestGoals(owned, { claimed, limit: 4 }) : null), [owned, claimed]);
  const leaders = useMemo(() => careerLeaders(stats), [stats]);
  const totals = useMemo(() => careerTotals(stats), [stats]);
  const news = newsFor({ starterOpened: !starter || starter.opened });
  const shownNews = allNews ? news : news.slice(0, NEWS_SHOWN);
  const first = user?.displayName?.split(' ')[0] ?? null;
  // The game in progress here OR on the account, whichever is newer, so a
  // game started on the desktop shows up on the phone.
  const liveSave = x => (x?.game && !x.game.done ? x : null);
  const fromOther = newerSave(liveSave(saved), liveSave(remoteSave)) === 'remote';
  const resume = fromOther ? remoteSave : liveSave(saved);
  const noCards = owned.size === 0;

  return (
    <div className={s.wrap}>
      <header className={s.hello}>
        <div className={s.helloText}>
          <h1 className={s.title}>{first ? `Welcome back, ${first}` : 'Welcome back'}</h1>
          <p className={s.sub}>Here is where everything stands.</p>
        </div>
        <div className={s.pills}>
          <span className={s.coinPill} title="Your coins">🪙 {coins == null ? '—' : coins.toLocaleString()} coins</span>
          {signable > 0 && (
            <button className={`${s.pill} ${s.faPill}`} onClick={() => onGo('freeagents')} title="Open Free Agents to see the card and sign it">
              ✍️ {signNotice(signable)}
            </button>
          )}
          {waiting > 0 && (
            <button className={s.pill} onClick={() => onGo('mycards')}>
              {waiting} card{waiting === 1 ? '' : 's'} to collect
            </button>
          )}
        </div>
      </header>

      {resume && (
        <section className={s.resume}>
          <div>
            <div className={s.kicker}>{fromOther ? 'Game in progress on your other device' : 'Game in progress'}</div>
            <div className={s.resumeLine}>{describeSave(resume)}</div>
          </div>
          <button className={s.primary} onClick={() => onGo('play')}>{fromOther ? 'Resume here' : 'Resume game'}</button>
        </section>
      )}

      <nav className={s.quick} aria-label="Quick actions">
        <button className={s.quickBtn} onClick={() => onGo('play')}><span aria-hidden="true">🏀</span> Play a game</button>
        <button className={s.quickBtn} onClick={() => onGo('builder')}><span aria-hidden="true">🏗</span> Build a team</button>
        <button className={s.quickBtn} onClick={() => onGo('season')}><span aria-hidden="true">📅</span> Seasons</button>
        <button className={s.quickBtn} onClick={() => onGo('shop')}><span aria-hidden="true">🛒</span> Pack Shop</button>
        <button className={s.quickBtn} onClick={onTutorial}><span aria-hidden="true">🎓</span> Tutorial</button>
      </nav>

      <div className={s.grid}>
        {/* ── Seasons ── */}
        <section className={s.panel} aria-labelledby="home-seasons">
          <div className={s.panelHead}>
            <h2 id="home-seasons" className={s.panelTitle}>Seasons in progress</h2>
            <button className={s.link} onClick={() => onGo('season')}>All seasons →</button>
          </div>
          {seasons == null ? (
            <Skeleton rows={2} height={64} label="Loading seasons" />
          ) : seasons.length === 0 ? (
            <div className={s.empty}>
              <p>No season going. A short one in a six-team league is five games, then the playoffs.</p>
              <button className={s.secondary} onClick={() => onGo('season')}>Start a season</button>
            </div>
          ) : (
            <ul className={s.list}>
              {seasons.map(row => (
                <li key={`${row.kind}:${row.id}`} className={s.season}>
                  <div className={s.seasonTop}>
                    <span className={s.seasonTitle}>{row.title}</span>
                    {row.kind === 'league' && <span className={s.tag}>With friends</span>}
                  </div>
                  <div className={s.standing}>
                    <span className={s.record}>{row.record}</span>
                    <span className={s.muted}>
                      {row.place ?? '—'}
                      {row.gb > 0 ? ` · ${row.gb % 1 ? row.gb.toFixed(1) : row.gb} GB` : ''}
                      {' · '}{row.stage}
                    </span>
                  </div>
                  <div className={s.nextLine}>
                    {row.next ? (
                      <>
                        <span className={s.muted}>{row.next.playoff ? 'Next playoff game' : 'Next'}:</span>{' '}
                        <strong>{row.next.home ? 'vs' : '@'} {row.next.opponent}</strong>
                        {row.next.oppRecord && <span className={s.muted}> ({row.next.oppRecord})</span>}
                        {row.next.human && <span className={s.tag}>PvP</span>}
                      </>
                    ) : (
                      <span className={s.muted}>No game waiting on you.</span>
                    )}
                  </div>
                  <button
                    className={s.rowBtn}
                    onClick={() => onGo('season', row.kind === 'league' ? { leagueId: row.id } : { seasonId: row.id })}
                  >
                    {row.next ? 'Open' : 'View'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Closest collections ── */}
        <section className={s.panel} aria-labelledby="home-goals">
          <div className={s.panelHead}>
            <h2 id="home-goals" className={s.panelTitle}>Closest collections</h2>
            <button className={s.link} onClick={() => onGo('goals')}>All collections →</button>
          </div>
          {goals == null ? (
            <Skeleton rows={3} height={44} label="Loading collections" />
          ) : noCards ? (
            <div className={s.empty}>
              <p>Collect a player and every collection that wants him starts counting.</p>
              <button className={s.secondary} onClick={() => onGo('collection')}>
                {starter && !starter.opened ? 'Open your Starter Pack' : 'Go to Collection'}
              </button>
            </div>
          ) : (
            <ul className={s.list}>
              {goals.map(g => (
                <li key={g.id} className={s.goal}>
                  <div className={s.goalTop}>
                    <span className={s.goalName}>{g.label}<span className={s.muted}> · {g.league}</span></span>
                    {g.ready
                      ? <button className={s.readyBtn} onClick={() => onGo('goals')}>Ready to claim</button>
                      : <span className={s.muted}>{g.owned}/{g.total} · {g.missingCount} to go</span>}
                  </div>
                  <div className={s.bar} role="progressbar" aria-valuemin={0} aria-valuemax={g.total} aria-valuenow={g.owned} aria-label={`${g.label}: ${g.owned} of ${g.total}`}>
                    <span style={{ width: `${Math.round((100 * g.owned) / Math.max(1, g.total))}%` }} className={g.ready ? s.barDone : undefined} />
                  </div>
                  {!g.ready && g.pack && (
                    <div className={s.packHint}>
                      Best pack: <button className={s.inlineLink} onClick={() => onGo('shop')}>{g.pack.name}</button> · {g.pack.price} coins
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          <button className={s.shopBtn} onClick={() => onGo('shop')}>🛒 Go to the Pack Shop</button>
        </section>

        {/* ── News ── */}
        <section className={s.panel} aria-labelledby="home-news">
          <div className={s.panelHead}>
            <h2 id="home-news" className={s.panelTitle}>Latest news</h2>
          </div>
          <ul className={s.list}>
            {shownNews.map(n => (
              <li key={n.id} className={`${s.news} ${n.highlight ? s.newsHi : ''}`}>
                {n.image && (
                  <img
                    className={s.newsImg}
                    src={getStratThumbPath(n.image)}
                    onError={fallbackTo(getStratImagePath(n.image))}
                    alt=""
                    loading="lazy"
                  />
                )}
                <div className={s.newsText}>
                  <div className={s.newsTop}>
                    <span className={s.newsTitle}>{n.title}</span>
                    {n.date && <span className={s.date}>{fmtDate(n.date)}</span>}
                  </div>
                  <p className={s.newsBody}>{n.body}</p>
                  {n.to && <button className={n.highlight ? s.primarySm : s.link} onClick={() => onGo(n.to)}>{n.cta} →</button>}
                </div>
              </li>
            ))}
          </ul>
          {news.length > NEWS_SHOWN && (
            <button className={s.link} onClick={() => setAllNews(v => !v)}>
              {allNews ? 'Show less' : `All news (${news.length})`}
            </button>
          )}
        </section>

        {/* ── Lifetime stats ── */}
        <section className={s.panel} aria-labelledby="home-stats">
          <div className={s.panelHead}>
            <h2 id="home-stats" className={s.panelTitle}>Your career leaders</h2>
            {totals.cards > 0 && <span className={s.muted}>{totals.cards} players · {totals.pts.toLocaleString()} pts</span>}
          </div>
          {leaders.length === 0 ? (
            <div className={s.empty}>
              <p>Every game your players play adds to their lifetime line. Play one and the leaders show up here.</p>
              <button className={s.secondary} onClick={() => onGo('play')}>Play a game</button>
            </div>
          ) : (
            <ol className={s.list}>
              {leaders.map((r, i) => (
                <li key={r.key} className={s.leader}>
                  <span className={s.rank}>{i + 1}</span>
                  <button
                    className={s.leaderCard}
                    onClick={() => lightbox?.open('player', r.card)}
                    title="View card"
                  >
                    <img
                      className={s.thumb}
                      src={getPlayerThumbUrl(r.key)}
                      onError={fallbackTo(getPlayerImageUrl(r.key))}
                      alt=""
                      loading="lazy"
                    />
                    <span className={s.leaderText}>
                      <span className={s.leaderName}>{r.card.name}</span>
                      <span className={s.muted}>
                        {r.card.team}{r.card.season ? ` · ${r.card.season}` : ''} · {r.games} G · {r.wins}–{r.games - r.wins}
                      </span>
                    </span>
                  </button>
                  <span className={s.line}>
                    <strong>{one(r.ppg)}</strong> pts · {one(r.rpg)} reb · {one(r.apg)} ast
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
