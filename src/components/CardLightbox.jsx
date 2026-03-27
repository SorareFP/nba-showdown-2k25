import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import styles from './CardLightbox.module.css';

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
  const imgSrc = type === 'player'
    ? getPlayerImageUrl(data.id)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>{'\u00D7'}</button>

        <div className={styles.content}>
          {/* Left: image */}
          <div className={styles.imgSide}>
            {imgSrc
              ? <img src={imgSrc} alt={data.name || data.n} className={styles.img}
                  onError={e => { e.target.style.display = 'none'; }} />
              : <div className={styles.placeholder}>{data.name || data.n}</div>}
            {imgSrc && (
              <button className={styles.zoomBtn} onClick={onFullRes} title="Full resolution">
                {'\uD83D\uDD0D'}
              </button>
            )}
          </div>

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
    ? getPlayerImageUrl(data.id)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <img src={imgSrc} alt={data.name || data.n} className={styles.fullResImg}
        onClick={e => e.stopPropagation()} />
      <button className={styles.closeBtnFull} onClick={onClose}>{'\u00D7'}</button>
    </div>
  );
}

function PlayerStats({ card }) {
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
