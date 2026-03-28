import styles from './GameOver.module.css';

export default function GameOver({ game, onPlayAgain }) {
  const { teamA, teamB } = game;
  const w = teamA.score > teamB.score ? teamA : teamA.score < teamB.score ? teamB : null;
  const winCol = w === teamA ? 'var(--orange)' : 'var(--blue)';

  return (
    <div className={styles.wrap}>
      <div className={styles.finalScore}>
        <div className={styles.label}>FINAL SCORE</div>
        <div className={styles.score}>{teamA.score} — {teamB.score}</div>
        <div className={styles.winner} style={{ color: winCol }}>
          {w ? `${w.name} wins!` : 'Tie game!'}
        </div>
      </div>

      <div className={styles.boxScores}>
        <BoxScore team={teamA} col="var(--orange)" />
        <BoxScore team={teamB} col="var(--blue)" />
      </div>

      <div className={styles.footer}>
        <button className={styles.playAgain} onClick={onPlayAgain}>Play Again</button>
      </div>
    </div>
  );
}

function BoxScore({ team, col }) {
  const players = team.roster
    .map(p => ({ player: p, st: team.stats.find(s => s.id === p.id) || {} }))
    .filter(({ st }) => st.pts || st.reb || st.ast || st.totalMinutes || st.minutes || st.threepa || st.fta)
    .sort((a, b) => (b.st.totalMinutes || b.st.minutes || 0) - (a.st.totalMinutes || a.st.minutes || 0));

  const totals = players.reduce((acc, { st }) => ({
    pts:     acc.pts     + (st.pts || 0),
    reb:     acc.reb     + (st.reb || 0),
    ast:     acc.ast     + (st.ast || 0),
    threepm: acc.threepm + (st.threepm || 0),
    threepa: acc.threepa + (st.threepa || 0),
    ftm:     acc.ftm     + (st.ftm || 0),
    fta:     acc.fta     + (st.fta || 0),
  }), { pts:0, reb:0, ast:0, threepm:0, threepa:0, ftm:0, fta:0 });

  return (
    <div className={styles.box}>
      <div className={styles.boxHeader}>
        <h3 style={{ color: col }}>{team.name}</h3>
        <div className={styles.boxTotal} style={{ color: col }}>{team.score} pts</div>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PLAYER</th>
              <th>MIN</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>3PM-A</th>
              <th>FTM-A</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            {players.map(({ player, st }) => {
              const pm = st.pm || 0;
              const pmCol = pm > 0 ? 'var(--green)' : pm < 0 ? 'var(--red)' : 'var(--text-muted)';
              return (
                <tr key={player.id}>
                  <td className={styles.playerCell}>{player.name}</td>
                  <td>{st.totalMinutes || st.minutes || 0}</td>
                  <td className={styles.pts} style={{ color: col }}>{st.pts || 0}</td>
                  <td>{st.reb || 0}</td>
                  <td>{st.ast || 0}</td>
                  <td>{st.threepm || 0}/{st.threepa || 0}</td>
                  <td>{st.ftm || 0}/{st.fta || 0}</td>
                  <td style={{ color: pmCol, fontWeight: 600 }}>{pm > 0 ? '+' : ''}{pm}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles.totalsLabel}>TOTALS</td>
              <td>—</td>
              <td className={styles.pts} style={{ color: col }}>{totals.pts}</td>
              <td>{totals.reb}</td>
              <td>{totals.ast}</td>
              <td>{totals.threepm}/{totals.threepa}</td>
              <td>{totals.ftm}/{totals.fta}</td>
              <td>—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
