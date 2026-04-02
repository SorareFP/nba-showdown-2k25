import { useState } from 'react';
import { calcAdv, getTeam, getOpp, getPS, getFatigue, SNAKE } from '../../game/engine.js';
import { canPlayCard } from '../../game/canPlay.js';
import { getStrat } from '../../game/strats.js';
import { aiDraftPick } from '../../game/ai.js';
import styles from './CourtBoard.module.css';
import { getPlayerImageUrl, getStratImagePath } from '../../game/cardImages.js';
import { useLightbox } from '../CardLightbox.jsx';

function HelpBtn({ section }) {
  const handleClick = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('showdown-help', { detail: { section } }));
  };
  return <button className={styles.helpBtn} onClick={handleClick} title="How to Play">?</button>;
}

export default function CourtBoard({ game, setGame, onRoll, onEndSection, onExecCard, onResolve, onSpendAssist, onSpendRebound, onDraftSubmit, pvpMode = false, myTeamKey = null, isMyTurn = true }) {
  const [modal, setModal] = useState(null);
  const [draftSelected, setDraftSelected] = useState([]);

  const openModal = (config) => new Promise(res => setModal({ ...config, resolve: res }));
  const closeModal = (val) => { const r = modal?.resolve; setModal(null); r?.(val); };

  const handleExecCard = async (teamKey, cardId, baseOpts = {}) => {
    const opts = await buildOpts(game, teamKey, cardId, baseOpts, openModal);
    if (opts === null) return;
    onExecCard(teamKey, cardId, opts);
  };

  return (
    <div className={styles.wrap}>
      <PhaseBar game={game} setGame={setGame} onEndSection={onEndSection} pvpMode={pvpMode} myTeamKey={myTeamKey} isMyTurn={isMyTurn} draftSelectedCount={draftSelected.length} />

      {game.phase === 'draft' ? (
        <BlindPickPhase game={game} setGame={setGame} pvpMode={pvpMode} myTeamKey={myTeamKey}
          onDraftSubmit={onDraftSubmit} selected={draftSelected} setSelected={setDraftSelected} />
      ) : (
        <div className={styles.courtLayout}>
          {/* Left hand panel: Team A's hand (or empty placeholder in PvP if I'm Team B) */}
          {(!pvpMode || myTeamKey === 'A')
            ? <HandPanel game={game} teamKey="A" onExecCard={handleExecCard} pvpMode={pvpMode} isMyTurn={isMyTurn} />
            : <div className={styles.handPlaceholder} />
          }

          <div className={styles.court}>
            <CourtMarkings />
            <div className={styles.teamLabelA}>TEAM A</div>
            <div className={styles.teamLabelB}>TEAM B</div>
            <div className={styles.matchups}>
              {[0,1,2,3,4].map(i => (
                <MatchupRow key={i} idx={i} game={game} setGame={setGame}
                  onRoll={onRoll} onExecCard={handleExecCard} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
                  pvpMode={pvpMode} myTeamKey={myTeamKey} isMyTurn={isMyTurn} />
              ))}
            </div>
            <TrackPanel game={game} side="left" />
            <TrackPanel game={game} side="right" />
          </div>

          {/* Right hand panel: Team B's hand (or empty placeholder in PvP if I'm Team A) */}
          {(!pvpMode || myTeamKey === 'B')
            ? <HandPanel game={game} teamKey="B" onExecCard={handleExecCard} pvpMode={pvpMode} isMyTurn={isMyTurn} />
            : <div className={styles.handPlaceholder} />
          }
        </div>
      )}

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
    'catch_and_shoot', 'green_light',
  ];

  // Cards that show ALL my starters (no filtering needed)
  const unfilteredPlayerCards = [
    'you_stand_over_there', 'elevator_doors',
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
      case 'catch_and_shoot': {
        eligible = filterStarters(myT.starters, (p) => (p.speed || 0) >= 12);
        label = 'Select player with Speed 12+';
        break;
      }
      case 'green_light': {
        eligible = filterStarters(myT.starters, (_, i) => !rolls[i] || rolls[i]?.isReplaced);
        label = 'Select player who hasn\'t rolled yet';
        break;
      }
      default:
        eligible = filterStarters(myT.starters, () => true);
        label = 'Select target player';
    }

    if (eligible.length === 0) { alert('No eligible players for this card.'); return null; }

    // Build info function for cards that benefit from showing matchup details
    let infoFn = undefined;
    if (cardId === 'and_one') {
      infoFn = (p, origIdx) => {
        const di = offMatchups[origIdx] ?? origIdx;
        const dp = defenders[di];
        if (!dp) return '';
        const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, origIdx);
        const maxA = Math.max(a.speedAdv, a.powerAdv);
        const tier = maxA >= 5 ? '⭐ +1pt & FT' : '+1pt only';
        return `(Adv +${maxA} → ${tier})`;
      };
    }

    const idx = await pickFiltered(eligible, label, teamKey, infoFn);
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
    // First pick: player with Speed 13+
    const speedEligible = filterStarters(myT.starters, (p) => (p.speed || 0) >= 13);
    const idx1 = await pickFiltered(speedEligible, '⚡ Stagger Action — Pick player with Speed 13+');
    if (idx1 === null) return null;
    opts.playerIdx = idx1;

    // Second pick: player with a 3PT bonus (excluding first pick)
    const threeEligible = filterStarters(myT.starters, (p, i) => i !== idx1 && (p.threePtBoost || 0) > 0);
    const idx2 = await pickFiltered(threeEligible, `⚡ Pick player with 3PT bonus`);
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
            const fat = min >= 16 ? -12 : min >= 12 ? -6 : min >= 8 ? -2 : 0;
            const boosts = [
              p.threePtBoost ? `3PT${p.threePtBoost>0?'+':''}${p.threePtBoost}` : '',
              p.paintBoost   ? `Paint${p.paintBoost>0?'+':''}${p.paintBoost}` : '',
              p.defBoost     ? `Def${p.defBoost>0?'+':''}${p.defBoost}` : '',
            ].filter(Boolean).join(' · ');
            const extra = extraInfo?.[i];
            return (
              <button key={p.id} className={styles.modalBtn} style={{ borderLeftColor: col }} onClick={() => onClose(i)}>
                <div className={styles.mName}>{p.name}{(()=>{const n=(ps.hot||0)-(ps.cold||0);return n>0?' 🔥':n<0?' ❄️':'';})()}{fat<0&&<span className={styles.fatTag}> FAT{fat}</span>}</div>
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

function PhaseBar({ game, setGame, onEndSection, pvpMode = false, myTeamKey = null, isMyTurn = true, draftSelectedCount = 0 }) {
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
    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Lineup Selection<HelpBtn section="draft" /></span>
          <span className={styles.phaseSub}>{draftSelectedCount}/5 selected</span>
        </div>
      </div>
    );
  }
  if (phase === 'matchup_strats') {
    const col = matchupTurn==='A'?'var(--orange)':'var(--blue)';
    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Matchup Strategy<HelpBtn section="matchup" /></span>
          <span className={styles.phaseSub}>Play a card or pass twice to start scoring</span>
        </div>
        <div className={styles.phaseCtrls}>
          <span style={{color:col,fontWeight:600}}>Team {matchupTurn}</span>
          <span className={styles.passCount}>{matchupPasses}/2 passes</span>
          <button className={styles.passBtn} onClick={pass} disabled={pvpMode && !isMyTurn}>Pass →</button>
          <button className={styles.ctaBtn} onClick={lock} disabled={pvpMode && !isMyTurn}>Lock → Scoring</button>
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
          <span className={styles.phaseLabel}>Q{quarter} · Sec {section}/3 · Scoring<HelpBtn section="scoring" /></span>
          {!rollingOpen
            ? <span className={styles.phaseSub} style={{color:col}}>Team {scoringTurn} strategy turn · {Math.min(scoringPasses,2)}/2 passes</span>
            : <span className={styles.phaseSub} style={{color:'var(--green)'}}>All players may roll</span>}
        </div>
        <div className={styles.phaseCtrls}>
          {(segA>0||segB>0) && <span className={styles.segScore}><span style={{color:'var(--orange)'}}>A {segA}</span>–<span style={{color:'var(--blue)'}}>{segB} B</span></span>}
          {!rollingOpen && <button className={styles.passBtn} onClick={pass} disabled={pvpMode && !isMyTurn}>Pass →</button>}
          {allRolled && !game.pendingShotCheck && (() => {
            const votes = game.endSectionVotes || {};
            const myVoted = pvpMode && myTeamKey ? votes[myTeamKey] : false;
            const oppKey = myTeamKey === 'A' ? 'B' : 'A';
            const oppVoted = pvpMode ? votes[oppKey] : false;
            return (
              <>
                {!myVoted && <button className={styles.ctaBtn} onClick={onEndSection}>End Section →</button>}
                {pvpMode && myVoted && !oppVoted && <span className={styles.voteWait}>✓ Waiting for opponent to end section...</span>}
                {pvpMode && oppVoted && !myVoted && <span className={styles.voteReady}>Opponent wants to end section — <button className={styles.ctaBtn} onClick={onEndSection}>End Section →</button></span>}
              </>
            );
          })()}
          {pvpMode && !isMyTurn && !rollingOpen && <span style={{color:'var(--text-dim)',fontSize:12,marginLeft:8}}>Waiting for opponent...</span>}
        </div>
      </div>
    );
  }
  return null;
}

