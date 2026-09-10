import { useState, useRef, useEffect, useCallback } from 'react';
import CardsTab from './components/CardsTab.jsx';
import StratsTab from './components/StratsTab.jsx';
import TeamBuilderTab from './components/TeamBuilderTab.jsx';
import PlayTab from './components/PlayTab.jsx';
import SeasonTab from './components/SeasonTab.jsx';
import TournamentTab from './components/TournamentTab.jsx';
import HowToPlay from './components/HowToPlay.jsx';
import WelcomeTab from './components/WelcomeTab.jsx';
import HomeTab from './components/HomeTab.jsx';
import Skeleton from './ui/Skeleton.jsx';
import SignupBonus from './components/SignupBonus.jsx';
import CollectionTab from './components/CollectionTab.jsx';
import PvpLobby from './components/PvpLobby.jsx';
import PvpGame from './components/PvpGame.jsx';
import TutorialGame from './components/TutorialGame.jsx';
import AuthButton from './components/AuthButton.jsx';
import { AuthProvider, useAuth } from './firebase/AuthProvider.jsx';
import { LightboxProvider } from './components/CardLightbox.jsx';
import { DialogProvider } from './ui/dialogs.jsx';
import SoundToggle from './ui/SoundToggle.jsx';
import { CardStatsProvider } from './firebase/CardStatsProvider.jsx';
import { collectableKeys } from './game/collections.js';
import { loadCollection, getUserData, updateUserFields } from './firebase/collection.js';
import { ownedRoster } from './game/teamRules.js';
import { CARD_MAP } from './game/cards.js';
import styles from './App.module.css';
import { hasPlayedBefore, markPlayed, PLAYED_EVENT } from './game/firstRun.js';
import { phoneNavTabs } from './ui/phoneNav.js';

// Tabs visible to logged-out users: THE FRONT DOOR AND THE RULES, nothing
// that shows cards. The full card browser and a sandbox builder used to be
// the guest landing — three hundred faces on first paint, and every card in
// the game on display to someone who owns none. The user (2026-09-08): "It
// shouldn't show any cards and should push the user toward sign-up and the
// starter pack."
// `icon` and `short` are the phone bottom bar's: an icon over a one-word
// label, because seven full labels at 11px wrapped to three rows (2026-09-10).
const GUEST_TABS = [
  { id: 'home',      label: '🏀 Welcome',     icon: '🏀', short: 'Welcome' },
  { id: 'howtoplay', label: '📖 How to Play', icon: '📖', short: 'Rules' },
];
// Tabs visible to logged-in users (cards/strats hidden to preserve pack surprise).
// HOME comes first and is where a signed-in session lands (2026-09-10). The
// phone bar keeps its four everyday sections, so on a phone Home is the logo
// and the first row of More.
const AUTH_TABS = [
  { id: 'home',    label: '🏠 Home',         icon: '🏠', short: 'Home' },
  { id: 'builder', label: '🏗 Team Builder', icon: '🏗', short: 'Team' },
  { id: 'play',    label: '🏀 Play',         icon: '🏀', short: 'Play' },
  { id: 'season',  label: '📅 Season',       icon: '📅', short: 'Season' },
  { id: 'tournament', label: '🏆 Tournament', icon: '🏆', short: 'Tournament' },
  { id: 'pvp',     label: '⚔️ PvP',          icon: '⚔️', short: 'PvP' },
  { id: 'collection', label: '💾 Collection', icon: '💾', short: 'Cards' },
  { id: 'howtoplay', label: '📖 How to Play', icon: '📖', short: 'Rules' },
];

