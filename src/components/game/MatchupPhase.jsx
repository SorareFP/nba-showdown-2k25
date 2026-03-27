// MatchupPhase.jsx
import { useState } from 'react';
import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import { calcAdv, getTeam, getOpp, getPS } from '../../game/engine.js';
import styles from './MatchupPhase.module.css';

export default function MatchupPhase({ game, setGame }) {
  const [execCard, setExecCard] = useState(null);
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
    setExecCard(null);
  };

  const lockMatchups = () => {
    const g = JSON.parse(JSON.stringify(game));
    g.phase = 'scoring';
    g.rollResults = { A: [], B: [] };
    g.log = [...g.log, { team: null, msg: `Q${g.quarter} Sec ${g.section} — Scoring Phase begins!` }];
    setGame(g);
    setExecCard(null);
  };

  const playCard = (teamKey, cardId) => {
    const play = canPlayCard(game, teamKey, cardId);
    if (!play.canPlay) { alert(play.reason); return; }
    setExecCard({ teamKey, cardId });
  };

  const activeHand = getTeam(game, matchupTurn).hand.filter(id => {
    const s = getStrat(id); return s && s.phase === 'matchup';
  });
  const oppTurn = matchupTurn === 'A' ? 'B' : 'A';
  const reactionHand = getTeam(game, oppTurn).hand.filter(id => {
    const s = getStrat(id); return s && s.phase === 'reaction' && ['go_under','fight_over','veer_switch'].includes(id);
  });

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3>Matchup Strategy Phase</h3>
        <div className={styles.turnBadge} style={{ background: matchupTurn === 'A' ? 'rgba(234,88,12,0.2)' : 'rgba(59,130,246,0.2)', color: turnCol }}>
          Team {matchupTurn}'s turn · {matchupPasses}/2 passes
        </div>
      </div>
      <p className={styles.subtitle}>Matchups are locked. Play a card to adjust, or pass. Two consecutive passes → Scoring Phase.</p>

      {/* Matchup board */}
      <div className={styles.board}>
        {[0,1,2,3,4].map(i => {
          const ap = aS[i], bp = bS[i]; if (!ap || !bp) return null;
          const aDefIdx = offMatchups.A[i]; // which B player defends A[i]
          const bDefIdx = offMatchups.B[i]; // which A player defends B[i]
          const aDef = bS[aDefIdx], bDef = aS[bDefIdx];
          const aAdv = aDef ? calcAdv(ap, aDef, {}, i) : null;
          const bAdv = bDef ? calcAdv(bp, bDef, {}, i) : null;
          return (
            <div key={i} className={styles.matchupRow}>
              <MatchupPlayer player={ap} def={aDef} adv={aAdv} teamKey="A"
                stats={teamA.stats} game={game}
                defSelect={bS} currentDefIdx={aDefIdx}
                onDefChange={di => {
                  const g = JSON.parse(JSON.stringify(game));
                  g.offMatchups.A[i] = di; setGame(g);
                }} />
              <div className={styles.vs}>⚔️<div className={styles.slot}>slot {i+1}</div></div>
              <MatchupPlayer player={bp} def={bDef} adv={bAdv} teamKey="B"
                stats={teamB.stats} game={game} align="right"
                defSelect={aS} currentDefIdx={bDefIdx}
                onDefChange={di => {
                  const g = JSON.parse(JSON.stringify(game));
                  g.offMatchups.B[i] = di; setGame(g);
                }} />
            </div>
          );
        })}
      </div>

      {/* Cards */}
      <div className={styles.cardsArea}>
        <div>
          <div className={styles.handLabel} style={{ color: turnCol }}>Team {matchupTurn} — Play a card</div>
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

function MatchupPlayer({ player, def, adv, teamKey, stats, game, align, defSelect, currentDefIdx, onDefChange }) {
  const ps = stats?.find(s => s.id === player.id) || {};
  const rollCol = adv ? (adv.rollBonus > 0 ? 'var(--green)' : adv.hasPenalty ? 'var(--red)' : 'var(--text-muted)') : 'var(--text-muted)';
  const boosts = [
    player.threePtBoost ? `3PT${player.threePtBoost>0?'+':''}${player.threePtBoost}` : '',
    player.paintBoost   ? `Paint${player.paintBoost>0?'+':''}${player.paintBoost}` : '',
    player.defBoost     ? `Def${player.defBoost>0?'+':''}${player.defBoost}` : '',
  ].filter(Boolean);

  return (
    <div className={styles.player} style={{ textAlign: align }}>
      <div className={styles.playerName} style={{ color: teamKey === 'A' ? 'var(--orange)' : 'var(--blue)' }}>
        {player.name}{ps.hot > 0 ? ' 🔥' : ps.cold > 0 ? ' ❄️' : ''}
      </div>
      <div className={styles.playerSub}>S{player.speed} P{player.power} · Line {player.shotLine}</div>
      {boosts.length > 0 && <div className={styles.boosts}>{boosts.join(' · ')}</div>}
      <div style={{ color: rollCol, fontSize: 10, fontWeight: 600, marginTop: 3 }}>
        {adv ? `Roll ${adv.rollBonus > 0 ? '+' : ''}${adv.rollBonus}${adv.hasPenalty ? ' penalty' : ''}` : ''}
      </div>
      {defSelect && (
        <>
          <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>defended by:</div>
          <select className={styles.defSelect} value={currentDefIdx} onChange={e => onDefChange(parseInt(e.target.value))}>
            {defSelect.map((d,i) => {
              const a = calcAdv(player, d, {}, 0);
              const flag = a.rollBonus > 0 ? ` ✓+${a.rollBonus}` : a.hasPenalty ? ` ✗${a.rollBonus}` : '';
              return <option key={i} value={i}>{d.name} (S{d.speed} P{d.power}{d.defBoost?` D${d.defBoost>0?'+':''}${d.defBoost}`:''}{flag})</option>;
            })}
          </select>
        </>
      )}
    </div>
  );
}