function MatchupRow({ idx, game, setGame, onRoll, onExecCard, onSpendAssist, onSpendRebound, pvpMode = false, myTeamKey = null, isMyTurn = true }) {
  if (game.phase === 'draft') return null; // Draft handled by BlindPickPhase
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
        onRoll={()=>onRoll('A',idx)} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
        pvpDisabled={pvpMode && myTeamKey !== 'A'} />
      <div className={styles.connector}>
        <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
      </div>
      <PlayerSlot player={bp} ps={getPS(game,'B',bp.id)||{}} adv={bDef?calcAdv(bp,bDef,game.tempEff?.B||{},idx,game.tempDefEff?.A,bDefIdx):null}
        fat={getFatigue(game,'B',idx)} result={(game.rollResults.B||[])[idx]} blocked={game.blockedRolls?.B?.[idx]}
        teamKey="B" idx={idx} phase={game.phase} game={game}
        defPlayer={bDef} defSelect={game.teamA.starters} defIdx={bDefIdx}
        onDefChange={di=>{const g=JSON.parse(JSON.stringify(game));g.offMatchups.B[idx]=di;setGame(g);}}
        onRoll={()=>onRoll('B',idx)} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
        pvpDisabled={pvpMode && myTeamKey !== 'B'} />
    </div>
  );
}

