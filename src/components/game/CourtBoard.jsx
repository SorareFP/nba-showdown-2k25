import { useState } from 'react';
import { calcAdv, getTeam, getOpp, getPS, getFatigue, SNAKE } from '../../game/engine.js';
import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import styles from './CourtBoard.module.css';
import { getPlayerImageUrl, getStratImagePath } from '../../game/cardImages.js';
import { useLightbox } from '../CardLightbox.jsx';

export default function CourtBoard({ game, setGame, onRoll, onEndSection, onExecCard, onResolve, onSpendAssist, onSpendRebound }) {
  const [modal, setModal] = useState(null);

  const openModal = (config) => new Promise(res => setModal({ ...config, resolve: res }));
  const closeModal = (val) => { const r = modal?.resolve; setModal(null); r?.(val); };

  const handleExecCard = async (teamKey, cardId, baseOpts = {}) => {
    const opts = await buildOpts(game, teamKey, cardId, baseOpts, openModal);
    if (opts === null) return;
    onExecCard(teamKey, cardId, opts);
  };

  return (
    <div className={styles.wrap}>
      <PhaseBar game={game} setGame={setGame} onEndSection={onEndSection} />

      <div className={styles.courtLayout}>
        <HandPanel game={game} teamKey="A" onExecCard={handleExecCard} />

        <div className={styles.court}>
          <CourtMarkings />
          <div className={styles.teamLabelA}>TEAM A</div>
          <div className={styles.teamLabelB}>TEAM B</div>
          <div className={styles.matchups}>
            {[0,1,2,3,4].map(i => (
              <MatchupRow key={i} idx={i} game={game} setGame={setGame}
                onRoll={onRoll} onExecCard={handleExecCard} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound} />
            ))}
          </div>
          <TrackPanel game={game} side="left" />
          <TrackPanel game={game} side="right" />
        </div>

        <HandPanel game={game} teamKey="B" onExecCard={handleExecCard} />
      </div>

      {game.pendingShotCheck && (
        <PendingBanner game={game} onResolve={onResolve} onExecCard={handleExecCard} />
      )}

      {modal && <SelectModal modal={modal} game={game} onClose={closeModal} />}
    </div>
  );
}

