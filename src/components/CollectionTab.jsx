import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadTeams, deleteTeam, updateTeam } from '../firebase/savedTeams.js';
import { loadDecks, deleteDeck } from '../firebase/savedDecks.js';
import { CARD_MAP } from '../game/cards.js';
import { STRAT_MAP } from '../game/strats.js';
import DeckEditor from './DeckEditor.jsx';
import styles from './CollectionTab.module.css';

export default function CollectionTab({ onLoadTeam }) {
  const { user } = useAuth();
  const [teams, setTeams] = useState([]);
  const [decks, setDecks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [expandedDeck, setExpandedDeck] = useState(null);
  const [editingDeck, setEditingDeck] = useState(null); // null | 'new' | deckObj

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [t, d] = await Promise.all([loadTeams(user.uid), loadDecks(user.uid)]);
    setTeams(t);
    setDecks(d);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleDeleteTeam = async (teamId) => {
    if (!confirm('Delete this team?')) return;
    await deleteTeam(user.uid, teamId);
    refresh();
  };

  const handleDeleteDeck = async (deckId) => {
    if (!confirm('Delete this deck?')) return;
    await deleteDeck(user.uid, deckId);
    refresh();
  };

  const handleDeckSaved = () => {
    setEditingDeck(null);
    refresh();
  };

  const handleLinkDeck = async (teamId, deckId) => {
    await updateTeam(user.uid, teamId, { linkedDeckId: deckId || null });
    refresh();
  };

  const getDeckName = (deckId) => {
    if (!deckId) return null;
    const d = decks.find(dk => dk.id === deckId);
    return d?.name || null;
  };

  if (editingDeck) {
    return (
      <DeckEditor
        deck={editingDeck === 'new' ? null : editingDeck}
        onSave={handleDeckSaved}
        onCancel={() => setEditingDeck(null)}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {/* ── My Teams ── */}
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>My Teams</h2>
        {loading && <div className={styles.loading}>Loading...</div>}
        {!loading && teams.length === 0 && (
          <div className={styles.empty}>No saved teams yet. Build a team and save it from the Team Builder.</div>
        )}
        <div className={styles.list}>
          {teams.map(t => (
            <div key={t.id} className={styles.item}>
              <div className={styles.itemHeader} onClick={() => setExpandedTeam(expandedTeam === t.id ? null : t.id)}>
                <div>
                  <div className={styles.itemName}>{t.name}</div>
                  <div className={styles.itemMeta}>
                    {t.players.length} players · ${t.salary}
                    {getDeckName(t.linkedDeckId) && ` · 🃏 ${getDeckName(t.linkedDeckId)}`}
                    {t.updatedAt?.toDate && ` · ${t.updatedAt.toDate().toLocaleDateString()}`}
                  </div>
                </div>
                <span className={styles.chevron}>{expandedTeam === t.id ? '▾' : '▸'}</span>
              </div>
              {expandedTeam === t.id && (
                <div className={styles.itemBody}>
                  <div className={styles.playerList}>
                    {t.players.map(pid => {
                      const c = CARD_MAP[pid];
                      return c ? (
                        <div key={pid} className={styles.playerRow}>
                          <span>{c.name}</span>
                          <span className={styles.playerMeta}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</span>
                        </div>
                      ) : <div key={pid} className={styles.playerRow}>{pid}</div>;
                    })}
                  </div>
                  {decks.length > 0 && (
                    <div className={styles.linkDeck}>
                      <label className={styles.linkLabel}>Strategy Deck</label>
                      <select
                        className={styles.linkSelect}
                        value={t.linkedDeckId || ''}
                        onChange={e => handleLinkDeck(t.id, e.target.value)}
                      >
                        <option value="">None (use default)</option>
                        {decks.map(d => (
                          <option key={d.id} value={d.id}>{d.name} ({d.totalCards}/50)</option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className={styles.itemActions}>
                    <button className={styles.loadBtn} onClick={() => onLoadTeam(t, 'A')}>Load as Team A</button>
                    <button className={styles.loadBtnB} onClick={() => onLoadTeam(t, 'B')}>Load as Team B</button>
                    <button className={styles.deleteBtn} onClick={() => handleDeleteTeam(t.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── My Decks ── */}
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>My Decks</h2>
          <button className={styles.newBtn} onClick={() => setEditingDeck('new')}>+ New Deck</button>
        </div>
        {loading && <div className={styles.loading}>Loading...</div>}
        {!loading && decks.length === 0 && (
          <div className={styles.empty}>No saved decks yet. Create one to build your strategy card deck.</div>
        )}
        <div className={styles.list}>
          {decks.map(d => (
            <div key={d.id} className={styles.item}>
              <div className={styles.itemHeader} onClick={() => setExpandedDeck(expandedDeck === d.id ? null : d.id)}>
                <div>
                  <div className={styles.itemName}>{d.name}</div>
                  <div className={styles.itemMeta}>
                    {d.totalCards}/50 cards
                    {d.updatedAt?.toDate && ` · ${d.updatedAt.toDate().toLocaleDateString()}`}
                  </div>
                </div>
                <span className={styles.chevron}>{expandedDeck === d.id ? '▾' : '▸'}</span>
              </div>
              {expandedDeck === d.id && (
                <div className={styles.itemBody}>
                  <div className={styles.deckContents}>
                    {Object.entries(d.cards || {}).filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0])).map(([cardId, count]) => {
                      const s = STRAT_MAP[cardId];
                      return (
                        <div key={cardId} className={styles.deckRow}>
                          <span className={styles.deckCardName} style={{ borderLeftColor: s?.color || '#666' }}>
                            {s?.name || cardId}
                          </span>
                          <span className={styles.deckCardCount}>x{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className={styles.itemActions}>
                    <button className={styles.editBtn} onClick={() => setEditingDeck(d)}>Edit</button>
                    <button className={styles.deleteBtn} onClick={() => handleDeleteDeck(d.id)}>Delete</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
