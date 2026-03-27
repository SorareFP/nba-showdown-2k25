import { useState, useMemo } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { saveDeck, updateDeck, validateDeck } from '../firebase/savedDecks.js';
import { STRATS } from '../game/strats.js';
import { getStratImagePath } from '../game/cardImages.js';
import styles from './DeckEditor.module.css';

const PHASE_ORDER = ['matchup', 'pre_roll', 'scoring', 'post_roll', 'reaction'];
const PHASE_LABELS = {
  matchup: 'Matchup Phase',
  pre_roll: 'Pre-Roll',
  scoring: 'Scoring Phase',
  post_roll: 'Post-Roll',
  reaction: 'Reaction',
};

export default function DeckEditor({ deck, onSave, onCancel }) {
  const { user } = useAuth();
  const [name, setName] = useState(deck?.name || '');
  const [cards, setCards] = useState(() => {
    if (deck?.cards) return { ...deck.cards };
    return {};
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const total = useMemo(() => Object.values(cards).reduce((s, n) => s + n, 0), [cards]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const phase of PHASE_ORDER) groups[phase] = [];
    for (const s of STRATS) {
      const p = PHASE_ORDER.includes(s.phase) ? s.phase : 'reaction';
      groups[p].push(s);
    }
    return groups;
  }, []);

  const setCount = (cardId, delta) => {
    setCards(prev => {
      const cur = prev[cardId] || 0;
      const next = Math.max(0, Math.min(8, cur + delta));
      const newTotal = total - cur + next;
      if (newTotal > 50) return prev;
      const updated = { ...prev };
      if (next === 0) delete updated[cardId];
      else updated[cardId] = next;
      return updated;
    });
  };

  const handleSave = async () => {
    if (!name.trim()) { setError('Enter a deck name'); return; }
    const filtered = Object.fromEntries(Object.entries(cards).filter(([, n]) => n > 0));
    const { ok, msg } = validateDeck(filtered);
    if (!ok) { setError(msg); return; }

    setSaving(true);
    setError('');
    try {
      if (deck?.id) {
        await updateDeck(user.uid, deck.id, { name: name.trim(), cards: filtered });
      } else {
        await saveDeck(user.uid, { name: name.trim(), cards: filtered });
      }
      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={onCancel}>← Back</button>
        <h2 className={styles.title}>{deck?.id ? 'Edit Deck' : 'New Deck'}</h2>
      </div>

      <div className={styles.layout}>
        {/* Card list */}
        <div className={styles.cardList}>
          {PHASE_ORDER.map(phase => (
            <div key={phase} className={styles.phaseGroup}>
              <div className={styles.phaseLabel}>{PHASE_LABELS[phase]}</div>
              {grouped[phase].map(s => {
                const count = cards[s.id] || 0;
                const imgPath = getStratImagePath(s.id);
                return (
                  <div key={s.id} className={`${styles.cardRow} ${count > 0 ? styles.cardActive : ''}`}>
                    {imgPath && <img src={imgPath} alt="" className={styles.cardThumb} />}
                    <div className={styles.cardInfo}>
                      <div className={styles.cardName} style={{ color: s.color }}>{s.name}</div>
                      <div className={styles.cardDesc}>{s.desc}</div>
                      <div className={styles.cardTags}>
                        <span className={styles.sideTag}>{s.side === 'off' ? 'OFF' : 'DEF'}</span>
                        {s.locked && <span className={styles.lockTag}>Uncancelable</span>}
                      </div>
                    </div>
                    <div className={styles.qty}>
                      <button className={styles.qtyBtn} onClick={() => setCount(s.id, -1)} disabled={count === 0}>−</button>
                      <span className={styles.qtyVal}>{count}</span>
                      <button className={styles.qtyBtn} onClick={() => setCount(s.id, 1)} disabled={count >= 8 || total >= 50}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* Sidebar summary */}
        <div className={styles.sidebar}>
          <div className={styles.sidebarSticky}>
            <div className={styles.nameField}>
              <label className={styles.fieldLabel}>Deck Name</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="My Deck"
                className={styles.nameInput}
              />
            </div>

            <div className={styles.totalBar}>
              <div className={styles.totalLabel}>Cards</div>
              <div className={styles.totalNum}>
                <span className={total > 50 ? styles.totalOver : ''}>{total}</span>/50
              </div>
              <div className={styles.totalTrack}>
                <div
                  className={styles.totalFill}
                  style={{
                    width: `${Math.min(100, (total / 50) * 100)}%`,
                    background: total > 50 ? 'var(--red)' : total >= 45 ? 'var(--gold)' : 'var(--green)',
                  }}
                />
              </div>
            </div>

            <div className={styles.deckSummary}>
              {Object.entries(cards).filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0])).map(([cardId, count]) => {
                const s = STRATS.find(st => st.id === cardId);
                return (
                  <div key={cardId} className={styles.summaryRow}>
                    <span style={{ color: s?.color }}>{s?.name || cardId}</span>
                    <span className={styles.summaryCount}>x{count}</span>
                  </div>
                );
              })}
              {total === 0 && <div className={styles.summaryEmpty}>Add cards from the list</div>}
            </div>

            {error && <div className={styles.error}>{error}</div>}

            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : deck?.id ? 'Update Deck' : 'Save Deck'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
