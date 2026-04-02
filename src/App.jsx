import { useState, useRef, useEffect, useCallback } from 'react';
import CardsTab from './components/CardsTab.jsx';
import StratsTab from './components/StratsTab.jsx';
import TeamBuilderTab from './components/TeamBuilderTab.jsx';
import PlayTab from './components/PlayTab.jsx';
import HowToPlay from './components/HowToPlay.jsx';
import CollectionTab from './components/CollectionTab.jsx';
import PvpLobby from './components/PvpLobby.jsx';
import PvpGame from './components/PvpGame.jsx';
import TutorialGame from './components/TutorialGame.jsx';
import AuthButton from './components/AuthButton.jsx';
import { AuthProvider, useAuth } from './firebase/AuthProvider.jsx';
import { LightboxProvider } from './components/CardLightbox.jsx';
import { loadCollection } from './firebase/collection.js';
import { CARD_MAP } from './game/cards.js';
import styles from './App.module.css';

// Tabs visible to logged-out users (full card browser)
const GUEST_TABS = [
  { id: 'cards',   label: '📋 Cards' },
  { id: 'strats',  label: '🃏 Strategy Cards' },
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
  { id: 'howtoplay', label: '📖 How to Play' },
];
// Tabs visible to logged-in users (cards/strats hidden to preserve pack surprise)
const AUTH_TABS = [
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
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
    const roster = savedTeam.players.map(id => CARD_MAP[id]).filter(Boolean);
    if (slot === 'A') setTeamA(roster);
    else setTeamB(roster);
    setTab('builder');
  };

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <img src="/nba-showdown-2k25/logo.png" alt="NBA Showdown 2K25" className={styles.logoImg} />
          <div>
            <div className={styles.logoTitle}>NBA Showdown 2K25</div>
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
            </button>
          ))}
        </nav>
        <AuthButton />
      </header>

      <div className={styles.betaBanner}>
        NBA Showdown 2K25 is in beta. Your card collection and coins may be reset in the near future.
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
            {tab === 'pvp' && !pvpGame && (
              <PvpLobby onGameStart={(roomCode, myRole) => setPvpGame({ roomCode, myRole })} />
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
                <PlayTab teamA={teamA} teamB={teamB} />
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
      <LightboxProvider>
        <AppInner />
      </LightboxProvider>
    </AuthProvider>
  );
}
