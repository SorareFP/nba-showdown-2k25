import { useState, useMemo } from 'react';
import { CARDS, ALL_TEAMS } from '../game/cards.js';
import PlayerCard from './PlayerCard.jsx';
import { useLightbox } from './CardLightbox.jsx';
import styles from './CardsTab.module.css';

export default function CardsTab() {
  const { open } = useLightbox();
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('ALL');
  const [sort, setSort] = useState('salary-desc');

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let cards = CARDS.filter(c =>
      (team === 'ALL' || c.team === team) &&
      (!q || c.name.toLowerCase().includes(q) || c.team.toLowerCase().includes(q))
    );
    if (sort === 'salary-desc') cards.sort((a, b) => b.salary - a.salary);
    else if (sort === 'salary-asc') cards.sort((a, b) => a.salary - b.salary);
    else if (sort === 'speed') cards.sort((a, b) => b.speed - a.speed);
    else if (sort === 'power') cards.sort((a, b) => b.power - a.power);
    else cards.sort((a, b) => a.name.localeCompare(b.name));
    return cards;
  }, [search, team, sort]);

  return (
    <div>
      <div className={styles.filters}>
        <input
          type="text" placeholder="Search player or team…"
          value={search} onChange={e => setSearch(e.target.value)}
          className={styles.search}
        />
        <select value={team} onChange={e => setTeam(e.target.value)}>
          {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="salary-desc">Salary ↓</option>
          <option value="salary-asc">Salary ↑</option>
          <option value="speed">Speed ↓</option>
          <option value="power">Power ↓</option>
          <option value="name">Name A–Z</option>
        </select>
        <span className={styles.count}>{filtered.length} cards</span>
      </div>

      <div className={styles.grid}>
        {filtered.map(card => <PlayerCard key={card.id} card={card} onClick={() => open('player', card)} />)}
      </div>
    </div>
  );
}
