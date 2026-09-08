import { useState, useRef, useEffect, useCallback } from 'react';
import CardsTab from './components/CardsTab.jsx';
import StratsTab from './components/StratsTab.jsx';
import TeamBuilderTab from './components/TeamBuilderTab.jsx';
import PlayTab from './components/PlayTab.jsx';
import SeasonTab from './components/SeasonTab.jsx';
import HowToPlay from './components/HowToPlay.jsx';
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
import { loadCollection } from './firebase/collection.js';
import { ownedRoster } from './game/teamRules.js';
import { CARD_MAP } from './game/cards.js';
import styles from './App.module.css';

// Tabs visible to logged-out users (full card browser)
const GUEST_TABS = [
  { id: 'cards',   label: '📋 Cards' },
  { id: 'strats',  label: '🃏 Strategy Cards' },
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
  { id: 'season',  label: '📅 Season' },
  { id: 'howtoplay', label: '📖 How to Play' },
];
// Tabs visible to logged-in users (cards/strats hidden to preserve pack surprise)
const AUTH_TABS = [
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
  { id: 'season',  label: '📅 Season' },
  { id: 'pvp',     label: '⚔️ PvP' },
  { id: 'collection', label: '💾 Collection' },
  { id: 'howtoplay', label: '📖 How to Play' },
];

function AppInner() {
  const { user, loading: authLoading, signIn } = useAuth();
  const [tab, setTab] = useState(user ? 'builder' : 'cards');
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
  const [helpSection, setHelpSection] = useState(null);
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
    if (!user) { setCollection({}); return; }
    const c = await loadCollection(user.uid);
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

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <img src="/nba-showdown-2k25/logo.png" alt="NBA Showdown 2026" className={styles.logoImg} />
          <div>
            <div className={styles.logoTitle}>NBA Showdown 2026</div>
            <div className={styles.logoSub}>D20 Basketball Card Game · 306 Players</div>
          </div>
        </div>
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
        NBA Showdown 2026 is in beta — cards and collections are still subject to change.
      </div>
      {/* THE FIRST THING A GUEST NEEDS TO KNOW. The starter pack, the
          collection, seasons and the roaming game all live on the account,
          and the only way in is Google. The user (2026-09-08): "make sure
          that new players know they have to sign in/up with google in order
          to claim their starter pack." */}
      {!user && !authLoading && (
        <div className={styles.signInCta}>
          <span>
            New here? <strong>Sign in with Google</strong> to claim your free <strong>Starter Pack</strong> — 20 players, 30 strategy cards and Unethical Hoops. Everything you see signed out is a sandbox.
          </span>
          <button className={styles.signInCtaBtn} onClick={signIn}>Sign in with Google</button>
        </div>
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
            {tab === 'collection' && <CollectionTab onLoadTeam={handleLoadTeam} onCollectionChange={refreshCollection} />}
            {tab === 'season' && (
              <SeasonTab
                teamA={teamA}
                collection={collection}
                pendingResult={seasonResult}
                onResultConsumed={() => setSeasonResult(null)}
                onPlayFixture={fixture => { setSeasonPreset(fixture); setTab('play'); }}
              />
            )}
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
