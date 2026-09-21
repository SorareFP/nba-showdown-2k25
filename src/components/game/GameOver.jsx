import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { detectMilestones, settleGameReward, todayKey } from '../../game/coinRewards.js';
import { getUserData } from '../../firebase/collection.js';
import { claimGameReward } from '../../firebase/serverWrites.js';
import { humanWon, humanTeamKey } from '../../game/outcome.js';
import { boxScoreFor } from '../../game/boxScore.js';
import { useCardStats } from '../../firebase/CardStatsProvider.jsx';
import { buildGameClaim, paidView, readClaimAnswer } from '../../game/gameClaim.js';
import styles from './GameOver.module.css';

/**
 * `mode` is the game's shape: 'ai' (you on A against the coach), 'hotseat'
 * (two people at one screen), or PvP via `isPvp` + `myTeamKey`. The claim's
 * `won` and the headline both come from humanWon — see outcome.js for why.
 */
/**
 * `aiLevel` is the rung the coach played at (aiLevels.js), or null when no
 * coach played — hotseat, PvP. It scales what the game pays (coinRewards.js
 * AI_PAY), and for a league fixture the server floors it by the league's own
 * rung.
 *
 * THE GAME IS PAID ONCE (2026-09-18). A finished game's save stayed in
 * localStorage until Play Again, and every reload mounted this screen and
 * claimed again; the ref below was the only guard and a reload resets it.
 * Now:
 *   `claimId`  the game's identity (gameSave.js claimIdOf; a PvP room's code
 *              and creation stamp) — the server keeps a receipt under it and
 *              answers a repeat with `already: true` and what it paid
 *   `paid`     the stamp a claimed game's save carries: shown, never re-sent
 *   `onPaid`   called with (claimId, { coins, breakdown }), so the caller can
 *              stamp the save — of THAT game only (gameClaim.js stampBelongs)
 *   `rungDraw` did the coach draw its own team at the rung (the pay terms)
 */
export default function GameOver({ game, onPlayAgain, isPvp = false, myTeamKey = null, mode = 'ai', onLeave = null, leaveLabel = 'Leave Game', fixtureFrom = null, aiLevel = null, claimId = null, paid = null, onPaid = null, rungDraw = false }) {
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

    // Already paid: what it was paid, and no claim.
    if (paid) {
      setRewards(paidView(paid));
      setRewardsApplied(true);
      return;
    }

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
      // `margin` is MY score minus theirs: a win pays by it, a close loss pays a
      // little (coinRewards.js). Hotseat has no "me", so no margin.
      const margin = myKey === 'A' ? teamA.score - teamB.score : myKey === 'B' ? teamB.score - teamA.score : null;
      // A fixture sends WHICH season (and dynasty or friends league) it came
      // from — every fixture, not only a dynasty's (2026-09-18). The preview
      // below prices it as a custom game; the server verifies the season,
      // pays the league's rung floored by the played one (and a dynasty's 15%),
      // and its answer replaces the preview.
      // Built by gameClaim.js buildGameClaim, where a test reaches it.
      const claim = buildGameClaim({
        won: youWon, isPvp, margin, milestones: detectMilestones(game, myKey),
        box: myKey ? boxScoreFor(game, myKey) : [],
        aiLevel, rungDraw, claimId, fixtureFrom,
      });
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
        const res = await claimGameReward(user.uid, claim);
        // `already: true` is paid before — by a reload's first mount, or on
        // another device — and is success, not an error: show what it was
        // paid and stamp the save. A fresh pay shows the server's breakdown:
        // it is the side that knows a league's rung and the dynasty rate.
        const answer = readClaimAnswer(res, preview);
        if (answer.fresh) refreshCardStats();
        setRewards(answer.view);
        // The stamp names ITS game (2026-09-18): the answer can land after
        // Play Again and a new deal, and the caller stamps only when this key
        // is still the live game's (gameClaim.js stampBelongs).
        onPaid?.(claimId, answer.stamp);
      } catch (e) {
        console.error('Reward claim failed:', e);
        setRewards(r => ({ ...r, coins: 0, error: e.message }));
      }

      setRewardsApplied(true);
    })();
  }, [user, game, youWon, myKey, isPvp, aiLevel, refreshCardStats, paid, claimId, rungDraw, onPaid]);

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
                  {item.special ? 'CARD' : item.note ? '—' : `+${item.coins}`}
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
