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
  const { user } = useAuth();
  const [tab, setTab] = useState(user ? 'builder' : 'cards');
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);
  const [collection, setCollection] = useState({});
  const [pvpGame, setPvpGame] = useState(null); // { roomCode, myRole }
  const [tutorialMode, setTutorialMode] = useState(false);
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
    };
    window.addEventListener('showdown-help', handler);
    return () => window.removeEventListener('showdown-help', handler);
  }, []);

  const tabs = user ? AUTH_TABS : GUEST_TABS;

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
        <nav className={styles.nav}>
          {tabs.map(t => (
            <button
              key={t.id}
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
        <AuthButton />
      </header>

      <div className={styles.betaBanner}>
        NBA Showdown 2026 is in beta — cards and collections are still subject to change.
      </div>

      <main className={styles.main}>
        {tutorialMode ? (
          <TutorialGame onExit={() => { setTutorialMode(false); setTab('howtoplay'); }} />
        ) : (
          <>
            {tab === 'cards'   && <CardsTab />}
            {tab === 'strats'  && <StratsTab />}
            {tab === 'howtoplay' && (
              <HowToPlay
                scrollToSection={helpSection}
                onStartTutorial={() => { setTutorialMode(true); }}
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
        <AppInner />
      </LightboxProvider>
      </CardStatsProvider>
    </AuthProvider>
  );
}
