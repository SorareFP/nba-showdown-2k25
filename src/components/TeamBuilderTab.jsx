import { useState, useMemo } from 'react';
import { CARDS } from '../game/cards.js';
import PlayerCard from './PlayerCard.jsx';
import styles from './TeamBuilderTab.module.css';

const CAP = 5500;
const MAX = 10;
const capSal = roster => roster.reduce((s, c) => s + c.salary, 0);

function randomizeTeam(other) {
  const available = CARDS.filter(c => !other.find(r => r.id === c.id));
  let best = null, bestScore = Infinity;
  const center = 5100;
  for (let attempt = 0; attempt < 300; attempt++) {
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const roster = []; let sal = 0;
    for (const card of shuffled) {
      if (roster.length >= 10) break;
      if (sal + card.salary > CAP) continue;
      roster.push(card); sal += card.salary;
    }
    if (roster.length === 10 && sal >= 4900 && sal <= 5300) {
      const score = Math.abs(sal - center);
      if (score < bestScore) { best = roster; bestScore = score; }
    }
  }
  if (!best) {
    const shuffled = [...available].sort(() => Math.random() - 0.5);
    const roster = []; let sal = 0;
    for (const card of shuffled) {
      if (roster.length >= 10) break;
      if (sal + card.salary <= CAP) { roster.push(card); sal += card.salary; }
    }
    best = roster;
  }
  return best;
}

export default function TeamBuilderTab({ teamA, setTeamA, teamB, setTeamB, onStartGame }) {
  const [search, setSearch] = useState('');
  const [filterTeam, setFilterTeam] = useState('');
  const [maxSal, setMaxSal] = useState(9999);
  const [sort, setSort] = useState('salary-desc');

  const allTeams = useMemo(() => [...new Set(CARDS.map(c => c.team))].sort(), []);

  const pool = useMemo(() => {
    const inTeam = id => teamA.find(c => c.id === id) || teamB.find(c => c.id === id);
    const q = search.toLowerCase();
    let cards = CARDS.filter(c =>
      !inTeam(c.id) &&
      (!q || c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q)) &&
      (!filterTeam || c.team === filterTeam) &&
      c.salary <= maxSal
    );
    if (sort === 'salary-desc') cards.sort((a, b) => b.salary - a.salary);
    else if (sort === 'salary-asc') cards.sort((a, b) => a.salary - b.salary);
    else if (sort === 'speed') cards.sort((a, b) => b.speed - a.speed);
    else if (sort === 'power') cards.sort((a, b) => b.power - a.power);
    else cards.sort((a, b) => a.name.localeCompare(b.name));
    return cards;
  }, [search, filterTeam, maxSal, sort, teamA, teamB]);

  const addTo = (team, setTeam, card) => {
    if (team.length >= MAX) return alert('Team full (max 10)');
    if (capSal(team) + card.salary > CAP) return alert(`Over salary cap ($${CAP})`);
    if (!team.find(c => c.id === card.id)) setTeam([...team, card]);
  };

  const removeFrom = (team, setTeam, id) => setTeam(team.filter(c => c.id !== id));

  const salA = capSal(teamA), salB = capSal(teamB);
  const canPlay = teamA.length >= 5 && teamB.length >= 5;

  return (
    <div className={styles.wrap}>
      {/* Teams */}
      <div className={styles.teams}>
        <RosterPanel
          name="Team A" color="var(--orange)" sal={salA} roster={teamA}
          onRemove={id => removeFrom(teamA, setTeamA, id)}
          onRandomize={() => setTeamA(randomizeTeam(teamB))}
        />
        <RosterPanel
          name="Team B" color="var(--blue)" sal={salB} roster={teamB}
          onRemove={id => removeFrom(teamB, setTeamB, id)}
          onRandomize={() => setTeamB(randomizeTeam(teamA))}
        />
      </div>

      {canPlay && (
        <div className={styles.startRow}>
          <button className={styles.startBtn} onClick={onStartGame}>
            🏀 Start Game with These Teams
          </button>
          <button className={styles.randBoth} onClick={() => {
            const a = randomizeTeam([]);
            setTeamA(a);
            setTeamB(randomizeTeam(a));
          }}>🎲 Randomize Both</button>
        </div>
      )}

      {/* Pool */}
      <div className={styles.poolHeader}>
        <h3>Player Pool</h3>
        <span className={styles.poolCount}>{pool.length} players</span>
      </div>
      <div className={styles.filters}>
        <input type="text" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 180 }} />
        <select value={filterTeam} onChange={e => setFilterTeam(e.target.value)} style={{ width: 100 }}>
          <option value="">All Teams</option>
          {allTeams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={maxSal} onChange={e => setMaxSal(Number(e.target.value))} style={{ width: 145 }}>
          <option value={9999}>All salaries</option>
          {[1500,1200,1000,800,600,400,200].map(v => (
            <option key={v} value={v}>≤ ${v}</option>
          ))}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)} style={{ width: 130 }}>
          <option value="salary-desc">Salary ↓</option>
          <option value="salary-asc">Salary ↑</option>
          <option value="speed">Speed ↓</option>
          <option value="power">Power ↓</option>
          <option value="name">Name A-Z</option>
        </select>
      </div>
      <div className={styles.pool}>
        {pool.map(card => (
          <PlayerCard key={card.id} card={card} actions={
            <div style={{ display:'flex', gap:6, width:'100%' }}>
              <button className={styles.addA} onClick={() => addTo(teamA, setTeamA, card)}>+ A</button>
              <button className={styles.addB} onClick={() => addTo(teamB, setTeamB, card)}>+ B</button>
            </div>
          } />
        ))}
      </div>
    </div>
  );
}

function RosterPanel({ name, color, sal, roster, onRemove, onRandomize }) {
  const pct = Math.min(100, sal / CAP * 100);
  const over = sal > CAP;
  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <h3 style={{ color }}>{name}</h3>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span className={styles.salInfo} style={{ color: over ? 'var(--red)' : 'var(--text-muted)' }}>
            ${sal}/{CAP} · {roster.length}/{MAX}
          </span>
          <button className={styles.randBtn} style={{ background: color }} onClick={onRandomize}>🎲</button>
        </div>
      </div>
      <div className={styles.capBar}>
        <div className={styles.capFill} style={{ width: pct + '%', background: over ? 'var(--red)' : color }} />
      </div>
      <div className={styles.rosterList}>
        {roster.length === 0 && <div className={styles.empty}>Add players from pool below</div>}
        {roster.map(c => (
          <div key={c.id} className={styles.rosterItem}>
            <div>
              <div className={styles.rosterName}>{c.name}</div>
              <div className={styles.rosterSub}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</div>
            </div>
            <button className={styles.rmBtn} onClick={() => onRemove(c.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