async function buildOpts(game, teamKey, cardId, base, openModal) {
  const opts = { ...base };
  const myT = getTeam(game, teamKey);
  const oppT = getOpp(game, teamKey);
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const rolls = game.rollResults[teamKey] || [];
  const offMatchups = game.offMatchups[teamKey] || [];
  const defenders = oppT.starters;

  // Helper: pick from filtered eligible list, map back to original starter index
  async function pickFiltered(eligible, label, tKey = teamKey, infoFn) {
    if (eligible.length === 0) return null;
    const display = eligible.map(({ p, origIdx }, i) => {
      const info = infoFn ? infoFn(p, origIdx) : '';
      return info ? { ...p, name: `${p.name} ${info}` } : p;
    });
    const pick = await openModal({ teamKey: tKey, cardId, players: display, label });
    if (pick === null) return null;
    return eligible[pick].origIdx;
  }

  // Helper: build eligible list from starters with filter
  function filterStarters(starters, filterFn) {
    return starters.map((p, i) => ({ p, origIdx: i })).filter(({ p, origIdx }) => filterFn(p, origIdx));
  }

  // ── Cards that pick from filtered MY starters ────────────────────────────
  const filteredPlayerCards = [
    'heat_check', 'flare_screen', 'burst_of_momentum', 'drive_the_lane',
    'ghost_screen', 'bully_ball', 'and_one', 'rimshaker', 'uncontested_layup',
    'back_to_basket', 'putback_dunk', 'chip_on_shoulder', 'defensive_stopper',
    'second_wind', 'crowd_favorite', 'delayed_slip', 'energy_injection',
  ];

  // Cards that show ALL my starters (no filtering needed)
  const unfilteredPlayerCards = [
    'green_light', 'you_stand_over_there', 'catch_and_shoot', 'elevator_doors',
    'pin_down_screen', 'power_move', 'from_way_downtown', 'cross_court_dime',
    'rebound_tap_out',
  ];

  if (unfilteredPlayerCards.includes(cardId)) {
    const idx = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select target player' });
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  if (filteredPlayerCards.includes(cardId)) {
    let eligible, label;

    switch (cardId) {
      case 'heat_check': {
        eligible = filterStarters(myT.starters, (p, i) => rolls[i]?.isTop);
        label = 'Select player who hit top tier';
        break;
      }
      case 'flare_screen': {
        eligible = filterStarters(myT.starters, (p, i) => rolls[i]?.die === 20);
        label = 'Select player who rolled natural 20';
        break;
      }
      case 'burst_of_momentum': {
        eligible = filterStarters(myT.starters, (p, i) => rolls[i]?.isTop && (rolls[i]?.pts || 0) >= 5);
        label = 'Select player (top tier + 5pts)';
        break;
      }
      case 'drive_the_lane': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
        });
        label = 'Select player with Speed advantage';
        break;
      }
      case 'ghost_screen': {
        eligible = filterStarters(myT.starters, (p, i) => {
          if (rolls[i] != null) return false; // already rolled
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          if (!dp) return false;
          const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
          return a.hasPenalty && p.speed >= 12;
        });
        label = 'Select Speed 12+ player with penalty (not yet rolled)';
        break;
      }
      case 'bully_ball': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).powerAdv > 0;
        });
        label = 'Select player with Power advantage';
        break;
      }
      case 'and_one': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          if (!dp) return false;
          const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
          return Math.max(a.speedAdv, a.powerAdv) >= 3;
        });
        label = 'Select player with Spd or Pwr advantage ≥3';
        break;
      }
      case 'rimshaker': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const ps = getPS(game, teamKey, p.id) || {};
          return p.power >= 13 && (ps.hot || 0) > 0;
        });
        label = 'Select Power 13+ player with hot marker';
        break;
      }
      case 'uncontested_layup': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          if (!dp) return false;
          const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
          return a.speedAdv >= 2 && a.powerAdv >= 2;
        });
        label = 'Select player with +2 Spd AND +2 Pwr advantage';
        break;
      }
      case 'back_to_basket': {
        eligible = filterStarters(myT.starters, (p) => p.power >= 13 && (p.paintBoost || 0) > 0);
        label = 'Select Power 13+ player with Paint Bonus';
        break;
      }
      case 'putback_dunk': {
        eligible = filterStarters(myT.starters, (p) => p.power >= 14);
        label = 'Select player with Power 14+';
        break;
      }
      case 'chip_on_shoulder': {
        eligible = filterStarters(myT.starters, (p) => (p.salary || 0) <= 250);
        label = 'Select player with salary ≤$250';
        break;
      }
      case 'defensive_stopper': {
        eligible = filterStarters(myT.starters, (p) => {
          const ps = getPS(game, teamKey, p.id);
          return (ps?.minutes || 0) === 0;
        });
        label = 'Select player who was benched last segment';
        break;
      }
      case 'second_wind': {
        eligible = filterStarters(myT.starters, (_, i) => getFatigue(game, teamKey, i) < 0);
        label = 'Select fatigued player';
        break;
      }
      case 'crowd_favorite': {
        eligible = filterStarters(myT.starters, (p) => (p.salary || 0) <= 350);
        label = 'Select player with salary ≤$350';
        break;
      }
      case 'delayed_slip': {
        eligible = filterStarters(myT.starters, (p, i) => {
          if ((p.speed || 0) < 12 || (p.power || 0) < 10) return false;
          const di = offMatchups[i] ?? i;
          const dp = defenders[di];
          if (!dp) return false;
          const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
          return a.rollBonus <= 0 && !a.hasPenalty;
        });
        label = 'Select Speed 12+/Power 10+ player (no matchup adv)';
        break;
      }
      case 'energy_injection': {
        eligible = filterStarters(myT.starters, (p) => (p.salary || 0) < 400);
        label = 'Select first player (salary < $400)';
        break;
      }
      default:
        eligible = filterStarters(myT.starters, () => true);
        label = 'Select target player';
    }

    if (eligible.length === 0) { alert('No eligible players for this card.'); return null; }
    const idx = await pickFiltered(eligible, label);
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Shot check cards: offer to spend 1 AST for +1 bonus ─────────────────
  const shotCheckCards = ['pin_down_screen', 'catch_and_shoot', 'elevator_doors', 'heat_check',
    'flare_screen', 'from_way_downtown', 'back_to_basket', 'rimshaker'];
  if (shotCheckCards.includes(cardId)) {
    const ast = myT.assists;
    if (ast >= 1) {
      const spend = confirm(`Spend 1 Assist for +1 to ${cardId.replace(/_/g, ' ')} shot check? (${ast} AST available)`);
      if (spend) {
        opts.spendAssistBoost = true;
      }
    }
  }

  // ── Pin Down Screen: discard a card from hand ───────────────────────────
  if (cardId === 'pin_down_screen') {
    const handWithoutThis = myT.hand.filter(id => id !== 'pin_down_screen');
    if (handWithoutThis.length === 0) { alert('No cards to discard.'); return null; }
    const discardPlayers = handWithoutThis.map((id, i) => ({ id, name: id.replace(/_/g, ' '), origIdx: i }));
    const discardDisplay = discardPlayers.map(d => ({ ...d, name: d.name }));
    const pick = await openModal({ teamKey, cardId, players: discardDisplay, label: 'Discard a card for Pin-Down Screen' });
    if (pick === null) return null;
    opts.discardId = handWithoutThis[pick];
  }

  // ── Overhelp: pick YOUR player to boost after opponent's switch ─────────
  if (cardId === 'overhelp') {
    const idx = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select your player to get +2 roll bonus' });
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Burned on the Switch: auto-detect the switched players ─────────────
  if (cardId === 'burned_switch') {
    const lc = game.lastMatchupCard;
    if (!lc) { alert('No switch to react to.'); return null; }
    // The switch was on the opponent's offense — pick which of YOUR players benefited
    // Show your starters and ask who got the weaker defender after the switch
    const idx = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select your player who got a weaker defender' });
    if (idx === null) return null;
    opts.playerIdx = idx;
    // Track original and new defender from the switch
    opts.originalDefIdx = lc.opts.origD1;
    opts.newDefIdx = lc.opts.origD2;
  }

  // ── Cold Spell: target OPPONENT who rolled natural 1 or 2 ──────────────
  if (cardId === 'cold_spell') {
    const oppRolls = game.rollResults[oppKey] || [];
    const eligible = filterStarters(oppT.starters, (p, i) => {
      const r = oppRolls[i];
      return r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed;
    });
    if (eligible.length === 0) { alert('No opponent rolled a natural 1 or 2.'); return null; }
    const idx = await pickFiltered(eligible, 'Apply Cold Spell to:', oppKey,
      (p, oi) => `(rolled ${oppRolls[oi]?.die})`);
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Dogged: target fatigued OPPONENT ───────────────────────────────────
  if (cardId === 'dogged') {
    const eligible = filterStarters(oppT.starters, (_, i) => getFatigue(game, oppKey, i) < 0);
    if (eligible.length === 0) { alert('No fatigued opponent players.'); return null; }
    const idx = await pickFiltered(eligible, 'Target fatigued opponent:', oppKey,
      (p, oi) => `(FAT ${getFatigue(game, oppKey, oi)})`);
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Go Under: let player choose which offensive player gets 3PT check ──
  if (cardId === 'go_under') {
    const lc = game.lastMatchupCard;
    if (lc) {
      const offT = getTeam(game, lc.teamKey);
      const p1 = offT.starters[lc.opts.swapSlot1];
      const p2 = offT.starters[lc.opts.swapSlot2];
      const choices = [
        { p: p1, origIdx: lc.opts.swapSlot1 },
        { p: p2, origIdx: lc.opts.swapSlot2 },
      ].filter(({ p }) => p != null);
      if (choices.length > 1) {
        const display = choices.map(({ p }) => ({ ...p, name: `${p.name} (3PT check)` }));
        const pick = await openModal({ teamKey: lc.teamKey, cardId, players: display, label: 'Which player takes the 3PT check?' });
        if (pick === null) return null;
        opts.goUnderTarget = choices[pick].origIdx;
      } else if (choices.length === 1) {
        opts.goUnderTarget = choices[0].origIdx;
      }
    }
  }

  // ── Two-player cards ───────────────────────────────────────────────────
  if (cardId === 'stagger_action') {
    const idx2 = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select second player' });
    if (idx2 === null) return null;
    opts.player2Idx = idx2;
  }
  if (cardId === 'energy_injection') {
    // Both players must have salary < $400 — filter the second pick
    const cheapPlayers = filterStarters(myT.starters, (p, i) => (p.salary || 0) < 400 && i !== opts.playerIdx);
    if (cheapPlayers.length === 0) { alert('No second player with salary < $400.'); return null; }
    const idx2 = await pickFiltered(cheapPlayers, 'Select second player (salary < $400)');
    if (idx2 === null) return null;
    opts.player2Idx = idx2;
  }

  // ── High Screen & Roll ─────────────────────────────────────────────────
  if (cardId === 'high_screen_roll') {
    const fmtAdv = (a) => {
      const rb = a.rollBonus > 0 ? `+${a.rollBonus}` : a.hasPenalty ? `${a.rollBonus}` : '0';
      const sC = a.speedAdv > 0 ? '#4ADE80' : a.speedAdv < 0 ? '#F87171' : '#94A3B8';
      const pC = a.powerAdv > 0 ? '#4ADE80' : a.powerAdv < 0 ? '#F87171' : '#94A3B8';
      return `Spd ${a.speedAdv > 0 ? '+' : ''}${a.speedAdv} · Pwr ${a.powerAdv > 0 ? '+' : ''}${a.powerAdv} → Roll ${rb}`;
    };
    const matchupInfo = myT.starters.map((p, i) => {
      const defIdx = offMatchups[i];
      const def = defenders[defIdx];
      if (!def) return '';
      const a = calcAdv(p, def, game.tempEff?.[teamKey] || {}, i);
      return `vs ${def.name}  |  ${fmtAdv(a)}`;
    });
    const s1 = await openModal({ teamKey, cardId, players: myT.starters, label: '⚡ High Screen & Roll — Pick player 1 to swap', extraInfo: matchupInfo });
    if (s1 === null) return null;
    const swapInfo = myT.starters.map((p, i) => {
      if (i === s1) return '⬆ (selected above)';
      const defIdxI = offMatchups[i];
      const defIdxS1 = offMatchups[s1];
      const defForI = defenders[defIdxI];
      const defForS1 = defenders[defIdxS1];
      if (!defForI || !defForS1) return '';
      const newAdvI = calcAdv(p, defForS1, game.tempEff?.[teamKey] || {}, i);
      const newAdvS1 = calcAdv(myT.starters[s1], defForI, game.tempEff?.[teamKey] || {}, s1);
      const curAdvI = calcAdv(p, defForI, game.tempEff?.[teamKey] || {}, i);
      const curAdvS1 = calcAdv(myT.starters[s1], defForS1, game.tempEff?.[teamKey] || {}, s1);
      const fmtDelta = (n, o) => { const d = n - o; return d > 0 ? `▲${d}` : d < 0 ? `▼${Math.abs(d)}` : '—'; };
      return `If swap → ${p.name}: Roll ${newAdvI.rollBonus > 0 ? '+' : ''}${newAdvI.rollBonus} (${fmtDelta(newAdvI.rollBonus, curAdvI.rollBonus)})  |  ${myT.starters[s1].name}: Roll ${newAdvS1.rollBonus > 0 ? '+' : ''}${newAdvS1.rollBonus} (${fmtDelta(newAdvS1.rollBonus, curAdvS1.rollBonus)})`;
    });
    const s2 = await openModal({ teamKey, cardId, players: myT.starters, label: `⚡ Pick player 2 to swap with ${myT.starters[s1]?.name}`, extraInfo: swapInfo });
    if (s2 === null) return null;
    opts.swapSlot1 = s1; opts.swapSlot2 = s2;
  }

  // ── This Is My House ───────────────────────────────────────────────────
  if (cardId === 'this_is_my_house') {
    const slot = await openModal({ teamKey: oppKey, cardId, players: oppT.starters, label: 'Block which opponent?' });
    if (slot === null) return null;
    opts.offSlot = slot;
  }

  // ── Offensive Board Mastery: pick which player gets a second roll ───────
  if (cardId === 'offensive_board') {
    const idx = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select player for second scoring roll (−2)' });
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Veer Switch: defender reassigns the two swapped slots ─────────────
  if (cardId === 'veer_switch') {
    const lc = game.lastMatchupCard;
    if (!lc) { alert('No switch card to react to.'); return null; }
    const offT = getTeam(game, lc.teamKey);
    const p1 = offT.starters[lc.opts.swapSlot1];
    const p2 = offT.starters[lc.opts.swapSlot2];
    // Pick new defender for slot 1
    const fmtVeer = (a) => {
      const sA = a.speedAdv > 0 ? `+${a.speedAdv}` : `${a.speedAdv}`;
      const pA = a.powerAdv > 0 ? `+${a.powerAdv}` : `${a.powerAdv}`;
      const rollStr = a.rollBonus > 0 ? `+${a.rollBonus}` : a.hasPenalty ? `${a.rollBonus}` : '0';
      return `Opp: Spd ${sA} · Pwr ${pA} → Roll ${rollStr}`;
    };
    const defInfo1 = myT.starters.map((def, di) => {
      const a = calcAdv(p1, def, game.tempEff?.[lc.teamKey] || {}, lc.opts.swapSlot1);
      return fmtVeer(a);
    });
    const nd1 = await openModal({ teamKey, cardId, players: myT.starters, label: `🛡 Veer Switch — Who guards ${p1?.name}?`, extraInfo: defInfo1 });
    if (nd1 === null) return null;
    // Pick new defender for slot 2
    const defInfo2 = myT.starters.map((def, di) => {
      if (di === nd1) return '(already assigned above)';
      const a = calcAdv(p2, def, game.tempEff?.[lc.teamKey] || {}, lc.opts.swapSlot2);
      return fmtVeer(a);
    });
    const nd2 = await openModal({ teamKey, cardId, players: myT.starters, label: `🛡 Veer Switch — Who guards ${p2?.name}?`, extraInfo: defInfo2 });
    if (nd2 === null) return null;
    opts.newDefender1 = nd1;
    opts.newDefender2 = nd2;
  }

  // ── Switch Everything: show roll effects for each assignment ────────────
  if (cardId === 'switch_everything') {
    const assigns = [];
    const usedDefenders = [];
    for (let i = 0; i < 5; i++) {
      const oppPlayer = oppT.starters[i];
      const assigned = assigns.map((di, oi) => `${oppT.starters[oi]?.name} ← ${myT.starters[di]?.name}`).join(' | ');
      const availInfo = myT.starters.map((def, di) => {
        if (usedDefenders.includes(di)) return '(already assigned)';
        const a = calcAdv(oppPlayer, def, game.tempEff?.[oppKey] || {}, i);
        const sA = a.speedAdv > 0 ? `+${a.speedAdv}` : `${a.speedAdv}`;
        const pA = a.powerAdv > 0 ? `+${a.powerAdv}` : `${a.powerAdv}`;
        const rollStr = a.rollBonus > 0 ? `+${a.rollBonus}` : a.hasPenalty ? `${a.rollBonus}` : '0';
        return `Opp: Spd ${sA} · Pwr ${pA} → Roll ${rollStr}`;
      });
      const progress = i > 0 ? `\n(${i}/5 assigned: ${assigned})` : '';
      const di = await openModal({ teamKey, cardId, players: myT.starters, label: `🛡 Switch Everything (${i+1}/5) — Who guards ${oppPlayer?.name}?`, extraInfo: availInfo });
      if (di === null) return null;
      assigns.push(di);
      usedDefenders.push(di);
    }
    // Review summary before confirming
    const reviewLines = assigns.map((di, oi) => {
      const opp = oppT.starters[oi];
      const def = myT.starters[di];
      const a = calcAdv(opp, def, game.tempEff?.[oppKey] || {}, oi);
      const rollStr = a.rollBonus > 0 ? `+${a.rollBonus}` : a.hasPenalty ? `${a.rollBonus}` : '0';
      return `${opp?.name} ← ${def?.name} (Opp Roll ${rollStr})`;
    });
    const ok = confirm(`Switch Everything — Review assignments:\n\n${reviewLines.join('\n')}\n\n⚠️ All opponent advantages will be DOUBLED.\n\nConfirm?`);
    if (!ok) return null;
    opts.assignments = assigns;
  }

  return opts;
}

function SelectModal({ modal, game, onClose }) {
  const { teamKey, players, label, extraInfo } = modal;
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const stats = getTeam(game, teamKey).stats;
  return (
    <div className={styles.overlay} onClick={() => onClose(null)}>
      <div className={styles.modalBox} onClick={e => e.stopPropagation()}>
        <div className={styles.modalTitle} style={{ color: col }}>{label}</div>
        <div className={styles.modalList}>
          {players.map((p, i) => {
            const ps = stats?.find(s => s.id === p.id) || {};
            const min = ps.minutes || 0;
            const fat = min >= 12 ? -4 : min >= 8 ? -2 : 0;
            const boosts = [
              p.threePtBoost ? `3PT${p.threePtBoost>0?'+':''}${p.threePtBoost}` : '',
              p.paintBoost   ? `Paint${p.paintBoost>0?'+':''}${p.paintBoost}` : '',
              p.defBoost     ? `Def${p.defBoost>0?'+':''}${p.defBoost}` : '',
            ].filter(Boolean).join(' · ');
            const extra = extraInfo?.[i];
            return (
              <button key={p.id} className={styles.modalBtn} style={{ borderLeftColor: col }} onClick={() => onClose(i)}>
                <div className={styles.mName}>{p.name}{ps.hot>0?' 🔥':''}{ps.cold>0?' ❄️':''}{fat<0&&<span className={styles.fatTag}> FAT{fat}</span>}</div>
                <div className={styles.mSub}>S{p.speed} · P{p.power} · Line {p.shotLine}{boosts&&` · ${boosts}`}{min>0&&` · ${min}min`}</div>
                {extra && <div className={styles.mExtra}>{extra}</div>}
              </button>
            );
          })}
        </div>
        <button className={styles.modalCancel} onClick={() => onClose(null)}>Cancel</button>
      </div>
    </div>
  );
}

function PhaseBar({ game, setGame, onEndSection }) {
  const { phase, quarter, section, matchupTurn, matchupPasses, scoringTurn, scoringPasses } = game;
  const rA = game.rollResults.A || [], rB = game.rollResults.B || [];
  // A player is "done" if they have a roll result OR they are blocked
  const isDone = (rr, blocked, i) => rr[i] != null || (blocked?.[i] === true);
  const bA = game.blockedRolls?.A || {}, bB = game.blockedRolls?.B || {};
  const allRolled = [0,1,2,3,4].every(i => isDone(rA,bA,i)) && [0,1,2,3,4].every(i => isDone(rB,bB,i));
  const rollingOpen = scoringPasses >= 99;

  const pass = () => {
    const g = JSON.parse(JSON.stringify(game));
    if (phase === 'matchup_strats') {
      g.matchupPasses++;
      if (g.matchupPasses >= 2) { g.phase='scoring'; g.rollResults={A:[],B:[]}; g.log=[...g.log,{team:null,msg:'Both passed — Scoring Phase!'}]; }
      else { const p=g.matchupTurn; g.matchupTurn=p==='A'?'B':'A'; g.log=[...g.log,{team:p,msg:'Passed.'}]; }
    } else {
      g.scoringPasses++;
      if (g.scoringPasses >= 2) { g.scoringPasses=99; g.log=[...g.log,{team:null,msg:'Both passed — rolling begins!'}]; }
      else { const p=g.scoringTurn; g.scoringTurn=p==='A'?'B':'A'; g.log=[...g.log,{team:p,msg:'Passed scoring turn.'}]; }
    }
    setGame(g);
  };
  const lock = () => {
    const g=JSON.parse(JSON.stringify(game));
    g.phase='scoring';g.rollResults={A:[],B:[]};
    g.log=[...g.log,{team:null,msg:`Q${g.quarter} Sec ${g.section} — Scoring Phase!`}];
    setGame(g);
  };

  if (phase === 'draft') {
    const step = game.draft.step;
    const actTeam = SNAKE[Math.min(step,9)]===0?'A':'B';
    const done = game.teamA.starters.length===5&&game.teamB.starters.length===5;
    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Draft</span>
          <span className={styles.phaseSub}>Pick {step+1}/10 · A B B A A B B A A B</span>
        </div>
        {done ? <button className={styles.ctaBtn} onClick={lock}>Continue →</button>
               : <span style={{color:actTeam==='A'?'var(--orange)':'var(--blue)',fontWeight:700}}>Team {actTeam}'s pick</span>}
      </div>
    );
  }
  if (phase === 'matchup_strats') {
    const col = matchupTurn==='A'?'var(--orange)':'var(--blue)';
    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Matchup Strategy</span>
          <span className={styles.phaseSub}>Play a card or pass twice to start scoring</span>
        </div>
        <div className={styles.phaseCtrls}>
          <span style={{color:col,fontWeight:600}}>Team {matchupTurn}</span>
          <span className={styles.passCount}>{matchupPasses}/2 passes</span>
          <button className={styles.passBtn} onClick={pass}>Pass →</button>
          <button className={styles.ctaBtn} onClick={lock}>Lock → Scoring</button>
        </div>
      </div>
    );
  }
  if (phase === 'scoring') {
    const col = scoringTurn==='A'?'var(--orange)':'var(--blue)';
    const segA = rA.reduce((s,r)=>s+(r?.pts||0),0), segB = rB.reduce((s,r)=>s+(r?.pts||0),0);
    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Scoring</span>
          {!rollingOpen
            ? <span className={styles.phaseSub} style={{color:col}}>Team {scoringTurn} strategy turn · {Math.min(scoringPasses,2)}/2 passes</span>
            : <span className={styles.phaseSub} style={{color:'var(--green)'}}>All players may roll</span>}
        </div>
        <div className={styles.phaseCtrls}>
          {(segA>0||segB>0) && <span className={styles.segScore}><span style={{color:'var(--orange)'}}>A {segA}</span>–<span style={{color:'var(--blue)'}}>{segB} B</span></span>}
          {!rollingOpen && <button className={styles.passBtn} onClick={pass}>Pass →</button>}
          {allRolled && !game.pendingShotCheck && <button className={styles.ctaBtn} onClick={onEndSection}>End Section →</button>}
        </div>
      </div>
    );
  }
  return null;
}

function MatchupRow({ idx, game, setGame, onRoll, onExecCard, onSpendAssist, onSpendRebound }) {
  if (game.phase === 'draft') return <DraftRow idx={idx} game={game} setGame={setGame} />;
  const ap=game.teamA.starters[idx], bp=game.teamB.starters[idx];
  if (!ap||!bp) return <div className={styles.emptyRow}/>;
  const aDefIdx=game.offMatchups.A[idx], bDefIdx=game.offMatchups.B[idx];
  const aDef=game.teamB.starters[aDefIdx], bDef=game.teamA.starters[bDefIdx];
  return (
    <div className={styles.matchupRow}>
      <PlayerSlot player={ap} ps={getPS(game,'A',ap.id)||{}} adv={aDef?calcAdv(ap,aDef,game.tempEff?.A||{},idx,game.tempDefEff?.B,aDefIdx):null}
        fat={getFatigue(game,'A',idx)} result={(game.rollResults.A||[])[idx]} blocked={game.blockedRolls?.A?.[idx]}
        teamKey="A" idx={idx} phase={game.phase} game={game}
        defPlayer={aDef} defSelect={game.teamB.starters} defIdx={aDefIdx}
        onDefChange={di=>{const g=JSON.parse(JSON.stringify(game));g.offMatchups.A[idx]=di;setGame(g);}}
        onRoll={()=>onRoll('A',idx)} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound} />
      <div className={styles.connector}>
        <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
      </div>
      <PlayerSlot player={bp} ps={getPS(game,'B',bp.id)||{}} adv={bDef?calcAdv(bp,bDef,game.tempEff?.B||{},idx,game.tempDefEff?.A,bDefIdx):null}
        fat={getFatigue(game,'B',idx)} result={(game.rollResults.B||[])[idx]} blocked={game.blockedRolls?.B?.[idx]}
        teamKey="B" idx={idx} phase={game.phase} game={game}
        defPlayer={bDef} defSelect={game.teamA.starters} defIdx={bDefIdx}
        onDefChange={di=>{const g=JSON.parse(JSON.stringify(game));g.offMatchups.B[idx]=di;setGame(g);}}
        onRoll={()=>onRoll('B',idx)} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound} />
    </div>
  );
}

