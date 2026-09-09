import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { detectMilestones, settleGameReward, todayKey } from '../../game/coinRewards.js';
import { getUserData } from '../../firebase/collection.js';
import { claimGameReward } from '../../firebase/serverWrites.js';
import { humanWon, humanTeamKey } from '../../game/outcome.js';
import { boxScoreFor } from '../../game/boxScore.js';
import { useCardStats } from '../../firebase/CardStatsProvider.jsx';
import styles from './GameOver.module.css';

/**
 * `mode` is the game's shape: 'ai' (you on A against the coach), 'hotseat'
 * (two people at one screen), or PvP via `isPvp` + `myTeamKey`. The claim's
 * `won` and the headline both come from humanWon — see outcome.js for why.
 */
export default function GameOver({ game, onPlayAgain, isPvp = false, myTeamKey = null, mode = 'ai', onLeave = null, leaveLabel = 'Leave Game' }) {
  const { user } = useAuth();
  const { refresh: refreshCardStats } = useCardStats();
  const { teamA, teamB } = game;
  const w = teamA.score > teamB.score ? teamA : teamA.score < teamB.score ? teamB : null;
  const winCol = w === teamA ? 'var(--orange)' : 'var(--blue)';

  const shape = isPvp ? 'pvp' : mode;
  const youWon = humanWon(game, { mode: shape, myTeamKey });
  const myKey = humanTeamKey({ mode: shape, myTeamKey });
  // PvP and solo-vs-coach both have a "you"; hotseat does not.
  const hasYou = myKey !== null;

  const [rewards, setRewards] = useState(null);
  const [rewardsApplied, setRewardsApplied] = useState(false);
  const appliedRef = useRef(false);

  useEffect(() => {
    if (!user || appliedRef.current) return;
    appliedRef.current = true;

    (async () => {
      const userData = await getUserData(user.uid);
      if (!userData) return;

      // THE CLAIM. What the client asserts about the game: won or not, PvP or
      // not, which milestones the box score hit. It is priced by
      // settleGameReward — here for the breakdown, and again on the server for
      // the actual coins, against the server's own copy of the daily counters.
      // `won` is the HUMAN's win (outcome.js) — never "somebody won".
      // The box goes with the claim: the lifetime tracker's lines for MY team —
      // A against the coach, my side in PvP, nobody's in hotseat.
      // Milestones are MY players' — the coach's triple-double is not my bonus.
      const claim = { won: youWon, pvp: isPvp, ...detectMilestones(game, myKey), box: myKey ? boxScoreFor(game, myKey) : [] };
      const today = todayKey();
      const preview = settleGameReward(
        claim,
        { date: userData.dailyMilestoneDate, coins: userData.dailyMilestoneCoins, firstWin: userData.dailyFirstWin },
        today
      );
      setRewards(preview);

      // The server's totals replace the preview's. They differ only if this
      // client's view of the counters was stale — a game finished on another
      // device a moment ago — and then the server is the one that is right.
      try {
        const paid = await claimGameReward(user.uid, claim);
        refreshCardStats();
        setRewards(r => ({
          ...r,
          coins: paid.coins,
          milestoneCoins: paid.milestoneCoins,
          firstWin: paid.firstWin,
          bamReward: paid.bam,
        }));
      } catch (e) {
        console.error('Reward claim failed:', e);
        setRewards(r => ({ ...r, coins: 0, error: e.message }));
      }

      setRewardsApplied(true);
    })();
  }, [user, game, youWon, myKey, isPvp, refreshCardStats]);

  return (
    <div className={styles.wrap}>
      <div className={styles.finalScore}>
        <div className={styles.label}>FINAL SCORE</div>
        <div className={styles.score}>{teamA.score} — {teamB.score}</div>
        <div className={styles.winner} style={{ color: winCol }}>
          {isPvp
            ? (youWon ? 'You win!' : w ? 'You lose!' : 'Tie game!')
            : hasYou
              ? (youWon ? 'You win!' : w ? `You lose — ${w.name} wins.` : 'Tie game!')
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
            <div className={styles.bamReward}>Bam Adebayo card added to your cards — collect it in the Collection tab!</div>
          )}
        </div>
      )}

      <div className={styles.boxScores}>
        <BoxScore team={teamA} col="var(--orange)" />
        <BoxScore team={teamB} col="var(--blue)" />
      </div>

      <div className={styles.footer}>
        {onPlayAgain && <button className={styles.playAgain} onClick={onPlayAgain}>Play Again</button>}
        {onLeave && <button className={styles.playAgain} onClick={onLeave}>{leaveLabel}</button>}
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
