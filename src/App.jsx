import { useState, useRef } from 'react';
import CardsTab from './components/CardsTab.jsx';
import StratsTab from './components/StratsTab.jsx';
import TeamBuilderTab from './components/TeamBuilderTab.jsx';
import PlayTab from './components/PlayTab.jsx';
import RulebookTab from './components/RulebookTab.jsx';
import CollectionTab from './components/CollectionTab.jsx';
import AuthButton from './components/AuthButton.jsx';
import { AuthProvider, useAuth } from './firebase/AuthProvider.jsx';
import { LightboxProvider } from './components/CardLightbox.jsx';
import { CARD_MAP } from './game/cards.js';
import styles from './App.module.css';

const BASE_TABS = [
  { id: 'cards',   label: '📋 Cards' },
  { id: 'strats',  label: '🃏 Strategy Cards' },
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
  { id: 'rules',   label: '📖 Rulebook' },
];

function AppInner() {
  const { user } = useAuth();
  const [tab, setTab] = useState('cards');
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);
  const playMounted = useRef(false);
  if (tab === 'play') playMounted.current = true;

  const tabs = user
    ? [...BASE_TABS, { id: 'collection', label: '💾 Collection' }]
    : BASE_TABS;

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
          <span className={styles.logoIcon}>🏀</span>
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

      <main className={styles.main}>
        {tab === 'cards'   && <CardsTab />}
        {tab === 'strats'  && <StratsTab />}
        {tab === 'rules'   && <RulebookTab />}
        {tab === 'builder' && (
          <TeamBuilderTab
            teamA={teamA} setTeamA={setTeamA}
            teamB={teamB} setTeamB={setTeamB}
            onStartGame={() => setTab('play')}
          />
        )}
        {tab === 'collection' && <CollectionTab onLoadTeam={handleLoadTeam} />}
        {playMounted.current && (
          <div style={{ display: tab === 'play' ? 'block' : 'none' }}>
            <PlayTab teamA={teamA} teamB={teamB} />
          </div>
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