function DraftRow({ idx, game, setGame }) {
  const { draft, teamA, teamB } = game;
  const aS=teamA.starters, bS=teamB.starters;
  const actTeam = SNAKE[Math.min(draft.step,9)]===0?'A':'B';
  const done = aS.length===5&&bS.length===5;
  const isNextA = actTeam==='A'&&aS.length===idx&&!done;
  const isNextB = actTeam==='B'&&bS.length===idx&&!done;

  const pick = (card, team) => {
    const g=JSON.parse(JSON.stringify(game));
    const d=g.draft;
    if(team==='A'){g.teamA.starters.push(card);d.aPool=d.aPool.filter(c=>c.id!==card.id);}
    else{g.teamB.starters.push(card);d.bPool=d.bPool.filter(c=>c.id!==card.id);}
    d.step++;
    if(g.teamA.starters.length===5&&g.teamB.starters.length===5){
      g.offMatchups={A:[0,1,2,3,4],B:[0,1,2,3,4]};
      ['A','B'].forEach(k=>{const t=k==='A'?g.teamA:g.teamB;t.stats.forEach(ps=>{if(!t.starters.find(p=>p.id===ps.id)){ps.hot=0;ps.cold=0;ps.minutes=Math.max(0,(ps.minutes||0)-8);}});});
      g.phase='matchup_strats';
      g.log=[...g.log,{team:null,msg:'Draft complete — Matchup Strategy Phase.'}];
    }
    setGame(g);
  };

  return (
    <div className={styles.matchupRow}>
      <div className={styles.draftCell}>
        {aS[idx] ? <PlacedCard player={aS[idx]} stats={teamA.stats} col="var(--orange)"/>
          : isNextA ? <PickList pool={draft.aPool} stats={teamA.stats} onPick={c=>pick(c,'A')} col="var(--orange)" oppStarters={bS} myStarters={aS} slotIdx={idx}/>
          : <EmptySlot idx={idx} col="var(--orange)"/>}
      </div>
      <div className={styles.connector}>
        <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
      </div>
      <div className={styles.draftCell}>
        {bS[idx] ? <PlacedCard player={bS[idx]} stats={teamB.stats} col="var(--blue)"/>
          : isNextB ? <PickList pool={draft.bPool} stats={teamB.stats} onPick={c=>pick(c,'B')} col="var(--blue)" oppStarters={aS} myStarters={bS} slotIdx={idx}/>
          : <EmptySlot idx={idx} col="var(--blue)"/>}
      </div>
    </div>
  );
}

