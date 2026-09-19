import styles from './Scoreboard.module.css';
import { periodLabel, rollTurnLine } from '../../game/engine.js';

function HelpBtn() {
  const handleClick = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('showdown-help', { detail: { section: 'overview' } }));
  };
  return <button className={styles.helpBtn} onClick={handleClick} title="How to Play">?</button>;
}

// `rollGate` (engine.js rollGate, or null): passed where the a-b-a-b roll is
// enforced — against the coach and in the tutorial — so the line says whose
// die it is instead of "All players may roll" (2026-09-18).
export default function Scoreboard({ game, pvpMode = false, myTeamKey = null, isMyTurn = true, rollGate = null }) {
  const { teamA: ga, teamB: gb, quarter, section, phase } = game;
  const phaseLabel = { draft:'Matchup Draft', matchup_strats:'Strategy Phase', scoring:'Scoring Phase' }[phase] || phase;
  const rebDiff = ga.rebounds - gb.rebounds;

  // Build turn detail string
  const turnDetail = buildTurnDetail(game, pvpMode, myTeamKey, isMyTurn, rollGate);

  return (
    <div className={styles.board}>
      <TeamScore team={ga} color="var(--orange)" side="left" />
      <div className={styles.center}>
        <div className={styles.badge}>{periodLabel(game)}</div>
        <div className={styles.phase}>{phaseLabel} <HelpBtn /></div>
        {turnDetail && <div className={styles.turnDetail}>{turnDetail}</div>}
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

function buildTurnDetail(game, pvpMode, myTeamKey, isMyTurn, rollGate = null) {
  const { phase, matchupTurn, matchupPasses, scoringTurn, scoringPasses } = game;

  // THE SECRET LINEUP. This read `draft.step`, a field the secret-lineup
  // rewrite dropped, and printed "Pick 1/10 · Team A's pick" over a screen
  // where both sides pick five at once (2026-09-18).
  if (phase === 'draft') {
    if (pvpMode) {
      const mine = myTeamKey === 'B' ? game.draft?.bReady : game.draft?.aReady;
      const theirs = myTeamKey === 'B' ? game.draft?.aReady : game.draft?.bReady;
      if (mine) return theirs ? 'Revealing lineups…' : 'Lineup locked · waiting for opponent';
    }
    return 'Pick your five';
  }

  if (phase === 'matchup_strats') {
    if (pvpMode) return isMyTurn ? `Your turn · ${matchupPasses}/2 passes` : `Opponent's turn · ${matchupPasses}/2 passes`;
    return `Team ${matchupTurn} · ${matchupPasses}/2 passes`;
  }

  if (phase === 'scoring') {
    const rollingOpen = scoringPasses >= 99;
    if (rollingOpen) {
      // One wording with the phase bar's (engine.js rollTurnLine).
      return `🎲 ${rollTurnLine(game, rollGate)}`;
    }
    if (pvpMode) return isMyTurn ? `Your strategy turn · ${Math.min(scoringPasses,2)}/2 passes` : `Opponent's strategy turn`;
    return `Team ${scoringTurn} strategy · ${Math.min(scoringPasses,2)}/2 passes`;
  }

  return null;
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
        {/* +5 Fast Break is gone — the mechanic was removed from the engine and
            the scoreboard was still promising it. */}
        {has3 && <span className={styles.rebThresh} style={{ color: leadCol }}>+3: Paint Check</span>}
      </div>
    </div>
  );
}
