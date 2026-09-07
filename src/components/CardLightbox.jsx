import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import { cardKey } from '../game/cardSets.js';
import { useCardStats } from '../firebase/CardStatsProvider.jsx';
import { getPlayerRarity } from '../game/rarity.js';
import Holo from './HoloSheen.jsx';
import styles from './CardLightbox.module.css';

// The legendary tier wears a holographic sheen wherever its face is drawn.
const isLegendary = (type, data) => type === 'player' && getPlayerRarity(data) === 'legendary';

const LightboxCtx = createContext(null);

export function useLightbox() {
  return useContext(LightboxCtx);
}

export function LightboxProvider({ children }) {
  const [item, setItem] = useState(null);      // { type:'player'|'strat', data:{...} }
  const [fullRes, setFullRes] = useState(false); // magnifying-glass mode

  const open = useCallback((type, data) => { setItem({ type, data }); setFullRes(false); }, []);
  const close = useCallback(() => { setItem(null); setFullRes(false); }, []);

  useEffect(() => {
    if (!item) return;
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  return (
    <LightboxCtx.Provider value={{ open, close }}>
      {children}
      {item && (fullRes
        ? <FullResOverlay item={item} onClose={() => setFullRes(false)} />
        : <LightboxModal item={item} onClose={close} onFullRes={() => setFullRes(true)} />
      )}
    </LightboxCtx.Provider>
  );
}

function LightboxModal({ item, onClose, onFullRes }) {
  const { type, data } = item;
  // THE SET GOES WITH THE ID. A card object's `id` is the bare player id even
  // for a special set — the set lives in `card.set` — and by id alone the
  // lookup lands on the BASE set's face. So a Super Season or WNBA card showed
  // the 2026-27 picture beside its own numbers: "some players mismatch".
  const imgSrc = type === 'player'
    ? getPlayerImageUrl(data.id, data.set)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>{'\u00D7'}</button>

        <div className={styles.content}>
          {/* Left: image */}
          <Holo className={styles.imgSide} active={!!imgSrc && isLegendary(type, data)}>
            {imgSrc
              ? <img src={imgSrc} alt={data.name || data.n} className={styles.img}
                  onError={e => { e.target.style.display = 'none'; }} />
              : <div className={styles.placeholder}>{data.name || data.n}</div>}
            {imgSrc && (
              <button className={styles.zoomBtn} onClick={onFullRes} title="Full resolution">
                {'\uD83D\uDD0D'}
              </button>
            )}
          </Holo>

          {/* Right: stats */}
          <div className={styles.statsSide}>
            {type === 'player' ? <PlayerStats card={data} /> : <StratStats card={data} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullResOverlay({ item, onClose }) {
  const { type, data } = item;
  const imgSrc = type === 'player'
    ? getPlayerImageUrl(data.id, data.set)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <Holo as="span" className={styles.fullResHolo} active={isLegendary(type, data)} onClick={e => e.stopPropagation()}>
        <img src={imgSrc} alt={data.name || data.n} className={styles.fullResImg} />
      </Holo>
      <button className={styles.closeBtnFull} onClick={onClose}>{'\u00D7'}</button>
    </div>
  );
}

/** The player's lifetime line with this card — games, record, averages, totals. */
export function careerLine(rec) {
  const g = rec?.games || 0;
  if (!g) return null;
  const wins = rec.wins || 0;
  const avg = v => ((v || 0) / g).toFixed(1);
  return {
    games: g,
    record: `${wins}–${g - wins}`,
    averages: `${avg(rec.pts)} pts · ${avg(rec.reb)} reb · ${avg(rec.ast)} ast`,
    totals: `${rec.pts || 0} pts · ${rec.reb || 0} reb · ${rec.ast || 0} ast · ${rec.tpm || 0}/${rec.tpa || 0} 3PT`,
  };
}

function CareerBlock({ rec }) {
  const line = careerLine(rec);
  if (!line) return null;
  return (
    <div className={styles.lbCareer}>
      <div className={styles.lbChartHeader}>Your record with this card</div>
      <div className={styles.lbCareerRow}><span>{line.games} {line.games === 1 ? 'game' : 'games'} · {line.record}</span><span>{line.averages}</span></div>
      <div className={styles.lbCareerRow}><span>Totals</span><span>{line.totals}</span></div>
    </div>
  );
}

function PlayerStats({ card }) {
  const { stats } = useCardStats();
  const rec = stats?.[cardKey(card)];
  const boosts = [
    card.threePtBoost !== 0 && `3PT ${card.threePtBoost > 0 ? '+' : ''}${card.threePtBoost}`,
    card.paintBoost !== 0 && `Paint ${card.paintBoost > 0 ? '+' : ''}${card.paintBoost}`,
    card.defBoost !== 0 && `Def ${card.defBoost > 0 ? '+' : ''}${card.defBoost}`,
  ].filter(Boolean);

  return (
    <>
      <h2 className={styles.lbName}>{card.name}</h2>
      <div className={styles.lbTeam}>{card.team === 'RTR' ? 'Retro' : card.team} · ${card.salary}</div>
      <div className={styles.lbStats}>
        <div className={styles.lbStat}><span>SPD</span><strong>{card.speed}</strong></div>
        <div className={styles.lbStat}><span>PWR</span><strong>{card.power}</strong></div>
        <div className={styles.lbStat}><span>LINE</span><strong>{card.shotLine}</strong></div>
      </div>
      {boosts.length > 0 && <div className={styles.lbBoosts}>{boosts.join(' · ')}</div>}
      <CareerBlock rec={rec} />
      <div className={styles.lbChart}>
        <div className={styles.lbChartHeader}>Scoring Chart</div>
        {card.chart.map((t, i) => (
          <div key={i} className={styles.lbChartRow}>
            <span className={styles.lbRange}>{t.hi >= 99 ? `${t.lo}+` : t.lo === t.hi ? t.lo : `${t.lo}\u2013${t.hi}`}</span>
            <span>{t.pts}pts {t.reb}reb {t.ast}ast</span>
          </div>
        ))}
      </div>
    </>
  );
}

const PHASE_LABELS = {
  matchup: 'Matchup Phase', pre_roll: 'Pre-Roll',
  scoring: 'Scoring Phase', post_roll: 'Post-Roll',
  reaction: 'Reaction',
};

function StratStats({ card }) {
  return (
    <>
      <h2 className={styles.lbName}>{card.name}</h2>
      <div className={styles.lbTags}>
        <span className={card.side === 'off' ? styles.lbOff : styles.lbDef}>
          {card.side === 'off' ? 'Offense' : 'Defense'}
        </span>
        <span className={styles.lbPhase}>{PHASE_LABELS[card.phase] || card.phase}</span>
        {card.locked && <span className={styles.lbLock}>Uncancelable</span>}
        <span className={styles.lbCopies}>{'\u00D7'}{card.copies}</span>
      </div>
      <p className={styles.lbDesc}>{card.desc}</p>
    </>
  );
}