function PlacedCard({ player, stats, col }) {
  const ps=stats?.find(s=>s.id===player.id)||{};
  const min=ps.minutes||0,fat=min>=12?-4:min>=8?-2:0;
  const boosts=[
    player.threePtBoost?`3PT${player.threePtBoost>0?'+':''}${player.threePtBoost}`:'',
    player.paintBoost?`Paint${player.paintBoost>0?'+':''}${player.paintBoost}`:'',
    player.defBoost?`Def${player.defBoost>0?'+':''}${player.defBoost}`:'',
  ].filter(Boolean);
  const pImgUrl = getPlayerImageUrl(player.id);
  return (
    <div className={styles.placedCard} style={{borderColor:col}}>
      {pImgUrl && <img src={pImgUrl} alt={player.name} className={styles.placedArt} onError={e=>e.target.style.display='none'} />}
      <div className={styles.placedName} style={{color:col}}>{player.name}{ps.hot>0?' 🔥':ps.cold>0?' ❄️':''}{fat<0&&<span className={styles.fatTag}> FAT{fat}</span>}</div>
      <div className={styles.placedMeta}>S{player.speed} · P{player.power} · <span style={{color:'#60A5FA'}}>${player.salary}</span>{boosts.length>0&&' · '+boosts.join(' ')}</div>
    </div>
  );
}

