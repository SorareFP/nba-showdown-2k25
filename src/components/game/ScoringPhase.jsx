import { useState } from 'react';
import { calcAdv, getTeam, getOpp, getPS, getFatigue } from '../../game/engine.js';
import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import styles from './ScoringPhase.module.css';

export default function ScoringPhase({ game, setGame, onRoll, onEndSection, onExecCard, onResolve }) {
  const rA = game.rollResults.A || [], rB = game.rollResults.B || [];
  const allRolled = rA.length===5 && rB.length===5 && rA.every(r=>r!=null) && rB.every(r=>r!=null);
  const { scoringTurn, scoringPasses } = game;
  const rollingOpen = scoringPasses >= 99;

  const passTurn = () => {
    const g = JSON.parse(JSON.stringify(game));
    g.scoringPasses++;
    if (g.scoringPasses >= 2) {
      g.scoringPasses = 99;
      g.log = [...g.log, { team: null, msg: 'Both teams passed — rolling begins!' }];
    } else {
      const prev = g.scoringTurn;
      g.scoringTurn = g.scoringTurn === 'A' ? 'B' : 'A';
      g.log = [...g.log, { team: prev, msg: 'Passed scoring strategy turn.' }];
    }
    setGame(g);
  };

  const rollAll = () => {
    for (let i=0;i<5;i++) if (!(game.rollResults.A||[])[i]) onRoll('A',i);
    for (let i=0;i<5;i++) if (!(game.rollResults.B||[])[i]) onRoll('B',i);
  };

  const turnCol = scoringTurn === 'A' ? 'var(--orange)' : 'var(--blue)';

  return (
    <div className={styles.wrap}>
      {/* Strategy turn bar */}
      {!rollingOpen && (
        <div className={styles.turnBar}>
          <div>
            <span style={{ color: turnCol, fontWeight:600 }}>Team {scoringTurn}</span>
            <span style={{ color:'var(--text-muted)', fontSize:12 }}> — play a strategy card or pass</span>
            <span style={{ color:'var(--text-dim)', fontSize:11 }}> ({Math.min(scoringPasses,2)}/2 passes)</span>
          </div>
          <div style={{ display:'flex', gap:8 }}>
            <button className={styles.passBtn} onClick={passTurn}>Pass →</button>
            <button className={styles.rollAllBtn} onClick={rollAll}>🎲 Roll All</button>
          </div>
        </div>
      )}
      {rollingOpen && (
        <div className={styles.turnBar}>
          <span style={{ color:'var(--green)', fontWeight:600 }}>Rolling phase — all players may roll</span>
          <button className={styles.rollAllBtn} onClick={rollAll}>🎲 Roll All</button>
        </div>
      )}

      {/* Pending shot check */}
      {game.pendingShotCheck && (
        <PendingShotPanel game={game} onResolve={onResolve} onExecCard={onExecCard} />
      )}

      {/* Roll grids */}
      <div className={styles.grids}>
        <TeamRolls game={game} teamKey="A" col="var(--orange)" onRoll={onRoll} />
        <TeamRolls game={game} teamKey="B" col="var(--blue)"   onRoll={onRoll} />
      </div>

      {/* Hands */}
      <HandPanel game={game} teamKey="A" scoringTurn={scoringTurn} rollingOpen={rollingOpen} onExecCard={onExecCard} />
      <HandPanel game={game} teamKey="B" scoringTurn={scoringTurn} rollingOpen={rollingOpen} onExecCard={onExecCard} />

      {allRolled && !game.pendingShotCheck && (
        <div className={styles.endBar}>
          <span style={{ color:'var(--orange)', fontWeight:600 }}>A: {(rA).reduce((s,r)=>s+(r?.pts||0),0)} pts</span>
          <button className={styles.endBtn} onClick={onEndSection}>End Section →</button>
          <span style={{ color:'var(--blue)', fontWeight:600 }}>B: {(rB).reduce((s,r)=>s+(r?.pts||0),0)} pts</span>
        </div>
      )}
    </div>
  );
}

