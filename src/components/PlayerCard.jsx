import styles from './PlayerCard.module.css';

export default function PlayerCard({ card, compact = false, actions, highlighted = false }) {
  const hasBoosts = card.paintBoost || card.threePtBoost || card.defBoost;

  return (
    <div className={`${styles.card} ${compact ? styles.compact : ''} ${highlighted ? styles.highlighted : ''}`}>
      <div className={styles.header}>
        <div>
          <div className={styles.name}>{card.name}</div>
          <div className={styles.team}>{card.team === 'RTR' ? '🏆 Retro' : card.team}</div>
        </div>
        <span className={styles.salary}>${card.salary}</span>
      </div>

      <div className={styles.stats}>
        <Stat label="SPD" value={card.speed} />
        <Stat label="PWR" value={card.power} />
        <Stat label="LINE" value={card.shotLine} />
      </div>

      {hasBoosts && !compact && (
        <div className={styles.boosts}>
          {card.paintBoost  !== 0 && <Boost label="Paint"  val={card.paintBoost}  cls="paint" />}
          {card.threePtBoost !== 0 && <Boost label="3PT"   val={card.threePtBoost} cls="three" />}
          {card.defBoost    !== 0 && <Boost label="Def"   val={card.defBoost}    cls={card.defBoost > 0 ? 'defPos' : 'defNeg'} />}
        </div>
      )}

      {!compact && (
        <div className={styles.chart}>
          {card.chart.map((t, i) => (
            <div key={i} className={styles.chartRow}>
              <span className={styles.range}>
                {t.hi >= 99 ? `${t.lo}+` : t.lo === t.hi ? t.lo : `${t.lo}–${t.hi}`}
              </span>
              <span className={styles.result}>{t.pts}p {t.reb}r {t.ast}a</span>
            </div>
          ))}
        </div>
      )}

      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{value}</span>
    </div>
  );
}

function Boost({ label, val, cls }) {
  return (
    <span className={`${styles.boost} ${styles[cls]}`}>
      {label}{val > 0 ? '+' : ''}{val}
    </span>
  );
}