// ── Blind Pick Phase ──────────────────────────────────────────────────────
// Replaces the old snake draft. Player selects 5 from their 10-player roster.
// On submit, AI picks 5 for the opponent and the game transitions to matchup_strats.
function BlindPickPhase({ game, setGame, pvpMode = false, myTeamKey = null, onDraftSubmit, selected, setSelected }) {
  const teamKey = pvpMode ? (myTeamKey || 'A') : 'A';
  const pool = teamKey === 'A' ? game.draft.aPool : game.draft.bPool;
  const stats = teamKey === 'A' ? game.teamA.stats : game.teamB.stats;
  const myReady = pvpMode && (teamKey === 'A' ? game.draft.aReady : game.draft.bReady);
  const oppReady = pvpMode && (teamKey === 'A' ? game.draft.bReady : game.draft.aReady);

  const toggle = (playerId) => {
    if (myReady) return; // Already submitted in PvP
    setSelected(prev => {
      if (prev.includes(playerId)) return prev.filter(id => id !== playerId);
      if (prev.length >= 5) return prev;
      return [...prev, playerId];
    });
  };

  const handleSubmit = () => {
    if (selected.length !== 5) return;

    // PvP mode: delegate to parent handler for Firebase sync
    if (pvpMode && onDraftSubmit) {
      onDraftSubmit(selected);
      return;
    }

    // Solo mode: AI picks for opponent
    const g = JSON.parse(JSON.stringify(game));

    // Set player's starters
    const myPool = teamKey === 'A' ? g.draft.aPool : g.draft.bPool;
    const picks = selected.map(id => myPool.find(p => p.id === id)).filter(Boolean);
    if (teamKey === 'A') {
      g.teamA.starters = picks;
      g.draft.aPool = myPool.filter(p => !selected.includes(p.id));
    } else {
      g.teamB.starters = picks;
      g.draft.bPool = myPool.filter(p => !selected.includes(p.id));
    }

    // AI picks 5 for opponent
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    for (let i = 0; i < 5; i++) {
      const action = aiDraftPick(g, oppKey);
      if (action) {
        const oppPool = oppKey === 'A' ? g.draft.aPool : g.draft.bPool;
        const pIdx = oppPool.findIndex(p => p.id === action.playerId);
        if (pIdx >= 0) {
          const picked = oppPool[pIdx];
          if (oppKey === 'A') {
            g.teamA.starters.push(picked);
            g.draft.aPool = g.draft.aPool.filter((_, j) => j !== pIdx);
          } else {
            g.teamB.starters.push(picked);
            g.draft.bPool = g.draft.bPool.filter((_, j) => j !== pIdx);
          }
        }
      }
    }

    // Clear hot/cold for benched players (not in starters)
    ['A', 'B'].forEach(k => {
      const t = k === 'A' ? g.teamA : g.teamB;
      t.stats.forEach(ps => {
        if (!t.starters.find(p => p.id === ps.id)) {
          ps.hot = 0; ps.cold = 0;
          const m = ps.minutes || 0;
          ps.minutes = m <= 8 ? 0 : Math.max(0, m - 8);
        }
      });
    });

    g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
    g.phase = 'matchup_strats';
    g.log = [...g.log, { team: null, msg: 'Lineups locked — Matchup Strategy Phase.' }];

    setSelected([]);
    setGame(g);
  };

  // PvP: show waiting state after submission
  if (myReady) {
    return (
      <div className={styles.blindPickWrap}>
        <div className={styles.blindPickHeader}>
          <span className={styles.blindPickTitle}>Lineup Submitted!</span>
          <span className={styles.blindPickCount}>
            {oppReady ? 'Revealing lineups...' : 'Waiting for opponent...'}
          </span>
        </div>
        <div className={styles.blindPickWaiting}>
          <div className={styles.voteWait}>Your lineup is locked in. Waiting for opponent to submit theirs.</div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.blindPickWrap}>
      <div className={styles.blindPickHeader}>
        <span className={styles.blindPickTitle}>Select Your Starting 5</span>
        <span className={styles.blindPickCount}>
          {selected.length}/5 selected
          {pvpMode && oppReady && <span className={styles.voteReady}> — Opponent ready!</span>}
        </span>
        <button
          className={styles.blindPickSubmit}
          disabled={selected.length !== 5}
          onClick={handleSubmit}
        >
          Submit Lineup
        </button>
      </div>
      <div className={styles.blindPickGrid}>
        {pool.map(p => {
          const ps = stats?.find(s => s.id === p.id) || {};
          const isSelected = selected.includes(p.id);
          const min = ps.minutes || 0;
          const fat = min >= 16 ? -12 : min >= 12 ? -6 : min >= 8 ? -2 : 0;
          const hotCold = (ps.hot || 0) - (ps.cold || 0);
          const boosts = [
            p.threePtBoost ? `3PT+${p.threePtBoost}` : '',
            p.paintBoost ? `Paint+${p.paintBoost}` : '',
            p.defBoost ? `Def+${p.defBoost}` : '',
          ].filter(Boolean);
          const imgUrl = getPlayerImageUrl(p.id);

          return (
            <button
              key={p.id}
              className={`${styles.blindPickCard} ${isSelected ? styles.blindPickSelected : ''} ${min >= 16 ? styles.blindPickExhausted : ''}`}
              onClick={() => toggle(p.id)}
            >
              {isSelected && <span className={styles.blindPickCheck}>&#10003;</span>}
              <div className={styles.blindPickArt}>
                {imgUrl
                  ? <img src={imgUrl} alt={p.name} className={styles.blindPickImg} onError={e => { e.target.style.display = 'none'; }} />
                  : <div className={styles.blindPickPlaceholder}>{p.name.charAt(0)}</div>
                }
              </div>
              <div className={styles.blindPickName}>
                {p.name}
                {hotCold > 0 && <span className={styles.blindPickHot}> HOT</span>}
                {hotCold < 0 && <span className={styles.blindPickCold}> COLD</span>}
              </div>
              <div className={styles.blindPickStats}>
                S{p.speed} · P{p.power} · Line {p.shotLine}
              </div>
              <div className={styles.blindPickMeta}>
                <span className={styles.blindPickSalary}>${p.salary}</span>
                {boosts.length > 0 && <span className={styles.blindPickBoosts}>{boosts.join(' ')}</span>}
              </div>
              {min > 0 && (
                <div className={`${styles.blindPickFatigue} ${fat < 0 ? styles.blindPickFatWarn : ''}`}>
                  {min}m{fat < 0 ? ` (${fat})` : ''}
                  {min >= 16 && ' MUST REST'}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── DraftRow (legacy, kept for TutorialGame compatibility) ────────────────
function DraftRow({ idx, game, setGame, pvpMode = false, myTeamKey = null, isMyTurn = true }) {
  const { draft, teamA, teamB } = game;
  const aS=teamA.starters, bS=teamB.starters;
  const actTeam = SNAKE[Math.min(draft.step,9)]===0?'A':'B';
  const done = aS.length===5&&bS.length===5;
  // In PvP, only show pick list for my team and only when it's my turn
  const isNextA = actTeam==='A'&&aS.length===idx&&!done && (!pvpMode || (myTeamKey === 'A' && isMyTurn));
  const isNextB = actTeam==='B'&&bS.length===idx&&!done && (!pvpMode || (myTeamKey === 'B' && isMyTurn));

  const pick = (card, team) => {
    const g=JSON.parse(JSON.stringify(game));
    const d=g.draft;
    if(team==='A'){g.teamA.starters.push(card);d.aPool=d.aPool.filter(c=>c.id!==card.id);}
    else{g.teamB.starters.push(card);d.bPool=d.bPool.filter(c=>c.id!==card.id);}
    d.step++;
    if(g.teamA.starters.length===5&&g.teamB.starters.length===5){
      g.offMatchups={A:[0,1,2,3,4],B:[0,1,2,3,4]};
      ['A','B'].forEach(k=>{const t=k==='A'?g.teamA:g.teamB;t.stats.forEach(ps=>{if(!t.starters.find(p=>p.id===ps.id)){ps.hot=0;ps.cold=0;const m=ps.minutes||0;ps.minutes=m<=8?0:Math.max(0,m-8);}});});
      g.phase='matchup_strats';
      g.log=[...g.log,{team:null,msg:'Draft complete — Matchup Strategy Phase.'}];
    }
    setGame(g);
  };

  // In PvP, show "Picking..." when opponent has the active pick at this slot
  const oppPickingA = pvpMode && actTeam==='A' && myTeamKey!=='A' && aS.length===idx && !done;
  const oppPickingB = pvpMode && actTeam==='B' && myTeamKey!=='B' && bS.length===idx && !done;

  return (
    <div className={styles.matchupRow}>
      <div className={styles.draftCell}>
        {aS[idx] ? <PlacedCard player={aS[idx]} stats={teamA.stats} col="var(--orange)"/>
          : isNextA ? <PickList pool={draft.aPool} stats={teamA.stats} onPick={c=>pick(c,'A')} col="var(--orange)" oppStarters={bS} myStarters={aS} slotIdx={idx}/>
          : oppPickingA ? <div className={styles.oppPicking}>Picking...</div>
          : <EmptySlot idx={idx} col="var(--orange)"/>}
      </div>
      <div className={styles.connector}>
        <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
      </div>
      <div className={styles.draftCell}>
        {bS[idx] ? <PlacedCard player={bS[idx]} stats={teamB.stats} col="var(--blue)"/>
          : isNextB ? <PickList pool={draft.bPool} stats={teamB.stats} onPick={c=>pick(c,'B')} col="var(--blue)" oppStarters={aS} myStarters={bS} slotIdx={idx}/>
          : oppPickingB ? <div className={styles.oppPicking}>Picking...</div>
          : <EmptySlot idx={idx} col="var(--blue)"/>}
      </div>
    </div>
  );
}

function PlacedCard({ player, stats, col }) {
  const ps=stats?.find(s=>s.id===player.id)||{};
  const min=ps.minutes||0,fat=min>=16?-12:min>=12?-6:min>=8?-2:0;
  const boosts=[
    player.threePtBoost?`3PT${player.threePtBoost>0?'+':''}${player.threePtBoost}`:'',
    player.paintBoost?`Paint${player.paintBoost>0?'+':''}${player.paintBoost}`:'',
    player.defBoost?`Def${player.defBoost>0?'+':''}${player.defBoost}`:'',
  ].filter(Boolean);
  const pImgUrl = getPlayerImageUrl(player.id);
  return (
    <div className={styles.placedCard} style={{borderColor:col}}>
      {pImgUrl && <img src={pImgUrl} alt={player.name} className={styles.placedArt} onError={e=>e.target.style.display='none'} />}
      <div className={styles.placedName} style={{color:col}}>{player.name}{(()=>{const n=(ps.hot||0)-(ps.cold||0);return n>0?' 🔥':n<0?' ❄️':'';})()}{fat<0&&<span className={styles.fatTag}> FAT{fat}</span>}</div>
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
          const min=ps.minutes||0,fat=min>=16?-12:min>=12?-6:min>=8?-2:0;
          const boosts=[
            p.threePtBoost?`3PT${p.threePtBoost>0?'+':''}${p.threePtBoost}`:'',
            p.paintBoost?`Paint${p.paintBoost>0?'+':''}${p.paintBoost}`:'',
            p.defBoost?`Def${p.defBoost>0?'+':''}${p.defBoost}`:'',
          ].filter(Boolean).join(' ');
          const preview = getMatchupPreview(p);
          return (
            <button key={p.id} className={styles.pickItem} onClick={()=>onPick(p)}>
              <span className={styles.pickName}>{p.name}{(()=>{const n=(ps.hot||0)-(ps.cold||0);return n>0?' 🔥':n<0?' ❄️':'';})()}</span>
              <span className={styles.pickMeta}>S{p.speed} P{p.power}{boosts&&' · '+boosts}{min>=16?' ⛔ MUST REST':fat<0?` FAT${fat}`:min>0?` ${min}m`:''}</span>
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

function PlayerSlot({ player, ps, adv, fat, result, blocked, teamKey, idx, phase, game, defPlayer, defSelect, defIdx, onDefChange, onRoll, onSpendAssist, onSpendRebound, pvpDisabled = false }) {
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
            {(()=>{const net=(ps.hot||0)-(ps.cold||0);if(net>0)return<span className={styles.hot}>🔥{net>1?'×'+net:''}</span>;if(net<0)return<span className={styles.cold}>❄️{Math.abs(net)>1?'×'+Math.abs(net):''}</span>;return null;})()}
            {fat<0&&<span className={styles.fatBadge}>FAT{fat}</span>}
          </div>
        </div>
        <div className={styles.attrRow}>
          <span className={styles.attrItem}><span className={styles.attrLabel}>SPD</span> <span className={styles.attrVal}>{player.speed}</span></span>
          <span className={styles.attrItem}><span className={styles.attrLabel}>PWR</span> <span className={styles.attrVal}>{player.power}</span></span>
          <span className={styles.attrItem}><span className={styles.attrLabel}>SHOT</span> <span className={styles.attrVal}>{player.shotLine}</span></span>
        </div>
        {boosts.length>0&&<div className={styles.boostRow}>{boosts}</div>}
        {adv&&defPlayer&&(
          <div className={styles.advBlock}>
            <div className={styles.advVsRow}>
              <span className={styles.advVs}>vs {defPlayer.name}</span>
              {adv.db>0&&<span className={styles.advDefBadge}>DEF+{adv.db}</span>}
            </div>
            <div className={styles.advLine}>
              <span style={{color:adv.speedAdv>0?'#4ADE80':adv.rawSpeedDiff<0?'#F87171':'#94A3B8'}}>S{adv.rawSpeedDiff>0?'+':''}{adv.rawSpeedDiff}</span>
              {' '}
              <span style={{color:adv.powerAdv>0?'#4ADE80':adv.rawPowerDiff<0?'#F87171':'#94A3B8'}}>P{adv.rawPowerDiff>0?'+':''}{adv.rawPowerDiff}</span>
              {' '}
              <span className={styles.advRoll} style={{color:rollCol}}>Roll {adv.rollBonus>0?'+':''}{adv.rollBonus}{adv.hasPenalty?' ⚠':''}</span>
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
            :<button className={styles.rollBtn} style={{background:col}} onClick={onRoll} disabled={pvpDisabled}>🎲 Roll</button>}
            {/* Assist spending buttons — 4 AST for 3PT check, 3 AST for Paint check */}
            {onSpendAssist && !pvpDisabled && (() => {
              const myT = teamKey==='A'?game.teamA:game.teamB;
              const ast = myT.assists;
              const has3pt = (player.threePtBoost||0) > 0;
              const hasPaint = (player.paintBoost||0) > 0;
              if (ast < 3) return null;
              const anyBtn = (ast>=4 && has3pt) || (ast>=3 && hasPaint);
              if (!anyBtn) return null;
              return (
                <div className={styles.assistSpend}>
                  {ast>=4 && has3pt && <button className={styles.astBtn} title="Spend 4 AST: 3PT shot check" onClick={()=>onSpendAssist(teamKey,'3pt',idx)}>3PT (4A)</button>}
                  {ast>=3 && hasPaint && <button className={styles.astBtn} title="Spend 3 AST: Paint shot check" onClick={()=>onSpendAssist(teamKey,'paint',idx)}>Paint (3A)</button>}
                </div>
              );
            })()}
            {/* Rebound bonus buttons */}
            {onSpendRebound && !pvpDisabled && (() => {
              const rb = game.reboundBonuses?.[teamKey];
              if (!rb) return null;
              const myT2 = teamKey==='A'?game.teamA:game.teamB;
              const hasPaint = ((player.paintBoost||0) > 0 || player.power >= 10) && myT2.rebounds >= 3;
              const isPutback = rb.putbackPlayers?.some(p => p.idx === idx) && myT2.rebounds >= 2;
              const anyBtn = (rb.paintCheck && hasPaint) || isPutback;
              if (!anyBtn) return null;
              return (
                <div className={styles.assistSpend}>
                  {rb.paintCheck && hasPaint && <button className={styles.rebBtn} title="Costs 3 REB: Paint shot check" onClick={()=>onSpendRebound(teamKey,'paint_check',idx)}>Paint (−3R)</button>}
                  {isPutback && <button className={styles.rebBtn} title="Costs 2 REB: Putback paint check" onClick={()=>onSpendRebound(teamKey,'putback',idx)}>Putback (−2R)</button>}
                </div>
              );
            })()}
          </div>
        )}
        {/* Game stats for this player */}
        {(ps.pts > 0 || ps.reb > 0 || ps.ast > 0 || (ps.totalMinutes || 0) > 0) && (
          <div className={styles.gameStats}>
            <div className={styles.gsRow}>
              {ps.pts > 0 && <span className={styles.gsItem}><span className={styles.gsVal} style={{color:col}}>{ps.pts}</span><span className={styles.gsLbl}>PTS</span></span>}
              {ps.reb > 0 && <span className={styles.gsItem}><span className={styles.gsVal}>{ps.reb}</span><span className={styles.gsLbl}>REB</span></span>}
              {ps.ast > 0 && <span className={styles.gsItem}><span className={styles.gsVal}>{ps.ast}</span><span className={styles.gsLbl}>AST</span></span>}
            </div>
            <div className={styles.gsRow}>
              {(ps.totalMinutes || 0) > 0 && <span className={styles.gsItem}><span className={styles.gsVal} style={{color:'#64748B'}}>{ps.totalMinutes}</span><span className={styles.gsLbl}>MIN</span></span>}
              {ps.pm != null && ps.pm !== 0 && <span className={styles.gsItem}><span className={styles.gsVal} style={{color:ps.pm>0?'#4ADE80':ps.pm<0?'#F87171':'#94A3B8'}}>{ps.pm>0?'+':''}{ps.pm}</span><span className={styles.gsLbl}>+/−</span></span>}
              {(ps.threepm || 0) > 0 && <span className={styles.gsItem}><span className={styles.gsVal}>{ps.threepm}/{ps.threepa}</span><span className={styles.gsLbl}>3PT</span></span>}
            </div>
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

function HandPanel({ game, teamKey, onExecCard, pvpMode = false, isMyTurn = true }) {
  const [staged, setStaged] = useState(null);
  const { open } = useLightbox();
  const t = getTeam(game, teamKey);
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const { phase, scoringTurn, scoringPasses, matchupTurn } = game;
  const rollingOpen = scoringPasses >= 99;
  const isActive = phase === 'matchup_strats' ? matchupTurn === teamKey : (rollingOpen || scoringTurn === teamKey);
  const playablePhases = phase === 'matchup_strats' ? ['matchup'] : (isActive ? ['scoring', 'pre_roll', 'post_roll'] : []);
  // In PvP, also allow reaction cards when it's your turn to react (isMyTurn handles this)
  const pvpCanPlay = !pvpMode || isMyTurn;

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
          const canClick = play.canPlay && (isReaction || playablePhases.includes(s.phase)) && pvpCanPlay;
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
