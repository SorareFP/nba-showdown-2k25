import { SNAKE } from '../../game/engine.js';
import styles from './DraftPhase.module.css';

export default function DraftPhase({ game, setGame }) {
  const { draft, teamA, teamB } = game;
  const aS = teamA.starters, bS = teamB.starters;
  const done = aS.length === 5 && bS.length === 5;

  if (done) return <DraftDone game={game} setGame={setGame} />;

  const step = draft.step;
  const actTeamIdx = SNAKE[step];
  const actTeam = actTeamIdx === 0 ? 'A' : 'B';
  const actColor = actTeam === 'A' ? 'var(--orange)' : 'var(--blue)';
  const pool = actTeam === 'A' ? draft.aPool : draft.bPool;
  const slotNum = (actTeam === 'A' ? aS.length : bS.length) + 1;

  const prevOpp = actTeam === 'A' ? bS[bS.length - 1] : aS[aS.length - 1];

  const pick = (card) => {
    const g = JSON.parse(JSON.stringify(game));
    const d = g.draft;
    if (actTeam === 'A') {
      g.teamA.starters.push(card);
      d.aPool = d.aPool.filter(c => c.id !== card.id);
    } else {
      g.teamB.starters.push(card);
      d.bPool = d.bPool.filter(c => c.id !== card.id);
    }
    d.step++;
    if (g.teamA.starters.length === 5 && g.teamB.starters.length === 5) {
      g.offMatchups = { A: [0,1,2,3,4], B: [0,1,2,3,4] };
      // Clear benched markers
      ['A','B'].forEach(k => {
        const t = k === 'A' ? g.teamA : g.teamB;
        t.stats.forEach(ps => {
          const isStarter = t.starters.find(p => p.id === ps.id);
          if (!isStarter) { ps.hot = 0; ps.cold = 0; ps.minutes = Math.max(0, (ps.minutes||0) - 8); }
        });
      });
      g.phase = 'matchup_strats';
      g.log = [...g.log, { team: null, msg: 'Draft complete — Matchup Strategy Phase begins.' }];
    }
    setGame(g);
  };

  const prompt = step === 0
    ? `Team A — reveal your first player.`
    : actTeam === 'B'
      ? `Team B — respond to ${prevOpp?.name} (A). Choose your player ${slotNum}.`
      : `Team A — respond to ${prevOpp?.name} (B). Choose your player ${slotNum}.`;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3>Matchup Draft</h3>
        <div className={styles.stepBadge}>Pick {step + 1}/10 · A B B A A B B A A B</div>
        <div className={styles.turnBadge} style={{ background: actTeam === 'A' ? 'rgba(234,88,12,0.2)' : 'rgba(59,130,246,0.2)', color: actColor }}>
          Team {actTeam}'s pick
        </div>
      </div>

      {/* Board */}
      <div className={styles.board}>
        <div className={styles.colLabel} style={{ color: 'var(--orange)' }}>TEAM A</div>
        <div />
        <div className={styles.colLabel} style={{ color: 'var(--blue)', textAlign:'right' }}>TEAM B</div>
        {[0,1,2,3,4].map(i => (
          <>
            <SlotCell key={`a${i}`} player={aS[i]} side="A" stats={teamA.stats} />
            <div key={`vs${i}`} className={styles.vs}>vs</div>
            <SlotCell key={`b${i}`} player={bS[i]} side="B" stats={teamB.stats} align="right" />
          </>
        ))}
      </div>

      <p className={styles.prompt}>{prompt}</p>

      {/* Pool picker */}
      <div className={styles.poolLabel} style={{ color: actColor }}>
        Team {actTeam} — select player {slotNum}:
      </div>
      <div className={styles.pool}>
        {pool.map(p => {
          const ps = (actTeam === 'A' ? teamA : teamB).stats.find(s => s.id === p.id) || {};
          const min = ps.minutes || 0;
          const fat = min >= 12 ? -4 : min >= 8 ? -2 : 0;
          return (
            <button key={p.id} className={styles.pickBtn} onClick={() => pick(p)}>
              <div className={styles.pickName}>{p.name}{ps.hot > 0 ? ' 🔥' : ps.cold > 0 ? ' ❄️' : ''}</div>
              <div className={styles.pickSub}>
                S{p.speed} P{p.power} · ${p.salary}
                {fat < 0 && <span className={styles.fatWarn}> FAT{fat}({min}min)</span>}
                {fat === 0 && min > 0 && <span className={styles.minNote}> ({min}min)</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SlotCell({ player, side, stats, align }) {
  const ps = player ? (stats || []).find(s => s.id === player.id) || {} : null;
  const min = ps?.minutes || 0;
  const fat = min >= 12 ? -4 : min >= 8 ? -2 : 0;
  const borderSide = side === 'A' ? { borderLeft: '3px solid var(--orange)' } : { borderRight: '3px solid var(--blue)' };

  return (
    <div className={styles.slot} style={{ textAlign: align, ...borderSide }}>
      {player
        ? <>
            <div className={styles.slotName}>
              {player.name}
              {ps?.hot > 0 ? ' 🔥' : ps?.cold > 0 ? ' ❄️' : ''}
              {fat < 0 && <span className={styles.fatBadge}>FAT{fat}</span>}
            </div>
            <div className={styles.slotSub}>S{player.speed} P{player.power} · ${player.salary}</div>
          </>
        : <span className={styles.empty}>empty</span>
      }
    </div>
  );
}

function DraftDone({ game, setGame }) {
  const { teamA, teamB } = game;
  const aS = teamA.starters, bS = teamB.starters;

  const goToStrats = () => {
    const g = JSON.parse(JSON.stringify(game));
    g.phase = 'matchup_strats';
    setGame(g);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <h3>Draft Complete</h3>
        <div className={styles.turnBadge} style={{ background:'rgba(22,163,74,0.2)', color:'var(--green)' }}>✓ 5 vs 5</div>
      </div>
      <p style={{ fontSize:12, color:'var(--text-muted)', marginBottom:10 }}>
        Default matchups are positional (A1 vs B1, etc.). Adjust in the Matchup Strategy Phase.
      </p>
      <div className={styles.board}>
        <div className={styles.colLabel} style={{ color:'var(--orange)' }}>TEAM A OFFENSE</div>
        <div />
        <div className={styles.colLabel} style={{ color:'var(--blue)', textAlign:'right' }}>TEAM B OFFENSE</div>
        {[0,1,2,3,4].map(i => {
          const ap = aS[i], bp = bS[i];
          if (!ap || !bp) return null;
          const aAdv = calcAdvSimple(ap, bp);
          const bAdv = calcAdvSimple(bp, ap);
          return (
            <>
              <DoneCell key={`a${i}`} player={ap} adv={aAdv} />
              <div key={`icon${i}`} className={styles.vs}>⚔️</div>
              <DoneCell key={`b${i}`} player={bp} adv={bAdv} align="right" />
            </>
          );
        })}
      </div>
      <button className={styles.ctaBtn} onClick={goToStrats}>
        Continue to Strategy Phase →
      </button>
    </div>
  );
}

function DoneCell({ player, adv, align }) {
  const rollCol = adv.rollBonus > 0 ? 'var(--green)' : adv.hasPenalty ? 'var(--red)' : 'var(--text-muted)';
  return (
    <div className={styles.slot} style={{ textAlign: align, borderLeft: align ? 'none' : '3px solid var(--orange)', borderRight: align ? '3px solid var(--blue)' : 'none' }}>
      <div className={styles.slotName}>{player.name}</div>
      <div className={styles.slotSub}>S{player.speed} P{player.power}</div>
      <div style={{ fontSize:10, color:rollCol, marginTop:2 }}>
        Roll {adv.rollBonus > 0 ? '+' : ''}{adv.rollBonus}
      </div>
    </div>
  );
}

function calcAdvSimple(off, def) {
  const rawS = off.speed - def.speed, rawP = off.power - def.power;
  const db = Math.max(0, def.defBoost || 0);
  if (rawS <= 0 && rawP <= 0) {
    return { rollBonus: Math.max(rawS, rawP), hasPenalty: true };
  }
  return { rollBonus: Math.max(Math.max(0,rawS-db), Math.max(0,rawP-db)), hasPenalty: false };
}
