import { useState, useMemo } from 'react';
import { CARDS, CARD_MAP } from '../game/cards.js';
import { getPlayerRarity, RARITY_CONFIG } from '../game/rarity.js';
// Shared with the collection-only editor in My Teams, so the two cannot drift.
import { CAP, MAX, capSal, randomizeTeam, ownedRoster, DEFAULT_FILTERS, filterPool, sortPool } from '../game/teamRules.js';
import PoolFilters from './PoolFilters.jsx';
import PlayerCard from './PlayerCard.jsx';
import { useLightbox } from './CardLightbox.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { saveTeam, loadTeams } from '../firebase/savedTeams.js';
import styles from './TeamBuilderTab.module.css';


export default function TeamBuilderTab({ teamA, setTeamA, teamB, setTeamB, onStartGame, collection }) {
  const { open } = useLightbox();
  const { user } = useAuth();
  const { toast, askText } = useDialogs();
  const enforceOwnership = !!user && Object.keys(collection || {}).length > 0;
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loadModal, setLoadModal] = useState(null); // null | { slot: 'A'|'B', teams: [] }

  const allTeams = useMemo(() => [...new Set(CARDS.map(c => c.team))].sort(), []);

  const handleSave = async (roster) => {
    const name = await askText({
      title: 'Name this team',
      placeholder: 'Bench Mob',
      confirmLabel: 'Save team',
    });
    if (!name) return;
    const sal = capSal(roster);
    await saveTeam(user.uid, { name, players: roster.map(c => c.id), salary: sal });
    toast(`Saved “${name}” — $${sal.toLocaleString()}`, { tone: 'success' });
  };

  const handleLoadOpen = async (slot) => {
    const teams = await loadTeams(user.uid);
    setLoadModal({ slot, teams });
  };

  const handleLoadSelect = (savedTeam) => {
    // Only the cards still owned — see ownedRoster in teamRules.js.
    const { roster: ids, dropped } = ownedRoster(savedTeam.players, enforceOwnership ? collection : null);
    if (dropped.length) {
      toast(`${dropped.length} player${dropped.length === 1 ? ' is' : 's are'} no longer in your collection and ${dropped.length === 1 ? 'was' : 'were'} left out.`);
    }
    const roster = ids.map(id => CARD_MAP[id]).filter(Boolean);
    if (loadModal.slot === 'A') setTeamA(roster);
    else setTeamB(roster);
    setLoadModal(null);
  };

  const pool = useMemo(() => {
    const owned = enforceOwnership ? CARDS.filter(c => (collection[c.id]?.count || 0) > 0) : CARDS;
    return sortPool(filterPool(owned, filters), filters.sort);
  }, [filters, enforceOwnership, collection]);

  const addTo = (team, setTeam, card) => {
    if (team.length >= MAX) return toast(`Team full — ${MAX} players is the roster.`, { tone: 'error' });
    if (capSal(team) + card.salary > CAP) {
      const over = capSal(team) + card.salary - CAP;
      return toast(`${card.name} puts you $${over.toLocaleString()} over the $${CAP.toLocaleString()} cap.`, { tone: 'error' });
    }
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
          onRandomize={() => setTeamA(randomizeTeam(teamB, enforceOwnership, collection))}
          onView={card => open('player', card)}
          showFirebase={!!user}
          onSave={() => handleSave(teamA)}
          onLoad={() => handleLoadOpen('A')}
        />
        <RosterPanel
          name="Team B" color="var(--blue)" sal={salB} roster={teamB}
          onRemove={id => removeFrom(teamB, setTeamB, id)}
          onRandomize={() => setTeamB(randomizeTeam(teamA, enforceOwnership, collection))}
          onView={card => open('player', card)}
          showFirebase={!!user}
          onSave={() => handleSave(teamB)}
          onLoad={() => handleLoadOpen('B')}
        />
      </div>

      {canPlay && (
        <div className={styles.startRow}>
          <button className={styles.startBtn} onClick={onStartGame}>
            🏀 Start Game with These Teams
          </button>
          <button className={styles.randBoth} onClick={() => {
            const a = randomizeTeam([], enforceOwnership, collection);
            setTeamA(a);
            setTeamB(randomizeTeam(a, enforceOwnership, collection));
          }}>🎲 Randomize Both</button>
        </div>
      )}

      {/* Pool */}
      <div className={styles.poolHeader}>
        <h3>Player Pool</h3>
        <span className={styles.poolCount}>{pool.length} players</span>
      </div>
      <PoolFilters value={filters} onChange={setFilters} teams={allTeams} />
      <div className={styles.pool}>
        {pool.map(card => {
          const rarity = getPlayerRarity(card);
          const cfg = RARITY_CONFIG[rarity];
          return (
            <PlayerCard key={card.id} card={card} onClick={() => open('player', card)}
              actions={
                <div style={{ display:'flex', gap:6, width:'100%', flexDirection:'column' }}>
                  {enforceOwnership && (
                    <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, marginBottom:2 }}>
                      <span style={{ color: cfg.color, fontWeight:700 }}>{cfg.label}</span>
                    </div>
                  )}
                  <div style={{ display:'flex', gap:6, width:'100%' }}>
                    <button className={styles.addA} onClick={() => addTo(teamA, setTeamA, card)}>+ A</button>
                    <button className={styles.addB} onClick={() => addTo(teamB, setTeamB, card)}>+ B</button>
                  </div>
                </div>
              }
            />
          );
        })}
      </div>

      {loadModal && (
        <LoadTeamModal
          teams={loadModal.teams}
          onSelect={handleLoadSelect}
          onClose={() => setLoadModal(null)}
        />
      )}
    </div>
  );
}

function RosterPanel({ name, color, sal, roster, onRemove, onRandomize, onView, onSave, onLoad, showFirebase }) {
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
          {showFirebase && roster.length > 0 && (
            <button className={styles.saveBtn} onClick={onSave}>💾</button>
          )}
          {showFirebase && (
            <button className={styles.saveBtn} onClick={onLoad}>📂</button>
          )}
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
              <div className={styles.rosterName}
                style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
                onClick={() => onView(c)}>{c.name}</div>
              <div className={styles.rosterSub}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</div>
            </div>
            <button className={styles.rmBtn} onClick={() => onRemove(c.id)}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function LoadTeamModal({ teams, onSelect, onClose }) {
  return (
    <div className={styles.loadModal} onClick={onClose}>
      <div className={styles.loadModalBox} onClick={e => e.stopPropagation()}>
        <div className={styles.loadModalTitle}>Load Saved Team</div>
        {teams.length === 0 && <div style={{ color: 'var(--text-dim)', fontSize: 13, fontStyle: 'italic', padding: '1rem', textAlign: 'center' }}>No saved teams yet</div>}
        <div className={styles.loadModalList}>
          {teams.map(t => (
            <button key={t.id} className={styles.loadModalItem} onClick={() => onSelect(t)}>
              <div className={styles.loadModalName}>{t.name}</div>
              <div className={styles.loadModalMeta}>{t.players.length} players · ${t.salary}</div>
            </button>
          ))}
        </div>
        <button className={styles.loadModalCancel} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
