import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { calculateRewards } from '../../game/coinRewards.js';
import { addCoins, getUserData, updateUserFields, addCardsToCollection } from '../../firebase/collection.js';
import styles from './GameOver.module.css';

export default function GameOver({ game, onPlayAgain, isPvp = false, myTeamKey = null, onLeave = null }) {
  const { user } = useAuth();
  const { teamA, teamB } = game;
  const w = teamA.score > teamB.score ? teamA : teamA.score < teamB.score ? teamB : null;
  const winCol = w === teamA ? 'var(--orange)' : 'var(--blue)';

  // In PvP, determine if this player won
  const myTeam = myTeamKey === 'A' ? teamA : myTeamKey === 'B' ? teamB : null;
  const pvpIsWinner = isPvp && myTeam ? w === myTeam : false;

  const [rewards, setRewards] = useState(null);
  const [rewardsApplied, setRewardsApplied] = useState(false);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!user || appliedRef.current) return;
    appliedRef.current = true;

    (async () => {
      const userData = await getUserData(user.uid);
      if (!userData) return;

      // Daily reset check
      const today = new Date().toISOString().split('T')[0];
      let dailyCoins = userData.dailyMilestoneCoins || 0;
      let dailyFirstWin = userData.dailyFirstWin || false;
      if (userData.dailyMilestoneDate !== today) {
        dailyCoins = 0;
        dailyFirstWin = false;
      }

      const isWinner = isPvp ? pvpIsWinner : w !== null; // self-play always has a winner
      const result = calculateRewards(game, isWinner, dailyCoins, isPvp);

      // Daily first win bonus
      if (isWinner && !dailyFirstWin) {
        result.coins += 50;
        result.breakdown.push({ label: 'Daily First Win', coins: 50 });
      }

      setRewards(result);

      // Apply rewards to Firestore
      if (result.coins > 0) {
        await addCoins(user.uid, result.coins);
      }

      // Update daily tracking
      const updates = {
        dailyMilestoneDate: today,
        dailyMilestoneCoins: dailyCoins + result.milestoneCoins,
      };
      if (isWinner && !dailyFirstWin) updates.dailyFirstWin = true;
      await updateUserFields(user.uid, updates);

      // Bam reward
      if (result.bamReward) {
        await addCardsToCollection(user.uid, [{ id: result.bamCardId, type: 'player' }], 'milestone', 0);
      }

      setRewardsApplied(true);
    })();
  }, [user, game, w, isPvp, pvpIsWinner]);

  return (
    <div className={styles.wrap}>
      <div className={styles.finalScore}>
        <div className={styles.label}>FINAL SCORE</div>
        <div className={styles.score}>{teamA.score} — {teamB.score}</div>
        <div className={styles.winner} style={{ color: winCol }}>
          {isPvp
            ? (pvpIsWinner ? 'You win!' : w ? 'You lose!' : 'Tie game!')
            : (w ? `${w.name} wins!` : 'Tie game!')
          }
        </div>
      </div>

      {/* Rewards section */}
      {rewards && (
        <div className={styles.rewardsBox}>
          <div className={styles.rewardsTitle}>Rewards Earned</div>
          <div className={styles.rewardsList}>
            {rewards.breakdown.map((item, i) => (
              <div key={i} className={styles.rewardRow}>
                <span className={styles.rewardLabel}>{item.label}</span>
                <span className={item.special ? styles.rewardSpecial : styles.rewardCoins}>
                  {item.special ? 'CARD' : `+${item.coins}`}
                </span>
              </div>
            ))}
          </div>
          <div className={styles.rewardsTotal}>
            <span>Total Coins</span>
            <span className={styles.totalCoins}>+{rewards.coins}</span>
          </div>
          {rewards.bamReward && (
            <div className={styles.bamReward}>Bam Adebayo card added to your collection!</div>
          )}
        </div>
      )}

      <div className={styles.boxScores}>
        <BoxScore team={teamA} col="var(--orange)" />
        <BoxScore team={teamB} col="var(--blue)" />
      </div>

      <div className={styles.footer}>
        {onPlayAgain && <button className={styles.playAgain} onClick={onPlayAgain}>Play Again</button>}
        {onLeave && <button className={styles.playAgain} onClick={onLeave}>Leave Game</button>}
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
