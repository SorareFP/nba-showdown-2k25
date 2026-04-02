import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadTeams, deleteTeam, updateTeam } from '../firebase/savedTeams.js';
import { loadDecks, deleteDeck } from '../firebase/savedDecks.js';
import { loadCollection, addCardsToCollection, burnCard, getUserData, updateUserFields } from '../firebase/collection.js';
import { collection as fbCollection, getDocs, writeBatch, doc } from 'firebase/firestore';
import { db } from '../firebase/config.js';
import { CARD_MAP } from '../game/cards.js';
import { STRAT_MAP } from '../game/strats.js';
import { generatePack, PACK_TYPES } from '../game/packEngine.js';
import DeckEditor from './DeckEditor.jsx';
import PackShop from './PackShop.jsx';
import PackOpening from './PackOpening.jsx';
import MyCollection from './MyCollection.jsx';
import styles from './CollectionTab.module.css';

const VIEWS = [
  { key: 'teams', label: 'My Teams' },
  { key: 'decks', label: 'My Decks' },
  { key: 'collection', label: 'My Collection' },
  { key: 'shop', label: 'Pack Shop' },
];

export default function CollectionTab({ onLoadTeam, onCollectionChange }) {
  const { user } = useAuth();
  const [view, setView] = useState('teams');
  const [teams, setTeams] = useState([]);
  const [decks, setDecks] = useState([]);
  const [collection, setCollection] = useState({});
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [expandedDeck, setExpandedDeck] = useState(null);
  const [editingDeck, setEditingDeck] = useState(null);
  const [openingPack, setOpeningPack] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [t, d, c, u] = await Promise.all([
      loadTeams(user.uid),
      loadDecks(user.uid),
      loadCollection(user.uid),
      getUserData(user.uid),
    ]);
    setTeams(t);
    setDecks(d);
    setCollection(c);
    setUserData(u);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Show starter pack prompt if not opened
  const showStarterPrompt = userData && userData.starterPackOpened === false;

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

  const handleBuyPack = (packType, options) => {
    const cards = generatePack(packType, options);
    setOpeningPack({ cards, packType, options });
  };

  const handleOpenStarter = () => {
    const cards = generatePack('starter');
    setOpeningPack({ cards, packType: 'starter', options: {} });
  };

  const handlePackDone = async () => {
    if (!openingPack) return;
    // Grab and clear immediately to prevent double-saves
    const pack = openingPack;
    setOpeningPack(null);
    try {
      const { cards, packType } = pack;
      const cost = PACK_TYPES[packType].price;
      await addCardsToCollection(user.uid, cards, packType, cost);
      if (packType === 'starter') {
        await updateUserFields(user.uid, { starterPackOpened: true });
      }
      setView('collection');
      refresh();
      onCollectionChange?.();
    } catch (e) {
      console.error('Pack save error:', e);
      alert('Error saving pack: ' + e.message);
    }
  };

  const handleBurn = async (cardId, burnValue) => {
    await burnCard(user.uid, cardId, burnValue);
    refresh();
    onCollectionChange?.();
  };

  // DEV: Reset account for testing
  const handleResetAccount = async () => {
    if (!confirm('DEV: Reset your collection, currency, and starter pack status? This cannot be undone.')) return;
    // Delete all collection docs
    const collSnap = await getDocs(fbCollection(db, 'users', user.uid, 'collection'));
    const histSnap = await getDocs(fbCollection(db, 'users', user.uid, 'packHistory'));
    const batch = writeBatch(db);
    collSnap.forEach(d => batch.delete(d.ref));
    histSnap.forEach(d => batch.delete(d.ref));
    batch.update(doc(db, 'users', user.uid), {
      currency: 0,
      starterPackOpened: false,
      dailyMilestoneCoins: 0,
      dailyMilestoneDate: '',
      dailyFirstWin: false,
    });
    await batch.commit();
    refresh();
    onCollectionChange?.();
    alert('Account reset! Refresh the page to see the starter pack prompt.');
  };

  // Pack opening screen takes over
  if (openingPack) {
    return (
      <PackOpening
        cards={openingPack.cards}
        onDone={handlePackDone}
      />
    );
  }

  if (editingDeck) {
    return (
      <DeckEditor
        deck={editingDeck === 'new' ? null : editingDeck}
        onSave={handleDeckSaved}
        onCancel={() => setEditingDeck(null)}
        collection={collection}
      />
    );
  }

  return (
    <div className={styles.wrap}>
      {/* Starter pack banner */}
      {showStarterPrompt && (
        <div className={styles.starterBanner}>
          <div className={styles.starterText}>Welcome! Open your Starter Pack to begin collecting.</div>
          <button className={styles.starterBtn} onClick={handleOpenStarter}>
            Open Starter Pack
          </button>
        </div>
      )}

      {/* Sub-navigation */}
      <div className={styles.subNav}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            className={`${styles.subNavBtn} ${view === v.key ? styles.subNavActive : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
        {userData && (
          <div className={styles.navBalance}>
            <span className={styles.coinIcon}>$</span>{userData.currency ?? 0} coins
          </div>
        )}
      </div>

      {/* ── My Teams ── */}
      {view === 'teams' && (
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
      )}

      {/* ── My Decks ── */}
      {view === 'decks' && (
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
      )}

      {/* ── My Collection ── */}
      {view === 'collection' && (
        <MyCollection collection={collection} onBurn={handleBurn} />
      )}

      {/* ── Pack Shop ── */}
      {view === 'shop' && (
        <PackShop currency={userData?.currency ?? 0} onBuyPack={handleBuyPack} />
      )}

      {/* DEV: Reset button — localhost or admin only */}
      {(window.location.hostname === 'localhost' || user?.email === 'hoopsonhoops@gmail.com') && (
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleResetAccount}
            style={{ background: 'none', color: 'var(--red)', fontSize: 11, padding: '4px 10px', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4 }}
          >
            DEV: Reset Collection &amp; Currency
          </button>
        </div>
      )}
    </div>
  );
}