function TeamRolls({ game, teamKey, col, onRoll }) {
  const t = getTeam(game, teamKey), opp = getOpp(game, teamKey);
  const rr = game.rollResults[teamKey] || [];
  return (
    <div className={styles.teamBlock}>
      <div className={styles.teamHeader}>
        <span style={{ color:col, fontWeight:700 }}>Team {teamKey}</span>
        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{rr.filter(r=>r!=null).length}/5 rolled</span>
      </div>
      {t.starters.map((p, i) => {
        const res = rr[i];
        const defIdx = (game.offMatchups[teamKey]||[])[i] ?? i;
        const dp = opp.starters[defIdx];
        const te = game.tempEff[teamKey] || {};
        const adv = dp ? calcAdv(p, dp, te, i) : null;
        const ps = getPS(game, teamKey, p.id) || {};
        const fat = getFatigue(game, teamKey, i);
        const blocked = game.blockedRolls?.[teamKey]?.[i];
        const allStats = [...game.teamA.stats, ...game.teamB.stats];
        const min = allStats.find(s => s.id === p.id)?.minutes || 0;
        const rollCol = adv ? (adv.rollBonus>0?'var(--green)':adv.hasPenalty?'var(--red)':'var(--text-dim)') : 'var(--text-dim)';

        return (
          <div key={p.id} className={styles.playerRow}>
            <div className={styles.playerInfo}>
              <div className={styles.pName}>
                {p.name}
                {ps.hot>0  && <span className={styles.hot}>🔥{ps.hot>1?'×'+ps.hot:''}</span>}
                {ps.cold>0 && <span className={styles.cold}>❄️{ps.cold>1?'×'+ps.cold:''}</span>}
                {fat<0     && <span className={styles.fatBadge}>FAT{fat}</span>}
              </div>
              <div className={styles.pSub}>
                S{p.speed} P{p.power} · Line {p.shotLine}
                {p.threePtBoost ? <span style={{color:'#93C5FD'}}> · 3PT{p.threePtBoost>0?'+':''}{p.threePtBoost}</span> : ''}
                {p.paintBoost   ? <span style={{color:'#FCD34D'}}> · Paint{p.paintBoost>0?'+':''}{p.paintBoost}</span> : ''}
                {p.defBoost     ? <span style={{color:p.defBoost>0?'#86EFAC':'#FCA5A5'}}> · Def{p.defBoost>0?'+':''}{p.defBoost}</span> : ''}
                <span style={{color:fat<0?'var(--red)':'var(--text-dim)'}}> · {min}min</span>
              </div>
              {adv && (
                <div className={styles.advRow}>
                  <span style={{color:adv.speedAdv>0?'var(--green)':adv.rawSpeedDiff<0?'var(--red)':'var(--text-dim)'}}>
                    Spd {p.speed}−{dp?.speed}{adv.db>0?`−db${adv.db}`:''} = <b>{adv.speedAdv>0?'+':''}{adv.speedAdv}</b>
                  </span>
                  <span style={{color:adv.powerAdv>0?'var(--green)':adv.rawPowerDiff<0?'var(--red)':'var(--text-dim)'}}>
                    Pwr {p.power}−{dp?.power}{adv.db>0?`−db${adv.db}`:''} = <b>{adv.powerAdv>0?'+':''}{adv.powerAdv}</b>
                  </span>
                  <span style={{color:rollCol, fontWeight:600}}>
                    Roll {adv.rollBonus>0?'+':''}{adv.rollBonus}{adv.hasPenalty?' ⚠':''}
                    <span style={{color:'var(--text-dim)', fontWeight:400}}> vs {dp?.name}</span>
                  </span>
                </div>
              )}
            </div>
            <div className={styles.rollResult}>
              {blocked
                ? <div className={styles.blocked}>🏠 Blocked</div>
                : res!=null
                  ? <div>
                      <div className={styles.dice}>🎲{res.die}{res.bonus!==0?(res.bonus>0?'+':'')+res.bonus:''}={res.finalRoll}{res.isTop?' ⭐':''}</div>
                      <div className={styles.pts} style={{color:col}}>{res.pts}pts</div>
                      <div className={styles.statLine}>{res.reb}r {res.ast}a</div>
                    </div>
                  : <button className={styles.rollBtn} style={{background:col}} onClick={()=>onRoll(teamKey,i)}>Roll</button>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HandPanel({ game, teamKey, scoringTurn, rollingOpen, onExecCard }) {
  const [open, setOpen] = useState(true);
  const t = getTeam(game, teamKey);
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const isActive = rollingOpen || scoringTurn === teamKey;
  const playablePhases = isActive ? ['scoring','pre_roll','post_roll'] : [];

  const playCard = (cardId, hi) => {
    const s = getStrat(cardId);
    const play = canPlayCard(game, teamKey, cardId);
    if (!play.canPlay) { alert(play.reason); return; }
    let opts = {};
    const starters = t.starters;
    const names = starters.map((p,i)=>`${i}: ${p.name} (S${p.speed} P${p.power})`).join('\n');

    // Cards that need target player
    const needsTarget = ['heat_check','green_light','you_stand_over_there','catch_and_shoot',
      'elevator_doors','pin_down_screen','bully_ball','power_move','and_one','rimshaker',
      'drive_the_lane','back_to_basket','putback_dunk','ghost_screen','burst_of_momentum',
      'flare_screen','second_wind','cross_court_dime','crowd_favorite','rebound_tap_out',
      'turnover','overhelp','cold_spell','from_way_downtown'];
    if (needsTarget.includes(cardId)) {
      opts.playerIdx = parseInt(prompt(`Target player:\n${names}`) || '0');
    }
    if (cardId === 'energy_injection' || cardId === 'stagger_action') {
      opts.player2Idx = parseInt(prompt(`Second player:\n${names}`) || '1');
    }
    if (cardId === 'this_is_my_house') {
      const opp = getOpp(game, teamKey);
      const oppNames = opp.starters.map((p,i)=>`${i}: ${p.name}`).join('\n');
      opts.offSlot = parseInt(prompt(`Block which opponent player?\n${oppNames}`) || '0');
    }
    if (cardId === 'switch_everything') {
      const opp = getOpp(game, teamKey);
      const assigns = [];
      for (let i=0;i<5;i++) {
        const oppP = opp.starters[i];
        assigns.push(parseInt(prompt(`Who guards ${oppP?.name}? (your player index)\n${names}`) || String(i)));
      }
      opts.assignments = assigns;
    }
    onExecCard(teamKey, cardId, opts);
  };

  return (
    <div className={styles.hand}>
      <button className={styles.handToggle} style={{color:col}} onClick={()=>setOpen(o=>!o)}>
        Team {teamKey} Hand ({t.hand.length} cards) {open?'▲':'▼'}
      </button>
      {open && (
        <div className={styles.handCards}>
          {t.hand.length===0 && <span className={styles.noCards}>Empty hand</span>}
          {t.hand.map((id,hi) => {
            const s = getStrat(id); if (!s) return null;
            const isReaction = s.phase === 'reaction';
            const playable = canPlayCard(game, teamKey, id);
            const canClick = playable.canPlay && (isReaction || playablePhases.includes(s.phase));
            return (
              <div key={`${id}-${hi}`}
                className={`${styles.stratCard} ${!canClick?styles.dimStrat:''} ${isReaction&&playable.canPlay?styles.reactionStrat:''}`}
                style={{borderLeftColor:s.color, cursor:canClick?'pointer':'default'}}
                onClick={()=>canClick&&playCard(id,hi)}
                title={canClick ? s.desc : `❌ ${playable.reason}`}>
                <div className={styles.stratTag}>{s.side==='off'?'⚡':'🛡'} {s.phase.replace('_',' ')}{s.locked?' 🔒':''}</div>
                <div className={styles.stratName}>{s.name}</div>
                <div className={styles.stratDesc}>{canClick ? s.desc.substring(0,60)+'…' : '❌ '+playable.reason}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PendingShotPanel({ game, onResolve, onExecCard }) {
  const { pendingShotCheck: psc } = game;
  if (!psc) return null;
  const offT = getTeam(game, psc.teamKey);
  const offP = offT.starters[psc.playerIdx];
  const defKey = psc.teamKey === 'A' ? 'B' : 'A';
  const defT = getTeam(game, defKey);
  const hasCloseOut = defT.hand.includes('close_out');
  const closeOutPlay = hasCloseOut ? canPlayCard(game, defKey, 'close_out') : null;

  return (
    <div className={styles.pendingPanel}>
      <div className={styles.pendingTitle}>⏸ Pending Shot Check</div>
      <div className={styles.pendingSub}>
        <strong>{offP?.name}</strong> — {psc.cardLabel || psc.type.toUpperCase()} at +{psc.bonus}
        {psc.closeOutBonus && <span style={{color:'var(--red)'}}> (Close Out applied: {psc.bonus+psc.closeOutBonus} total)</span>}
      </div>
      <div style={{fontSize:12, marginBottom:10, color: hasCloseOut && closeOutPlay?.canPlay ? 'var(--green)' : 'var(--text-muted)'}}>
        Team {defKey}: {hasCloseOut && closeOutPlay?.canPlay
          ? <strong>You have Close Out — play it before resolving!</strong>
          : 'No Close Out available.'}
      </div>
      <div style={{display:'flex', gap:8}}>
        {hasCloseOut && closeOutPlay?.canPlay && (
          <button className={styles.closeOutBtn} onClick={()=>onExecCard(defKey,'close_out',{})}>
            Play Close Out (−3)
          </button>
        )}
        <button className={styles.resolveBtn} onClick={onResolve}>▶ Resolve Shot Check</button>
      </div>
    </div>
  );
}
