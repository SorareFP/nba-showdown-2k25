import { useState, useMemo } from 'react';
import { CARDS, CARD_MAP, ALL_TEAMS } from '../game/cards.js';
import { STRATS, STRAT_MAP } from '../game/strats.js';
import { getPlayerRarity, getStratRarity, RARITY_CONFIG, BURN_VALUES, STRAT_BURN_VALUES } from '../game/rarity.js';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import styles from './MyCollection.module.css';

const RARITIES = ['all', 'common', 'uncommon', 'rare', 'super-rare'];
const TYPES = ['all', 'player', 'strat'];

export default function MyCollection({ collection, onBurn }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [confirmBurn, setConfirmBurn] = useState(null);

  const allCards = useMemo(() => {
    const players = CARDS.map(c => ({
      id: c.id, name: c.name, type: 'player', team: c.team,
      rarity: getPlayerRarity(c), salary: c.salary,
      speed: c.speed, power: c.power,
      sub: `${c.team} · S${c.speed} P${c.power} · $${c.salary}`,
      imgUrl: getPlayerImageUrl(c.id),
    }));
    const strats = STRATS.map(s => ({
      id: s.id, name: s.name, type: 'strat', team: null,
      rarity: getStratRarity(s), salary: null,
      sub: `${s.phase} · ${s.side}`,
      color: s.color,
      imgUrl: getStratImagePath(s.id),
    }));
    return [...players, ...strats];
  }, []);

  const filtered = useMemo(() => {
    let list = allCards;
    if (typeFilter !== 'all') list = list.filter(c => c.type === typeFilter);
    if (rarityFilter !== 'all') list = list.filter(c => c.rarity === rarityFilter);
    if (teamFilter !== 'ALL') list = list.filter(c => c.team === teamFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(s));
    }
    // Only show owned cards
    list = list.filter(c => (collection[c.id]?.count || 0) > 0);
    // Sort: players first (SR→common), then strats (rare→common)
    const rarityOrder = { 'super-rare': 0, 'rare': 1, 'uncommon': 2, 'common': 3 };
    list.sort((a, b) => {
      // Players before strats
      if (a.type !== b.type) return a.type === 'player' ? -1 : 1;
      // Within type: best rarity first
      const ra = rarityOrder[a.rarity] ?? 3;
      const rb = rarityOrder[b.rarity] ?? 3;
      if (ra !== rb) return ra - rb;
      // Within same rarity: alphabetical
      return a.name.localeCompare(b.name);
    });
    return list;
  }, [allCards, typeFilter, rarityFilter, teamFilter, search, collection]);

  const ownedCount = filtered.length;

  return (
    <div className={styles.wrap}>
      <div className={styles.statsBar}>
        <span>{ownedCount} cards in collection</span>
      </div>

      <div className={styles.filters}>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={styles.filter}>
          {TYPES.map(t => <option key={t} value={t}>{t === 'all' ? 'All Types' : t === 'player' ? 'Players' : 'Strats'}</option>)}
        </select>
        <select value={rarityFilter} onChange={e => setRarityFilter(e.target.value)} className={styles.filter}>
          {RARITIES.map(r => <option key={r} value={r}>{r === 'all' ? 'All Rarities' : RARITY_CONFIG[r]?.label || r}</option>)}
        </select>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className={styles.filter}>
          {ALL_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          className={styles.search}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.grid}>
        {filtered.map(c => {
          const owned = collection[c.id]?.count || 0;
          const cfg = RARITY_CONFIG[c.rarity];
          const burnVal = c.type === 'strat' ? (STRAT_BURN_VALUES[c.rarity] || 1) : BURN_VALUES[c.rarity];
          return (
            <div
              key={c.id}
              className={`${styles.card} ${owned === 0 ? styles.unowned : ''}`}
              style={{ borderColor: cfg.color }}
            >
              <div className={styles.cardArt}>
                <img
                  src={c.imgUrl}
                  alt={c.name}
                  className={styles.cardArtImg}
                  onError={e => { e.target.parentElement.style.display = 'none'; }}
                />
              </div>
              <div className={styles.rarityBadge} style={{ background: cfg.bg, color: cfg.color }}>
                {cfg.label}
              </div>
              <div className={styles.cardName}>{c.name}</div>
              <div className={styles.cardSub}>{c.sub}</div>
              {owned > 0 && (
                <div className={styles.countBadge}>x{owned}</div>
              )}
              {owned === 0 && (
                <div className={styles.notOwned}>Not Owned</div>
              )}
              {owned > 0 && (
                confirmBurn === c.id ? (
                  <div className={styles.burnConfirm}>
                    <span className={styles.burnAmt}>+{burnVal} coins?</span>
                    <button className={styles.burnYes} onClick={() => { onBurn(c.id, burnVal); setConfirmBurn(null); }}>Yes</button>
                    <button className={styles.burnNo} onClick={() => setConfirmBurn(null)}>No</button>
                  </div>
                ) : (
                  <button className={styles.burnBtn} onClick={() => setConfirmBurn(c.id)}>
                    Burn (+{burnVal})
                  </button>
                )
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className={styles.empty}>No cards match your filters.</div>
      )}
    </div>
  );
}
