// ScoringPhase.jsx
import { useState } from 'react';
import { calcAdv, getTeam, getOpp, getPS, getFatigue } from '../../game/engine.js';
import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import styles from './ScoringPhase.module.css';

export default function ScoringPhase({ game, setGame, onRoll, onEndSection }) {
  const rA = game.rollResults.A || [], rB = game.rollResults.B || [];
  const allRolled = rA.length === 5 && rB.length === 5 && rA.every(r => r != null) && rB.every(r => r != null);
  const { scoringTurn, scoringPasses } = game;

  const rollAll = () => {
    let g = game;
    for (let i = 0; i < 5; i++) { if (!(g.rollResults.A||[])[i]) g = { ...g }; }
    // Just fire individual rolls
    for (let i = 0; i < 5; i++) { if (!(game.rollResults.A||[])[i]) onRoll('A', i); }
    for (let i = 0; i < 5; i++) { if (!(game.rollResults.B||[])[i]) onRoll('B', i); }
  };

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

  const turnCol = scoringTurn === 'A' ? 'var(--orange)' : 'var(--blue)';
  const rollingOpen = scoringPasses >= 99;

  return (
    <div className={styles.wrap}>
      {/* Strategy turn bar */}
      <div className={styles.turnBar}>
        <div>
          <span style={{ color: turnCol, fontWeight: 600 }}>Team {scoringTurn}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> — play a strategy card or pass</span>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <span style={{ fontSize:11, color:'var(--text-muted)' }}>Passes: {Math.min(scoringPasses,2)}/2</span>
          {!rollingOpen && <button className={styles.passBtn} onClick={passTurn}>Pass →</button>}
          {!allRolled && <button className={styles.rollAllBtn} onClick={rollAll}>🎲 Roll All</button>}
        </div>
      </div>

      {/* Pending shot check panel */}
      {game.pendingShotCheck && <PendingShotPanel game={game} setGame={setGame} />}

      {/* Roll grids */}
      <div className={styles.grids}>
        <TeamRolls game={game} teamKey="A" col="var(--orange)" onRoll={onRoll} rollingOpen={rollingOpen} />
        <TeamRolls game={game} teamKey="B" col="var(--blue)"   onRoll={onRoll} rollingOpen={rollingOpen} />
      </div>

      {/* Hands */}
      <HandPanel game={game} setGame={setGame} teamKey="A" />
      <HandPanel game={game} setGame={setGame} teamKey="B" />

      {allRolled && (
        <div className={styles.endBar}>
          <span style={{ color:'var(--orange)', fontWeight:600 }}>
            A: {(game.rollResults.A||[]).reduce((s,r)=>s+(r?.pts||0),0)} pts
          </span>
          <button className={styles.endBtn} onClick={onEndSection}>End Section →</button>
          <span style={{ color:'var(--blue)', fontWeight:600 }}>
            B: {(game.rollResults.B||[]).reduce((s,r)=>s+(r?.pts||0),0)} pts
          </span>
        </div>
      )}
    </div>
  );
}

