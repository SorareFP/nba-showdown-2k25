import { useState } from 'react';
import CardsTab from './components/CardsTab.jsx';
import StratsTab from './components/StratsTab.jsx';
import TeamBuilderTab from './components/TeamBuilderTab.jsx';
import PlayTab from './components/PlayTab.jsx';
import styles from './App.module.css';

const TABS = [
  { id: 'cards',   label: '📋 Cards' },
  { id: 'strats',  label: '🃏 Strategy Cards' },
  { id: 'builder', label: '🏗 Team Builder' },
  { id: 'play',    label: '🏀 Play' },
];

export default function App() {
  const [tab, setTab] = useState('cards');
  const [teamA, setTeamA] = useState([]);
  const [teamB, setTeamB] = useState([]);

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
          {TABS.map(t => (
            <button
              key={t.id}
              className={`${styles.navBtn} ${tab === t.id ? styles.active : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className={styles.main}>
        {tab === 'cards'   && <CardsTab />}
        {tab === 'strats'  && <StratsTab />}
        {tab === 'builder' && (
          <TeamBuilderTab
            teamA={teamA} setTeamA={setTeamA}
            teamB={teamB} setTeamB={setTeamB}
            onStartGame={() => setTab('play')}
          />
        )}
        {tab === 'play' && (
          <PlayTab teamA={teamA} teamB={teamB} />
        )}
      </main>
    </div>
  );
}
