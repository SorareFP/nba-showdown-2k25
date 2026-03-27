import styles from './Scoreboard.module.css';

export default function Scoreboard({ game }) {
  const { teamA: ga, teamB: gb, quarter, section, phase } = game;
  const phaseLabel = { draft:'Matchup Draft', matchup_strats:'Strategy Phase', scoring:'Scoring Phase' }[phase] || phase;
  const rebDiff = ga.rebounds - gb.rebounds;

  return (
    <div className={styles.board}>
      <TeamScore team={ga} color="var(--orange)" side="left" />
      <div className={styles.center}>
        <div className={styles.badge}>Q{quarter} · Sec {section}/3</div>
        <div className={styles.phase}>{phaseLabel}</div>
        <div className={styles.tracks}>
          <Track label="AST" val={ga.assists} col="var(--orange)" />
          <ReboundDiff diff={rebDiff} aReb={ga.rebounds} bReb={gb.rebounds} />
          <Track label="AST" val={gb.assists} col="var(--blue)" />
        </div>
      </div>
      <TeamScore team={gb} color="var(--blue)" side="right" />
    </div>
  );
}

function TeamScore({ team, color, side }) {
  return (
    <div className={`${styles.team} ${side === 'right' ? styles.right : ''}`}>
      <div className={styles.teamName} style={{ color }}>{team.name}</div>
      <div className={styles.score}>{team.score}</div>
      <div className={styles.meta}>{team.hand.length} cards</div>
    </div>
  );
}

function Track({ label, val, col }) {
  return (
    <div className={styles.track}>
      <div className={styles.trackVal} style={{ color: col }}>{val}</div>
      <div className={styles.trackLabel}>{label}</div>
    </div>
  );
}

function ReboundDiff({ diff, aReb, bReb }) {
  const absDiff = Math.abs(diff);
  const leadCol = diff > 0 ? 'var(--orange)' : diff < 0 ? 'var(--blue)' : '#94A3B8';
  const sign = diff > 0 ? '+' : diff < 0 ? '' : '';

  // Threshold markers
  const has3 = absDiff >= 3;
  const has5 = absDiff >= 5;

  return (
    <div className={styles.rebDiff}>
      <div className={styles.rebLabel}>REB</div>
      <div className={styles.rebSlider}>
        <span className={styles.rebTotal} style={{ color: 'var(--orange)' }}>{aReb}</span>
        <div className={styles.rebBarWrap}>
          <div className={styles.rebBar}>
            <div className={styles.rebFill} style={{
              width: absDiff > 0 ? Math.min(100, absDiff * 10) + '%' : '0%',
              background: leadCol,
              [diff >= 0 ? 'right' : 'left']: '50%',
              [diff >= 0 ? 'left' : 'right']: 'auto',
              position: 'absolute',
              ...(diff > 0 ? { right: '50%', left: 'auto' } : diff < 0 ? { left: '50%', right: 'auto' } : {}),
            }} />
            <div className={styles.rebCenter} />
          </div>
          <div className={styles.rebDiffVal} style={{ color: leadCol }}>
            {diff === 0 ? 'EVEN' : `+${absDiff}`}
          </div>
        </div>
        <span className={styles.rebTotal} style={{ color: 'var(--blue)' }}>{bReb}</span>
      </div>
      <div className={styles.rebThresholds}>
        {has3 && <span className={styles.rebThresh} style={{ color: leadCol }}>+3: Paint Check</span>}
        {has5 && <span className={styles.rebThresh} style={{ color: leadCol }}>+5: Fast Break</span>}
      </div>
    </div>
  );
}
