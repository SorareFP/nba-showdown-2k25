import styles from './Scoreboard.module.css';

export default function Scoreboard({ game }) {
  const { teamA: ga, teamB: gb, quarter, section, phase } = game;
  const phaseLabel = { draft:'Matchup Draft', matchup_strats:'Strategy Phase', scoring:'Scoring Phase' }[phase] || phase;

  return (
    <div className={styles.board}>
      <TeamScore team={ga} color="var(--orange)" side="left" />
      <div className={styles.center}>
        <div className={styles.badge}>Q{quarter} · Sec {section}/3</div>
        <div className={styles.phase}>{phaseLabel}</div>
        <div className={styles.tracks}>
          <Track label="AST" val={ga.assists} col="var(--orange)" />
          <Track label="REB" val={ga.rebounds} col="var(--orange)" />
          <span className={styles.trackDiv}>vs</span>
          <Track label="REB" val={gb.rebounds} col="var(--blue)" />
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
