import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import { calcAdv, getTeam, getOpp, getPS } from '../../game/engine.js';
import styles from './MatchupPhase.module.css';

export default function MatchupPhase({ game, setGame, onExecCard }) {
  const { teamA, teamB, offMatchups, matchupTurn, matchupPasses } = game;
  const aS = teamA.starters, bS = teamB.starters;
  const turnCol = matchupTurn === 'A' ? 'var(--orange)' : 'var(--blue)';

  const pass = () => {
    const g = JSON.parse(JSON.stringify(game));
    g.matchupPasses++;
    if (g.matchupPasses >= 2) {
      g.phase = 'scoring';
      g.rollResults = { A: [], B: [] };
      g.log = [...g.log, { team: null, msg: 'Both teams passed — Scoring Phase begins!' }];
    } else {
      const prev = g.matchupTurn;
      g.matchupTurn = g.matchupTurn === 'A' ? 'B' : 'A';
      g.log = [...g.log, { team: prev, msg: 'Passed matchup turn.' }];
    }
    setGame(g);
  };

  const lockMatchups = () => {
    const g = JSON.parse(JSON.stringify(game));
    g.phase = 'scoring';
    g.rollResults = { A: [], B: [] };
    g.log = [...g.log, { team: null, msg: `Q${g.quarter} Sec ${g.section} — Scoring Phase begins!` }];
    setGame(g);
  };

  const playCard = (teamKey, cardId) => {
    const play = canPlayCard(game, teamKey, cardId);
    if (!play.canPlay) { alert(play.reason); return; }
    // For cards that need extra opts (HSR), we'll do a simple prompt for now
    // Full modal UI comes with the court redesign
    let opts = {};
    if (cardId === 'high_screen_roll') {
      const t = getTeam(game, teamKey);
      const s1 = parseInt(prompt(`Slot 1 to swap defender (0-${t.starters.length-1}):`) || '0');
      const s2 = parseInt(prompt(`Slot 2 to swap defender (0-${t.starters.length-1}):`) || '1');
      opts = { swapSlot1: s1, swapSlot2: s2 };
    } else if (cardId === 'stagger_action') {
      const t = getTeam(game, teamKey);
      const names = t.starters.map((p,i) => `${i}: ${p.name}`).join('\n');
      opts.playerIdx  = parseInt(prompt('Speed 13+ player index:\n' + names) || '0');
      opts.player2Idx = parseInt(prompt('3PT Bonus player index:\n' + names) || '1');
    } else if (['second_wind','chip_on_shoulder','defensive_stopper'].includes(cardId)) {
      const t = getTeam(game, teamKey);
      const names = t.starters.map((p,i) => `${i}: ${p.name}`).join('\n');
      opts.playerIdx = parseInt(prompt('Target player index:\n' + names) || '0');
    }
    onExecCard(teamKey, cardId, opts);
  };

  const oppTurn = matchupTurn === 'A' ? 'B' : 'A';
  const activeHand = getTeam(game, matchupTurn).hand.filter(id => {
    const s = getStrat(id); return s && s.phase === 'matchup';
  });
  const reactionHand = getTeam(game, oppTurn).hand.filter(id =>
    ['go_under','fight_over','veer_switch'].includes(id)
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3>Matchup Strategy Phase</h3>
        <div className={styles.turnBadge} style={{ background: matchupTurn === 'A' ? 'rgba(234,88,12,0.2)' : 'rgba(59,130,246,0.2)', color: turnCol }}>
          Team {matchupTurn}'s turn · {matchupPasses}/2 passes
        </div>
      </div>
      <p className={styles.subtitle}>Matchups are locked from the draft. Play a card to adjust, or pass twice to move to Scoring.</p>

      <div className={styles.board}>
        {[0,1,2,3,4].map(i => {
          const ap = aS[i], bp = bS[i]; if (!ap || !bp) return null;
          const aDefIdx = offMatchups.A[i], bDefIdx = offMatchups.B[i];
          const aDef = bS[aDefIdx], bDef = aS[bDefIdx];
          const aAdv = aDef ? calcAdv(ap, aDef, {}, i) : null;
          const bAdv = bDef ? calcAdv(bp, bDef, {}, i) : null;
          return (
            <div key={i} className={styles.matchupRow}>
              <MatchupPlayer player={ap} def={aDef} adv={aAdv} teamKey="A" stats={teamA.stats}
                defSelect={bS} currentDefIdx={aDefIdx}
                onDefChange={di => { const g=JSON.parse(JSON.stringify(game)); g.offMatchups.A[i]=di; setGame(g); }} />
              <div className={styles.vs}>⚔️<div className={styles.slot}>slot {i+1}</div></div>
              <MatchupPlayer player={bp} def={bDef} adv={bAdv} teamKey="B" stats={teamB.stats} align="right"
                defSelect={aS} currentDefIdx={bDefIdx}
                onDefChange={di => { const g=JSON.parse(JSON.stringify(game)); g.offMatchups.B[i]=di; setGame(g); }} />
            </div>
          );
        })}
      </div>

      <div className={styles.cardsArea}>
        <div>
          <div className={styles.handLabel} style={{ color: turnCol }}>Team {matchupTurn} — Play a matchup card</div>
          <div className={styles.hand}>
            {activeHand.length === 0 && <span className={styles.noCards}>No matchup cards in hand</span>}
            {activeHand.map(id => {
              const s = getStrat(id); if (!s) return null;
              const play = canPlayCard(game, matchupTurn, id);
              return (
                <button key={id} className={`${styles.card} ${!play.canPlay ? styles.dimCard : ''}`}
                  style={{ borderLeftColor: s.color }}
                  onClick={() => play.canPlay && playCard(matchupTurn, id)}
                  title={play.canPlay ? s.desc : '❌ ' + play.reason}>
                  <div className={styles.cardName}>{s.name}</div>
                  <div className={styles.cardDesc}>{play.canPlay ? s.desc.substring(0,55)+'…' : '❌ '+play.reason}</div>
                </button>
              );
            })}
          </div>
          <button className={styles.passBtn} onClick={pass}>Pass →</button>
        </div>
        <div>
          <div className={styles.handLabel} style={{ color: oppTurn === 'A' ? 'var(--orange)' : 'var(--blue)' }}>
            Team {oppTurn} — Reaction cards
          </div>
          <div className={styles.hand}>
            {reactionHand.length === 0 && <span className={styles.noCards}>No reaction cards</span>}
            {reactionHand.map(id => {
              const s = getStrat(id); if (!s) return null;
              const play = canPlayCard(game, oppTurn, id);
              return (
                <button key={id} className={`${styles.card} ${styles.reactionCard} ${!play.canPlay ? styles.dimCard : ''}`}
                  style={{ borderLeftColor: s.color }}
                  onClick={() => play.canPlay && playCard(oppTurn, id)}
                  title={play.canPlay ? s.desc : '❌ '+play.reason}>
                  <div className={styles.cardName}>{s.name}</div>
                  <div className={styles.cardDesc}>{play.canPlay ? s.desc.substring(0,55)+'…' : '❌ '+play.reason}</div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <button className={styles.lockBtn} onClick={lockMatchups}>Lock Matchups → Scoring Phase</button>
    </div>
  );
}

function MatchupPlayer({ player, def, adv, teamKey, stats, align, defSelect, currentDefIdx, onDefChange }) {
  const ps = stats?.find(s => s.id === player.id) || {};
  const rollCol = adv ? (adv.rollBonus > 0 ? 'var(--green)' : adv.hasPenalty ? 'var(--red)' : 'var(--text-muted)') : 'var(--text-muted)';
  return (
    <div className={styles.player} style={{ textAlign: align }}>
      <div className={styles.playerName} style={{ color: teamKey === 'A' ? 'var(--orange)' : 'var(--blue)' }}>
        {player.name}{ps.hot > 0 ? ' 🔥' : ps.cold > 0 ? ' ❄️' : ''}
      </div>
      <div className={styles.playerSub}>S{player.speed} P{player.power} · Line {player.shotLine}</div>
      {adv && <div style={{ color: rollCol, fontSize: 10, fontWeight: 600, marginTop: 3 }}>Roll {adv.rollBonus > 0 ? '+' : ''}{adv.rollBonus}{adv.hasPenalty ? ' ⚠️' : ''}</div>}
      {defSelect && (
        <>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>defended by:</div>
          <select className={styles.defSelect} value={currentDefIdx} onChange={e => onDefChange(parseInt(e.target.value))}>
            {defSelect.map((d,i) => {
              const a = calcAdv(player, d, {}, 0);
              const flag = a.rollBonus > 0 ? ` ✓+${a.rollBonus}` : a.hasPenalty ? ` ✗${a.rollBonus}` : '';
              return <option key={i} value={i}>{d.name} (S{d.speed} P{d.power}{d.defBoost ? ` D${d.defBoost>0?'+':''}${d.defBoost}`:''}{flag})</option>;
            })}
          </select>
        </>
      )}
    </div>
  );
}