function AppInner() {
  const { user, loading: authLoading, signIn, justSignedUp, clearSignup } = useAuth();
  // Everyone lands on 'home': the Welcome page for a guest, HomeTab once
  // signed in. `user` is null on the first render while auth restores, so the
  // old `user ? 'builder' : 'home'` always started on 'home', and 'home' drew
  // nothing for a signed-in player: the blank page (2026-09-10).
  const [tab, setTab] = useState('home');
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);
  const [collection, setCollection] = useState({});
  const [pvpGame, setPvpGame] = useState(null); // { roomCode, myRole }
  const [tutorialMode, setTutorialMode] = useState(false);
  // THE RULES OVER A RUNNING TUTORIAL. The "?" on the board raises a help
  // event that opens How to Play; with the tutorial rendered INSTEAD of the
  // tabs, that click showed nothing (the user, 2026-09-08: "nothing happens
  // when hovering over it or clicking"). While this is set the tutorial stays
  // mounted behind How to Play, game intact, and its button brings you back.
  const [rulesOverTutorial, setRulesOverTutorial] = useState(false);
  // THE STARTER PACK FOLLOWS YOU AROUND until it is claimed. The Collection
  // tab has the full prompt (team pick, open); every other tab gets this band
  // pointing there. The user (2026-09-08): "We should have the starter pack
  // banner on every page until claimed." Read with the collection, so
  // opening the pack — which refreshes the collection — clears it.
  const [starter, setStarter] = useState(null);   // null = unknown or signed out
  const dismissBonus = useCallback(() => {
    clearSignup();
    setStarter(s => (s ? { ...s, bonusSeen: true } : s));
    if (user) updateUserFields(user.uid, { 'settings.bonusSeen': true }).catch(() => {});
  }, [user, clearSignup]);
  // A signed-in account with the starter still unopened lands on Collection,
  // where the pack is — once per sign-in, so it does not fight the player.
  const landedRef = useRef(null);
  useEffect(() => {
    if (!user) { landedRef.current = null; return; }
    if (starter && !starter.opened && landedRef.current !== user.uid) {
      landedRef.current = user.uid;
      setTab('collection');
    }
  }, [user, starter]);
  // THE NEWCOMER'S BANNER: until this browser has dealt a game, point at the
  // tutorial. Cleared by the first deal, the tutorial's end, or the ×.
  const [playedBefore, setPlayedBefore] = useState(hasPlayedBefore);
  useEffect(() => {
    const done = () => setPlayedBefore(true);
    window.addEventListener(PLAYED_EVENT, done);
    return () => window.removeEventListener(PLAYED_EVENT, done);
  }, []);
  const [helpSection, setHelpSection] = useState(null);
  // The phone's More sheet (the sections that do not fit the bottom bar).
  const [moreOpen, setMoreOpen] = useState(false);
  useEffect(() => {
    if (!moreOpen) return undefined;
    const onKey = e => { if (e.key === 'Escape') setMoreOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);
  const goTab = id => { setTab(id); setMoreOpen(false); };
  // THE HOME PAGE'S LINKS go deeper than a tab: the Pack Shop, the
  // collections list, one particular season. That target rides along once
  // and is dropped when you leave the tab, so a later tap on the tab itself
  // opens it the usual way.
  const [collectionView, setCollectionView] = useState(null);
  const [seasonOpen, setSeasonOpen] = useState(null);   // { seasonId } | { leagueId }
  useEffect(() => { if (tab !== 'collection') setCollectionView(null); }, [tab]);
  useEffect(() => { if (tab !== 'season') setSeasonOpen(null); }, [tab]);
  const homeGo = (to, opts = {}) => {
    const section = { shop: 'shop', goals: 'goals', mycards: 'collection' }[to];
    if (section) { setCollectionView(section); goTab('collection'); return; }
    if (to === 'season') setSeasonOpen(opts.seasonId || opts.leagueId ? opts : null);
    goTab(to);
  };
  const playMounted = useRef(false);
  if (tab === 'play') playMounted.current = true;

  // THE SEASON'S HANDOFF TO THE PLAY TAB, in two pieces of state.
  //
  //   seasonPreset  a fixture going OUT — the rosters and the ids PlayTab
  //                 needs to deal the game and to report the score
  //   seasonResult  a final score coming BACK, held here until SeasonTab
  //                 records it
  //
  // It lives in App rather than in either tab because the season screen is
  // unmounted for the whole game and the play screen knows nothing about
  // schedules. See the header comment in SeasonTab.jsx.
  const [seasonPreset, setSeasonPreset] = useState(null);
  const [seasonResult, setSeasonResult] = useState(null);

  // THE SLIDING UNDERLINE.
  //
  // Measured rather than styled, because the tabs are different widths and the
  // set of them changes on sign-in — a CSS-only version would need a fixed
  // width per tab and would then lie about which one is active.
  //
  // Re-measured on tab change, on the tab LIST changing, and on resize, since
  // the header wraps to two rows under 700px and every offset moves with it.
  const navRef = useRef(null);
  const [marker, setMarker] = useState(null);

  const refreshCollection = useCallback(async () => {
    if (!user) { setCollection({}); setStarter(null); return; }
    const c = await loadCollection(user.uid);
    try {
      const u = await getUserData(user.uid);
      setStarter(u ? { opened: Boolean(u.starterPackOpened), favorite: Boolean(u.favoriteTeam), bonusSeen: Boolean(u.settings?.bonusSeen) } : null);
    } catch {
      setStarter(null);
    }
    setCollection(c);
  }, [user]);

  useEffect(() => { refreshCollection(); }, [refreshCollection]);

  useEffect(() => {
    const handler = (e) => {
      setHelpSection(e.detail.section);
      setTab('howtoplay');
      setRulesOverTutorial(true);   // a no-op outside the tutorial
    };
    window.addEventListener('showdown-help', handler);
    return () => window.removeEventListener('showdown-help', handler);
  }, []);

  const tabs = user ? AUTH_TABS : GUEST_TABS;
  // Signing out from a signed-in-only tab lands on the front door.
  useEffect(() => {
    if (!user && !authLoading && !tabs.some(t => t.id === tab)) setTab('home');
  }, [user, authLoading, tabs, tab]);

  useEffect(() => {
    const measure = () => {
      const el = navRef.current?.querySelector(`[data-tab="${tab}"]`);
      if (!el) { setMarker(null); return; }
      // Just under the button, in the padding the nav reserves for it.
      setMarker({ left: el.offsetLeft, width: el.offsetWidth, top: el.offsetTop + el.offsetHeight + 2 });
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [tab, tabs]);

  const handleLoadTeam = (savedTeam, slot) => {
    // Only the cards still owned — see ownedRoster in teamRules.js.
    const { roster: ids, dropped } = ownedRoster(savedTeam.players, collection);
    if (dropped.length) {
      alert(`${dropped.length} player${dropped.length === 1 ? ' is' : 's are'} no longer in your collection and ${dropped.length === 1 ? 'was' : 'were'} left out. Edit the team in My Teams.`);
    }
    const roster = ids.map(id => CARD_MAP[id]).filter(Boolean);
    if (slot === 'A') setTeamA(roster);
    else setTeamB(roster);
    setTab('builder');
  };

  // A dot on the Collection tab while a card is waiting to be collected.

  const collectable = collectableKeys(collection ?? {}).size;
  const phoneNav = phoneNavTabs(tabs);

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <button type="button" className={styles.logo} onClick={() => goTab('home')} title="Home">
          <img src="/nba-showdown-2k25/logo.png" alt="NBA Showdown 2026" className={styles.logoImg} />
          <div>
            <div className={styles.logoTitle}>NBA Showdown 2026</div>
            <div className={styles.logoSub}>D20 Basketball Card Game · 306 Players</div>
          </div>
        </button>
        <nav className={styles.nav} ref={navRef}>
          {marker && (
            <span
              className={styles.navMarker}
              aria-hidden="true"
              style={{ transform: `translateX(${marker.left}px)`, width: marker.width, top: marker.top }}
            />
          )}
          {tabs.map(t => (
            <button
              key={t.id}
              data-tab={t.id}
              className={`${styles.navBtn} ${tab === t.id ? styles.active : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
              {t.id === 'collection' && collectable > 0 && (
                <span className={styles.navDot} title={`${collectable} card${collectable === 1 ? '' : 's'} waiting to be collected`} />
              )}
            </button>
          ))}
        </nav>
        <div className={styles.headerActions}>
          <SoundToggle />
          <AuthButton />
        </div>
      </header>

      <div className={styles.betaBanner}>
        <span className={styles.long}>NBA Showdown 2026 is in beta — cards and collections are still subject to change.</span>
        <span className={styles.short}>Beta — cards and collections may still change.</span>
      </div>
      {/* THE FIRST THING A GUEST NEEDS TO KNOW. The starter pack, the
          collection, seasons and the roaming game all live on the account,
          and the only way in is Google. The user (2026-09-08): "make sure
          that new players know they have to sign in/up with google in order
          to claim their starter pack." */}
      {/* THE STARTER BAND, signed in or not (the user, 2026-09-08: "Signed-in
          or not, it should show that you are ready to open your starter
          pack"). A guest is told it is ready and offered the sign-in; an
          account that has not opened it is pointed at Collection. */}
      {!user && !authLoading && tab !== 'home' && !tutorialMode && (
        <div className={styles.starterBand}>
          <span>
            Your <strong>Starter Pack</strong> is ready<span className={styles.long}> — 20 players, 30 strategy cards and Unethical Hoops. <strong>Sign in with Google</strong> to open it</span>.
          </span>
          <button className={styles.starterBandBtn} onClick={signIn}>Sign in with Google</button>
        </div>
      )}

      {user && starter && !starter.opened && tab !== 'collection' && !tutorialMode && (
        <div className={styles.starterBand}>
          <span>
            Your <strong>Starter Pack</strong> is waiting<span className={styles.long}>{starter.favorite ? '' : ' — pick the team you support and open it'}. 20 players, 30 strategy cards and Unethical Hoops</span>.
          </span>
          <button className={styles.starterBandBtn} onClick={() => setTab('collection')}>{starter.favorite ? 'Open it' : 'Claim it'}</button>
        </div>
      )}
      {!playedBefore && !tutorialMode && (
        <div className={styles.firstRun}>
          <span>
            First time here?<span className={styles.long}> <strong>Play the tutorial</strong> — a guided quarter against the coach, about twelve minutes, that teaches placement, the card windows and rolling.</span>
          </span>
          <button className={styles.firstRunBtn} onClick={() => { setTutorialMode(true); setRulesOverTutorial(false); }}>Play the tutorial</button>
          <button className={styles.firstRunDismiss} onClick={() => { markPlayed(); }} aria-label="Dismiss">×</button>
        </div>
      )}
      {/* THE SIGN-UP BONUS keys off the ACCOUNT, not the sign-in: it shows
          while the Starter Pack is unopened and the pop-up has not been
          dismissed on this account (settings.bonusSeen, a client-writable
          field). A flag held only in memory vanished on any reload, and an
          account that existed before the pop-up did — every account today,
          reset or not — never saw it. `justSignedUp` still opens it on the
          very first paint, before the user document has been read back. */}
      {user && !tutorialMode && (justSignedUp || (starter && !starter.opened && !starter.bonusSeen)) && (
        <SignupBonus
          name={user.displayName}
          onClaim={() => { dismissBonus(); setTab('collection'); }}
          onDismiss={dismissBonus}
        />
      )}
      <main className={styles.main}>
        {tutorialMode && (
          <div style={{ display: rulesOverTutorial ? 'none' : 'block' }}>
            <TutorialGame onExit={() => { setTutorialMode(false); setRulesOverTutorial(false); setTab('howtoplay'); }} />
          </div>
        )}
        {(!tutorialMode || rulesOverTutorial) && (
          <>
            {/* Keyed on `tab`, so switching replays the fade. THE PLAY TAB IS
                NOT IN HERE: it is kept mounted behind a display toggle so a
                game survives you looking at your collection, and a key change
                would remount it and throw the game away. It is the one tab
                that does not cross-fade, and that is the trade. */}
            <div key={tab} className={styles.tabFade}>
            {tab === 'home' && !user && authLoading && (
              <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 20px' }}>
                <Skeleton rows={4} height={72} label="Signing in" />
              </div>
            )}
            {tab === 'home'    && !user && !authLoading && (
              <WelcomeTab
                onTutorial={() => { setTutorialMode(true); setRulesOverTutorial(false); }}
                onHowToPlay={() => setTab('howtoplay')}
              />
            )}
            {tab === 'home' && user && (
              <HomeTab
                collection={collection}
                starter={starter}
                onGo={homeGo}
                onTutorial={() => { setTutorialMode(true); setRulesOverTutorial(false); }}
              />
            )}
            {tab === 'cards'   && <CardsTab />}
            {tab === 'strats'  && <StratsTab />}
            {tab === 'howtoplay' && (
              <HowToPlay
                scrollToSection={helpSection}
                tutorialRunning={tutorialMode}
                onStartTutorial={() => {
                  if (tutorialMode) { setRulesOverTutorial(false); return; }   // back to it
                  setTutorialMode(true);
                }}
              />
            )}
            {tab === 'builder' && (
              <TeamBuilderTab
                teamA={teamA} setTeamA={setTeamA}
                teamB={teamB} setTeamB={setTeamB}
                onStartGame={() => setTab('play')}
                collection={collection}
              />
            )}
            {tab === 'collection' && <CollectionTab onLoadTeam={handleLoadTeam} onCollectionChange={refreshCollection} initialView={collectionView} />}
            {tab === 'season' && (
              <SeasonTab
                openSeasonId={seasonOpen?.seasonId ?? null}
                openLeagueId={seasonOpen?.leagueId ?? null}
                teamA={teamA}
                collection={collection}
                pendingResult={seasonResult}
                onResultConsumed={() => setSeasonResult(null)}
                onPlayFixture={fixture => { setSeasonPreset(fixture); setTab('play'); }}
              />
            )}
            {tab === 'tournament' && <TournamentTab teamA={teamA} collection={collection} />}
            {tab === 'pvp' && !pvpGame && (
              <PvpLobby collection={collection} onGameStart={(roomCode, myRole) => setPvpGame({ roomCode, myRole })} />
            )}
            {tab === 'pvp' && pvpGame && (
              <PvpGame
                roomCode={pvpGame.roomCode}
                myRole={pvpGame.myRole}
                onLeave={() => setPvpGame(null)}
              />
            )}
            </div>
            {playMounted.current && (
              <div style={{ display: tab === 'play' ? 'block' : 'none' }}>
                <PlayTab
                  teamA={teamA}
                  teamB={teamB}
                  preset={seasonPreset}
                  onPresetFinish={result => {
                    setSeasonPreset(null);
                    // A null result is a fixture left unplayed, not a 0-0.
                    if (result) setSeasonResult(result);
                    setTab('season');
                  }}
                />
              </div>
            )}
          </>
        )}
      </main>

      {/* THE PHONE'S BOTTOM BAR. Hidden above 768px by CSS, so desktop keeps
          the header nav it has always had. Where thumbs reach, 52px targets,
          padded into the safe area on notched phones. The top nav at 11px
          wrapped seven pills to three rows and cost 110px before any content
          (2026-09-10 survey). */}
      <nav className={styles.bottomNav} aria-label="Sections">
        {phoneNav.bar.map(t => (
          <button
            key={t.id}
            className={`${styles.bnBtn} ${tab === t.id ? styles.bnActive : ''}`}
            onClick={() => goTab(t.id)}
            aria-current={tab === t.id ? 'page' : undefined}
          >
            <span className={styles.bnIcon} aria-hidden="true">{t.icon}</span>
            <span className={styles.bnLabel}>{t.short}</span>
            {t.id === 'collection' && collectable > 0 && <span className={styles.bnDot} aria-label={`${collectable} to collect`} />}
          </button>
        ))}
        {phoneNav.more.length > 0 && (
          <button
            className={`${styles.bnBtn} ${phoneNav.more.some(t => t.id === tab) || moreOpen ? styles.bnActive : ''}`}
            onClick={() => setMoreOpen(o => !o)}
            aria-expanded={moreOpen}
          >
            <span className={styles.bnIcon} aria-hidden="true">☰</span>
            <span className={styles.bnLabel}>More</span>
          </button>
        )}
      </nav>
      {moreOpen && (
        <div className={styles.sheetBackdrop} onClick={() => setMoreOpen(false)}>
          <div className={styles.sheet} role="dialog" aria-label="More sections" onClick={e => e.stopPropagation()}>
            {phoneNav.more.map(t => (
              <button
                key={t.id}
                className={`${styles.sheetItem} ${tab === t.id ? styles.sheetActive : ''}`}
                onClick={() => goTab(t.id)}
              >
                <span className={styles.bnIcon} aria-hidden="true">{t.icon}</span>
                {t.label.replace(/^\S+\s/, '')}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <CardStatsProvider>
      <LightboxProvider>
        <DialogProvider>
          <AppInner />
        </DialogProvider>
      </LightboxProvider>
      </CardStatsProvider>
    </AuthProvider>
  );
}