function TeamRolls({ game, teamKey, col, onRoll, rollingOpen }) {
  const t = getTeam(game, teamKey);
  const opp = getOpp(game, teamKey);
  const rr = game.rollResults[teamKey] || [];
  const rolled = rr.filter(r => r != null).length;

  return (
    <div className={styles.teamBlock}>
      <div className={styles.teamHeader}>
        <span style={{ color: col, fontWeight: 700 }}>Team {teamKey}</span>
        <span style={{ fontSize:11, color:'var(--text-muted)' }}>{rolled}/5 rolled</span>
      </div>
      {t.starters.map((p, i) => {
        const res = rr[i];
        const defIdx = (game.offMatchups[teamKey] || [])[i] ?? i;
        const dp = opp.starters[defIdx];
        const adv = dp ? calcAdv(p, dp, game.tempEff[teamKey] || {}, i) : null;
        const ps = getPS(game, teamKey, p.id) || {};
        const fat = getFatigue(game, teamKey, i);
        const min = (game.teamA.stats.concat(game.teamB.stats)).find(s => s.id === p.id)?.minutes || 0;
        const blocked = game.blockedRolls?.[teamKey]?.[i];
        const sCol = adv ? (adv.speedAdv > 0 ? 'var(--green)' : adv.rawSpeedDiff < 0 ? 'var(--red)' : 'var(--text-dim)') : 'var(--text-dim)';
        const pCol = adv ? (adv.powerAdv > 0 ? 'var(--green)' : adv.rawPowerDiff < 0 ? 'var(--red)' : 'var(--text-dim)') : 'var(--text-dim)';
        const rollCol = adv ? (adv.rollBonus > 0 ? 'var(--green)' : adv.hasPenalty ? 'var(--red)' : 'var(--text-muted)') : 'var(--text-muted)';

        return (
          <div key={p.id} className={styles.playerRow}>
            <div className={styles.playerInfo}>
              <div className={styles.pName}>
                {p.name}
                {ps.hot > 0 && <span className={styles.hot}>🔥{ps.hot > 1 ? '×' + ps.hot : ''}</span>}
                {ps.cold > 0 && <span className={styles.cold}>❄️{ps.cold > 1 ? '×' + ps.cold : ''}</span>}
                {fat < 0 && <span className={styles.fatBadge}>FAT{fat}</span>}
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
                  <span style={{ color: sCol }}>Spd {p.speed}−{dp?.speed}{adv.db>0?`−db${adv.db}`:''} = <b>{adv.speedAdv>0?'+':''}{adv.speedAdv}</b></span>
                  <span style={{ color: pCol }}>Pwr {p.power}−{dp?.power}{adv.db>0?`−db${adv.db}`:''} = <b>{adv.powerAdv>0?'+':''}{adv.powerAdv}</b></span>
                  <span style={{ color: rollCol, fontWeight:600 }}>Roll {adv.rollBonus>0?'+':''}{adv.rollBonus}{adv.hasPenalty?' ⚠':''}vs {dp?.name}</span>
                </div>
              )}
            </div>
            <div className={styles.rollResult}>
              {blocked
                ? <div className={styles.blocked}>🏠 Blocked</div>
                : res != null
                  ? <div>
                      <div className={styles.dice}>🎲{res.die}{res.bonus!==0?(res.bonus>0?'+':'')+res.bonus:''}={res.finalRoll}{res.isTop?' ⭐':''}</div>
                      <div className={styles.pts} style={{ color: col }}>{res.pts}pts</div>
                      <div className={styles.statLine}>{res.reb}r {res.ast}a</div>
                    </div>
                  : (rollingOpen || true) && <button className={styles.rollBtn} style={{ background: col }} onClick={() => onRoll(teamKey, i)}>Roll</button>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HandPanel({ game, setGame, teamKey }) {
  const [open, setOpen] = useState(true);
  const t = getTeam(game, teamKey);
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const phase = game.phase;
  const isActiveTurn = game.scoringTurn === teamKey || game.scoringPasses >= 99;
  const playablePhases = isActiveTurn ? ['scoring','pre_roll','post_roll'] : [];

  return (
    <div className={styles.hand}>
      <button className={styles.handToggle} style={{ color: col }} onClick={() => setOpen(o => !o)}>
        Team {teamKey} Hand ({t.hand.length} cards) {open ? '▲' : '▼'}
      </button>
      {open && (
        <div className={styles.handCards}>
          {t.hand.length === 0 && <span className={styles.noCards}>Empty hand</span>}
          {t.hand.map((id, hi) => {
            const s = getStrat(id); if (!s) return null;
            const isReaction = s.phase === 'reaction';
            const playable = canPlayCard(game, teamKey, id);
            const canClick = playable.canPlay && (isReaction || playablePhases.includes(s.phase));
            return (
              <div key={`${id}-${hi}`}
                className={`${styles.stratCard} ${!canClick ? styles.dimStrat : ''} ${isReaction && playable.canPlay ? styles.reactionStrat : ''}`}
                style={{ borderLeftColor: s.color }}
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

function PendingShotPanel({ game, setGame }) {
  const { pendingShotCheck: psc } = game;
  if (!psc) return null;
  const offT = getTeam(game, psc.teamKey);
  const offP = offT.starters[psc.playerIdx];
  const defKey = psc.teamKey === 'A' ? 'B' : 'A';
  const defT = getTeam(game, defKey);
  const hasCloseOut = defT.hand.includes('close_out');

  const resolve = () => {
    // Import from engine would create circular dep — inline the resolve here
    const g = JSON.parse(JSON.stringify(game));
    const myT = getTeam(g, psc.teamKey);
    const player = myT.starters[psc.playerIdx];
    const ps = myT.stats.find(s => s.id === player?.id) || {};
    let bonus = psc.bonus || 0;
    if (psc.closeOutBonus) bonus += psc.closeOutBonus;
    const die = Math.floor(Math.random() * 20) + 1;
    let shotBonus = bonus;
    if (psc.type === '3pt') shotBonus += (player.threePtBoost || 0);
    if (psc.type === 'paint') shotBonus += (player.paintBoost || 0);
    if (psc.type === 'ft') shotBonus += 10;
    shotBonus += ((ps.hot||0) - (ps.cold||0)) * 2;
    const total = die + shotBonus;
    const hit = total >= player.shotLine;
    const pts = hit ? (psc.type === '3pt' ? 3 : psc.type === 'paint' ? 2 : 1) : 0;
    if (die <= 2) ps.cold = (ps.cold||0) + 1;
    else if (die >= 19) ps.hot = (ps.hot||0) + 1;
    if (hit) {
      myT.score += pts;
      if (psc.onHit === 'ast') myT.assists++;
    }
    if (psc.closeOutBonus && !hit) { ps.cold = (ps.cold||0) + 1; }
    const result = `${psc.cardLabel||psc.type}: 🎲${die}${shotBonus!==0?(shotBonus>0?'+':'')+shotBonus:''}=${total} vs ${player.shotLine} → ${hit ? pts+'pts ✓' : 'MISS'}${psc.closeOutBonus&&!hit?' — Close Out! ❄️':''}`;
    g.log = [...g.log, { team: psc.teamKey, msg: result }];
    g.pendingShotCheck = null;
    setGame(g);
  };

  return (
    <div className={styles.pendingPanel}>
      <div className={styles.pendingTitle}>⏸ Pending: {offP?.name} — {psc.cardLabel || psc.type.toUpperCase()}</div>
      <div className={styles.pendingSub}>
        {offP?.name} · {psc.type.toUpperCase()} check at +{psc.bonus}
        {psc.closeOutBonus ? <span style={{color:'var(--red)'}}> (Close Out: {psc.bonus+(psc.closeOutBonus||0)})</span> : ''}
      </div>
      <div className={styles.pendingNote} style={{ color: hasCloseOut ? 'var(--green)' : 'var(--text-muted)' }}>
        {hasCloseOut ? `Team ${defKey} has Close Out in hand — play it before resolving!` : `Team ${defKey}: no Close Out in hand.`}
      </div>
      <button className={styles.resolveBtn} onClick={resolve}>▶ Resolve Shot Check</button>
    </div>
  );
}

