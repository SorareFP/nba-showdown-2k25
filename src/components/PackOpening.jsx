import { useState, useMemo, useCallback } from 'react';
import { CARD_MAP } from '../game/cards.js';
import { STRAT_MAP } from '../game/strats.js';
import { getPlayerRarity, getStratRarity, RARITY_CONFIG } from '../game/rarity.js';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import styles from './PackOpening.module.css';

export default function PackOpening({ cards, onDone }) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const [transitioning, setTransitioning] = useState(false);
  const [saving, setSaving] = useState(false);

  const enriched = useMemo(() => {
    const list = cards.map((c, i) => {
      if (c.type === 'player') {
        const card = CARD_MAP[c.id];
        const rarity = card ? getPlayerRarity(card) : 'common';
        return {
          ...c, idx: i, card, rarity,
          name: card?.name || c.id,
          imgUrl: getPlayerImageUrl(c.id),
        };
      }
      const strat = STRAT_MAP[c.id];
      const rarity = strat ? getStratRarity(strat) : 'common';
      return {
        ...c, idx: i, card: strat, rarity,
        name: strat?.name || c.id,
        imgUrl: getStratImagePath(c.id),
      };
    });
    // Commons first so rares come later (suspense)
    const order = { 'common': 0, 'uncommon': 1, 'rare': 2, 'super-rare': 3 };
    list.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'strat' ? -1 : 1;
      return (order[a.rarity] || 0) - (order[b.rarity] || 0);
    });
    return list;
  }, [cards]);

  const totalCards = enriched.length;
  const allDone = dismissed.length === totalCards;
  const currentCard = enriched[current];

  const handleClick = useCallback(() => {
    if (allDone || transitioning) return;
    if (!flipped) {
      setFlipped(true);
      // 👑 LEBROOOOON JAMES
      if (currentCard && (currentCard.id === 'LeBron_James' || currentCard.id === '08_09_LeBron_James')) {
        try { new Audio('/nba-showdown-2k25/lebron.mp3').play(); } catch (_) {}
      }
    } else {
      // Dismiss: hide current card first, THEN advance after delay
      setTransitioning(true);
      setFlipped(false); // flip back to hide
      setTimeout(() => {
        setDismissed(prev => [...prev, current]);
        setCurrent(prev => prev + 1);
        setTransitioning(false);
      }, 350); // wait for flip-back animation
    }
  }, [allDone, transitioning, flipped, current]);

  const handleSkipAll = () => {
    setDismissed(enriched.map((_, i) => i));
    setCurrent(totalCards);
    setFlipped(false);
    setTransitioning(false);
  };

  const handleDone = async () => {
    if (saving) return;
    setSaving(true);
    await onDone();
  };

  const remaining = enriched.filter((_, i) => i > current && !dismissed.includes(i));
  const peekCount = Math.min(remaining.length, 3);

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h2 className={styles.title}>Pack Opening</h2>
        <div className={styles.counter}>{dismissed.length}/{totalCards}</div>
      </div>

      {/* Card stack area */}
      {!allDone && (
        <div className={styles.stackArea} onClick={handleClick}>
          {/* Peek cards behind */}
          {[...Array(peekCount)].map((_, pi) => (
            <div
              key={`peek-${pi}`}
              className={styles.peekCard}
              style={{
                transform: `translateX(${(pi + 1) * 6}px) translateY(${(pi + 1) * 4}px) scale(${1 - (pi + 1) * 0.02})`,
                zIndex: 10 - pi - 1,
              }}
            >
              <div className={styles.cardBackFace}>
                <img src="/nba-showdown-2k25/card-back.png" alt="Card back" className={styles.cardBackImg} />
              </div>
            </div>
          ))}

          {/* Current card — key forces fresh DOM per card so onError doesn't persist */}
          {currentCard && (
            <div
              key={currentCard.idx}
              className={`${styles.mainCard} ${flipped ? styles.mainFlipped : ''}`}
              style={{ zIndex: 10 }}
            >
              <div className={styles.mainInner}>
                <div className={styles.mainBack}>
                  <img src="/nba-showdown-2k25/card-back.png" alt="Card back" className={styles.cardBackImg} />
                  <div className={styles.backHint}>Tap to reveal</div>
                </div>
                <div className={`${styles.mainFront} ${styles[`front_${currentCard.rarity.replace('-','_')}`]}`}>
                  <img
                    src={currentCard.imgUrl}
                    alt={currentCard.name}
                    className={styles.faceImg}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                </div>
              </div>
              {flipped && <SparkEffect rarity={currentCard.rarity} />}
            </div>
          )}
        </div>
      )}

      {/* Tap hint */}
      {!allDone && (
        <div className={styles.tapHint}>
          {flipped ? 'Tap to continue' : 'Tap to reveal'}
        </div>
      )}

      {/* Actions */}
      <div className={styles.actions}>
        {!allDone && (
          <button className={styles.skipBtn} onClick={handleSkipAll}>
            Skip All ({totalCards - dismissed.length} remaining)
          </button>
        )}
        {allDone && (
          <button className={styles.doneBtn} onClick={handleDone} disabled={saving}>
            {saving ? 'Saving...' : 'Add to Collection'}
          </button>
        )}
      </div>

      {/* Dismissed cards below */}
      {dismissed.length > 0 && (
        <div className={styles.dismissedStrip}>
          {dismissed.map(di => {
            const c = enriched[di];
            const cfg = RARITY_CONFIG[c.rarity];
            return (
              <div key={di} className={styles.miniCard} style={{ borderColor: cfg.color }}>
                <img
                  src={c.imgUrl}
                  alt={c.name}
                  className={styles.miniImg}
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div className={styles.miniName}>{c.name}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SparkEffect({ rarity }) {
  const counts = { 'common': 6, 'uncommon': 10, 'rare': 16, 'super-rare': 24 };
  const colors = {
    'common': '#94A3B8',
    'uncommon': '#4ADE80',
    'rare': '#60A5FA',
    'super-rare': '#F59E0B',
  };
  const n = counts[rarity] || 6;
  const color = colors[rarity] || '#94A3B8';

  return (
    <div className={styles.sparks}>
      {[...Array(n)].map((_, i) => {
        const angle = ((360 / n) * i + (Math.random() * 20 - 10)) * (Math.PI / 180);
        const dist = 60 + Math.random() * 80;
        const tx = Math.cos(angle) * dist;
        const ty = Math.sin(angle) * dist;
        const size = rarity === 'super-rare' ? 4 + Math.random() * 4 : 2 + Math.random() * 3;
        const delay = Math.random() * 0.15;
        return (
          <span
            key={i}
            className={styles.spark}
            style={{
              '--tx': `${tx}px`,
              '--ty': `${ty}px`,
              '--size': `${size}px`,
              '--color': color,
              '--delay': `${delay}s`,
            }}
          />
        );
      })}
    </div>
  );
}