function PickList({ pool, stats, onPick, col, oppStarters = [], myStarters = [], slotIdx }) {
  const [q,setQ]=useState('');
  const filtered=pool.filter(p=>!q||p.name.toLowerCase().includes(q.toLowerCase()));

  // Compute matchup preview: what would this player's offense look like vs the opponent at same slot,
  // and what would the opponent's offense look like against this player on defense
  const getMatchupPreview = (candidate) => {
    const opp = oppStarters[slotIdx]; // opponent at same slot (default matchup)
    if (!opp) return null;
    // Candidate on offense vs opponent on defense
    const offAdv = calcAdv(candidate, opp, {}, slotIdx);
    // Opponent on offense vs candidate on defense
    const defAdv = calcAdv(opp, candidate, {}, slotIdx);
    return { offAdv, defAdv, oppName: opp.name };
  };

  return (
    <div className={styles.pickList} style={{borderColor:col+'80'}}>
      <div className={styles.pickLabel} style={{color:col}}>▼ Pick player</div>
      <input className={styles.pickSearch} placeholder="Filter…" value={q} onChange={e=>setQ(e.target.value)} />
      <div className={styles.pickScroll}>
        {filtered.map(p=>{
          const ps=stats?.find(s=>s.id===p.id)||{};
          const min=ps.minutes||0,fat=min>=12?-4:min>=8?-2:0;
          const boosts=[
            p.threePtBoost?`3PT${p.threePtBoost>0?'+':''}${p.threePtBoost}`:'',
            p.paintBoost?`Paint${p.paintBoost>0?'+':''}${p.paintBoost}`:'',
            p.defBoost?`Def${p.defBoost>0?'+':''}${p.defBoost}`:'',
          ].filter(Boolean).join(' ');
          const preview = getMatchupPreview(p);
          return (
            <button key={p.id} className={styles.pickItem} onClick={()=>onPick(p)}>
              <span className={styles.pickName}>{p.name}{ps.hot>0?' 🔥':ps.cold>0?' ❄️':''}</span>
              <span className={styles.pickMeta}>S{p.speed} P{p.power}{boosts&&' · '+boosts}{fat<0?` FAT${fat}`:min>0?` ${min}m`:''}</span>
              {preview && (
                <span className={styles.pickMatchup}>
                  vs {preview.oppName}: Off <span style={{color:preview.offAdv.rollBonus>0?'#4ADE80':preview.offAdv.hasPenalty?'#F87171':'#94A3B8'}}>{preview.offAdv.rollBonus>0?'+':''}{preview.offAdv.rollBonus}</span>
                  {' · '}Opp Off <span style={{color:preview.defAdv.rollBonus>0?'#F87171':preview.defAdv.hasPenalty?'#4ADE80':'#94A3B8'}}>{preview.defAdv.rollBonus>0?'+':''}{preview.defAdv.rollBonus}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function EmptySlot({ idx, col }) {
  return <div className={styles.emptySlot} style={{borderColor:col+'30'}}><span style={{color:col+'50',fontSize:11}}>Slot {idx+1}</span></div>;
}

function PlayerSlot({ player, ps, adv, fat, result, blocked, teamKey, idx, phase, game, defPlayer, defSelect, defIdx, onDefChange, onRoll, onSpendAssist, onSpendRebound }) {
  const { open } = useLightbox();
  const col=teamKey==='A'?'var(--orange)':'var(--blue)';
  const rollCol=adv?(adv.rollBonus>0?'#4ADE80':adv.hasPenalty?'#F87171':'#94A3B8'):'#94A3B8';
  const allStats=[...game.teamA.stats,...game.teamB.stats];
  const min=allStats.find(s=>s.id===player.id)?.minutes||0;
  const myHand=(teamKey==='A'?game.teamA:game.teamB).hand;
  const glowCheap=(myHand.some(id=>['chip_on_shoulder'].includes(id))&&player.salary<=250)||
                  (myHand.some(id=>['crowd_favorite'].includes(id))&&player.salary<=350);

  const imgUrl = getPlayerImageUrl(player.id);
  const boosts = [
    player.threePtBoost && player.threePtBoost!==0 ? <span key="3pt" className={styles.b3pt}>3PT{player.threePtBoost>0?'+':''}{player.threePtBoost}</span> : null,
    player.paintBoost && player.paintBoost!==0 ? <span key="pnt" className={styles.bpnt}>Paint{player.paintBoost>0?'+':''}{player.paintBoost}</span> : null,
    player.defBoost && player.defBoost!==0 ? <span key="def" className={player.defBoost>0?styles.bdef:styles.bneg}>Def{player.defBoost>0?'+':''}{player.defBoost}</span> : null,
  ].filter(Boolean);

  return (
    <div className={`${styles.cardFace} ${styles.cardHoriz} ${glowCheap?styles.cardGlow:''}`} style={{borderColor:col}}>
      {/* Left: card art */}
      <div className={styles.cardArtSide} onClick={() => open('player', player)} style={{cursor:'pointer'}}>
        {imgUrl
          ? <img src={imgUrl} alt={player.name} className={styles.cardArtSideImg} onError={e=>{e.target.style.display='none';}} />
          : <div className={styles.cardArtPlaceholder} style={{background:col+'20'}}>{player.name.charAt(0)}</div>
        }
      </div>
      {/* Right: stats sidebar */}
      <div className={styles.cardSidebar}>
        <div className={styles.cardNameRow}>
          <span className={styles.cardName} style={{color:col}}>{player.name}</span>
          <div className={styles.markers}>
            {ps.hot>0&&<span className={styles.hot}>🔥{ps.hot>1?'×'+ps.hot:''}</span>}
            {ps.cold>0&&<span className={styles.cold}>❄️{ps.cold>1?'×'+ps.cold:''}</span>}
            {fat<0&&<span className={styles.fatBadge}>FAT{fat}</span>}
          </div>
        </div>
        <div className={styles.statRows}>
          <div className={styles.statRow}><span className={styles.statLabel}>SPD</span><span className={styles.statVal}>{player.speed}</span></div>
          <div className={styles.statRow}><span className={styles.statLabel}>PWR</span><span className={styles.statVal}>{player.power}</span></div>
          <div className={styles.statRow}><span className={styles.statLabel}>SHOT</span><span className={styles.statVal}>{player.shotLine}</span></div>
          {min>0&&<div className={styles.statRow}><span className={styles.statLabel} style={{color:'#64748B'}}>MIN</span><span className={styles.statVal} style={{color:'#64748B'}}>{min}</span></div>}
        </div>
        {boosts.length>0&&<div className={styles.boostRow}>{boosts}</div>}
        {adv&&defPlayer&&(
          <div className={styles.advBlock}>
            <span className={styles.advVs}>vs {defPlayer.name}{adv.db>0?` (Def+${adv.db})`:''}</span>
            <div className={styles.advNums}>
              <span style={{color:adv.speedAdv>0?'#4ADE80':adv.rawSpeedDiff<0?'#F87171':'#94A3B8'}}>S{adv.rawSpeedDiff>0?'+':''}{adv.rawSpeedDiff}</span>
              <span style={{color:adv.powerAdv>0?'#4ADE80':adv.rawPowerDiff<0?'#F87171':'#94A3B8'}}>P{adv.rawPowerDiff>0?'+':''}{adv.rawPowerDiff}</span>
              {adv.db>0&&!adv.hasPenalty&&<span style={{color:'#F87171',fontSize:'7px'}}>−{adv.db}def</span>}
              <span style={{color:rollCol,fontWeight:700}}>Roll {adv.rollBonus>0?'+':''}{adv.rollBonus}{adv.hasPenalty?' ⚠':''}</span>
            </div>
          </div>
        )}
        {phase==='scoring'&&(
          <div className={styles.rollArea}>
            {blocked?<div className={styles.blocked}>🏠 Blocked</div>
            :result!=null?<div className={styles.result}>
              <div className={styles.diceStr}>🎲{result.die}{result.bonus!==0?(result.bonus>0?'+':'')+result.bonus:''}={result.finalRoll}{result.isTop?' ⭐':''}</div>
              <div className={styles.ptsLg} style={{color:col}}>{result.pts}<span className={styles.ptsUnit}>pts</span></div>
              <div className={styles.statLine}>{result.reb}r {result.ast}a</div>
            </div>
            :<button className={styles.rollBtn} style={{background:col}} onClick={onRoll}>🎲 Roll</button>}
            {/* Assist spending buttons — 2 AST for 3PT check, 3 AST for Paint check */}
            {onSpendAssist && (() => {
              const myT = teamKey==='A'?game.teamA:game.teamB;
              const ast = myT.assists;
              const has3pt = (player.threePtBoost||0) > 0;
              const hasPaint = (player.paintBoost||0) > 0;
              if (ast < 2) return null;
              const anyBtn = (ast>=2 && has3pt) || (ast>=3 && hasPaint);
              if (!anyBtn) return null;
              return (
                <div className={styles.assistSpend}>
                  {ast>=2 && has3pt && <button className={styles.astBtn} title="Spend 2 AST: 3PT shot check" onClick={()=>onSpendAssist(teamKey,'3pt',idx)}>3PT (2A)</button>}
                  {ast>=3 && hasPaint && <button className={styles.astBtn} title="Spend 3 AST: Paint shot check" onClick={()=>onSpendAssist(teamKey,'paint',idx)}>Paint (3A)</button>}
                </div>
              );
            })()}
            {/* Rebound bonus buttons */}
            {onSpendRebound && (() => {
              const rb = game.reboundBonuses?.[teamKey];
              if (!rb) return null;
              const hasPaint = (player.paintBoost||0) > 0 || player.power >= 10;
              const isPutback = rb.putbackPlayers?.some(p => p.idx === idx);
              const anyBtn = (rb.paintCheck && hasPaint) || rb.fastBreak || isPutback;
              if (!anyBtn) return null;
              return (
                <div className={styles.assistSpend}>
                  {rb.paintCheck && hasPaint && <button className={styles.rebBtn} title="Reb +3: Paint shot check" onClick={()=>onSpendRebound(teamKey,'paint_check',idx)}>Paint (R+3)</button>}
                  {rb.fastBreak && <button className={styles.rebBtn} title="Reb +5: Fast break check" onClick={()=>onSpendRebound(teamKey,'fast_break',idx)}>FastBrk (R+5)</button>}
                  {isPutback && <button className={styles.rebBtn} title="Putback: 2+ reb this section" onClick={()=>onSpendRebound(teamKey,'putback',idx)}>Putback</button>}
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}


function TrackPanel({ game, side }) {
  const col=side==='left'?'var(--orange)':'var(--blue)';
  const team=side==='left'?game.teamA:game.teamB;
  const opp=side==='left'?game.teamB:game.teamA;
  const teamKey=side==='left'?'A':'B';
  const rebDiff=team.rebounds-opp.rebounds;
  const absDiff=Math.abs(rebDiff);
  // Show the absolute diff in the color of whoever leads
  const leadCol = rebDiff>0 ? col : rebDiff<0 ? (side==='left'?'var(--blue)':'var(--orange)') : '#94A3B8';
  return (
    <div className={`${styles.trackPanel} ${side==='left'?styles.trackL:styles.trackR}`}>
      <Track l="AST" v={team.assists} col={col} max={10} bonus={team.assists>=5}/>
      <Track l="REB" v={rebDiff===0?'0':`+${absDiff}`} col={leadCol} max={10} raw={team.rebounds}/>
    </div>
  );
}

function Track({l,v,col,max,bonus,raw}){
  const numV = typeof v === 'number' ? v : parseInt(v) || 0;
  const pct=Math.min(100,(Math.abs(numV)/max)*100);
  return (
    <div className={styles.track}>
      <div className={styles.tl}>{l}</div>
      <div className={styles.tbar}><div className={styles.tfill} style={{height:pct+'%',background:col}}/></div>
      <div className={styles.tv} style={{color:col}}>{v}</div>
      {raw !== undefined && <div className={styles.traw}>({raw})</div>}
      {bonus&&<div className={styles.tbonus}>✓</div>}
    </div>
  );
}

function CourtMarkings() {
  return (
    <svg className={styles.courtSvg} viewBox="0 0 800 440" preserveAspectRatio="none">
      <line x1="400" y1="0" x2="400" y2="440" stroke="rgba(255,255,255,0.18)" strokeWidth="2"/>
      <circle cx="400" cy="220" r="52" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2"/>
      <rect x="0" y="148" width="122" height="144" fill="rgba(180,120,40,0.4)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5"/>
      <rect x="678" y="148" width="122" height="144" fill="rgba(180,120,40,0.4)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5"/>
      <path d="M 0,72 Q 230,220 0,368" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
      <path d="M 800,72 Q 570,220 800,368" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="2"/>
      <circle cx="50" cy="220" r="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
      <circle cx="750" cy="220" r="18" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2"/>
    </svg>
  );
}

function PendingBanner({ game, onResolve, onExecCard }) {
  const { pendingShotCheck: psc } = game;
  const offP=getTeam(game,psc.teamKey).starters[psc.playerIdx];
  const defKey=psc.teamKey==='A'?'B':'A';
  const hasCloseOut=getTeam(game,defKey).hand.includes('close_out');
  const coPlay=hasCloseOut?canPlayCard(game,defKey,'close_out'):null;
  return (
    <div className={styles.pendingBanner}>
      <div className={styles.pendingInfo}>
        <span className={styles.pendingTitle}>⏸ {offP?.name} — {psc.cardLabel} at +{psc.bonus}</span>
        {psc.closeOutBonus&&<span style={{color:'var(--red)',fontSize:12}}> Close Out applied: net {psc.bonus+psc.closeOutBonus}</span>}
        <span style={{color:hasCloseOut&&coPlay?.canPlay?'var(--green)':'#94A3B8',fontSize:12}}>Team {defKey}: {hasCloseOut&&coPlay?.canPlay?'⚡ Close Out available!':'no Close Out'}</span>
      </div>
      <div className={styles.pendingActions}>
        {hasCloseOut&&coPlay?.canPlay&&<button className={styles.coBtn} onClick={()=>onExecCard(defKey,'close_out',{})}>Close Out −3</button>}
        <button className={styles.resolveBtn} onClick={onResolve}>▶ Resolve</button>
      </div>
    </div>
  );
}

function HandPanel({ game, teamKey, onExecCard }) {
  const [staged, setStaged] = useState(null);
  const { open } = useLightbox();
  const t = getTeam(game, teamKey);
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const { phase, scoringTurn, scoringPasses, matchupTurn } = game;
  const rollingOpen = scoringPasses >= 99;
  const isActive = phase === 'matchup_strats' ? matchupTurn === teamKey : (rollingOpen || scoringTurn === teamKey);
  const playablePhases = phase === 'matchup_strats' ? ['matchup'] : (isActive ? ['scoring', 'pre_roll', 'post_roll'] : []);

  return (
    <div className={`${styles.handPanel} ${teamKey === 'A' ? styles.handL : styles.handR}`}>
      <div className={styles.handTitle} style={{ color: col }}>
        Team {teamKey} <span className={styles.handCount}>{t.hand.length}</span>
      </div>
      <div className={styles.handList}>
        {t.hand.length === 0 && <div className={styles.handEmpty}>No cards</div>}
        {t.hand.map((id, hi) => {
          const s = getStrat(id); if (!s) return null;
          const isReaction = s.phase === 'reaction';
          const play = canPlayCard(game, teamKey, id);
          const canClick = play.canPlay && (isReaction || playablePhases.includes(s.phase));
          const sImg = getStratImagePath(id);
          const isStaged = staged === hi;

          return (
            <div key={`${id}-${hi}`}
              className={`${styles.hcard} ${!canClick ? styles.hdim : ''} ${isReaction && play.canPlay ? styles.hreact : ''} ${sImg ? styles.hcardHasImg : ''} ${isStaged ? styles.hcardStaged : ''}`}
              style={{ borderLeftColor: s.color }}>

              {/* Icon bar */}
              <div className={styles.hcardIcons}>
                <button className={styles.hcardIconBtn} onClick={() => open('strat', s)} title="View card">
                  👁
                </button>
                {canClick && !isStaged && (
                  <button className={styles.hcardIconBtn} onClick={() => setStaged(hi)} title="Play card"
                    style={{ color: '#4ADE80' }}>
                    ▶
                  </button>
                )}
              </div>

              {sImg
                ? <>
                    <img src={sImg} alt={s.name} className={styles.hcardImgEl} onError={e => { e.target.style.display = 'none'; }} />
                    <div className={styles.hcardOverlay}>
                      <div className={styles.hname}>{s.name}</div>
                      {!canClick && <div style={{ fontSize: 9, color: '#F87171', marginTop: 2, padding: '0 4px' }}>
                        {play.reason}
                      </div>}
                    </div>
                  </>
                : <>
                    <div className={styles.hphase}>{s.side === 'off' ? '⚡' : '🛡'} {s.phase.replace('_', ' ')}{s.locked ? ' 🔒' : ''}</div>
                    <div className={styles.hname}>{s.name}</div>
                    <div className={styles.hdesc}>{canClick ? s.desc.substring(0, 65) + '…' : play.reason}</div>
                  </>
              }

              {/* Confirm/cancel bar for staged card */}
              {isStaged && (
                <div className={styles.hcardConfirm}>
                  <button className={styles.confirmBtn} style={{ background: s.color }}
                    onClick={() => { setStaged(null); onExecCard(teamKey, id, {}); }}>
                    Confirm Play
                  </button>
                  <button className={styles.cancelBtn} onClick={() => setStaged(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
