// NBA Showdown 2K25 — Core Game Engine
// Pure functions — no React, no side effects. State is a plain object.

import { lookupChart } from './cards.js';
import { getStrat } from './strats.js';

// ── Constants ──────────────────────────────────────────────────────────────
export const CAP = 5500;
export const ROSTER_SIZE = 10;
export const STARTERS = 5;
export const SNAKE = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]; // 0=A, 1=B

// ── Deck ───────────────────────────────────────────────────────────────────
import { STRATS } from './strats.js';

export function buildDeck() {
  let d = [];
  for (const s of STRATS) {
    for (let i = 0; i < (s.copies || 2); i++) d.push(s.id);
  }
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, 50);
}

export function drawCards(hand, deck, n) {
  const newHand = [...hand];
  const newDeck = [...deck];
  for (let i = 0; i < n; i++) {
    if (newHand.length >= 7) break;
    if (!newDeck.length) break; // deck exhausted
    newHand.push(newDeck.pop());
  }
  return { hand: newHand, deck: newDeck };
}

// ── New Game ───────────────────────────────────────────────────────────────
function makeTeam(roster, name) {
  const deckA = buildDeck();
  const { hand, deck } = drawCards([], deckA, 7);
  return {
    name,
    roster,
    starters: [],
    score: 0,
    assists: 0,
    rebounds: 0,
    hand,
    deck,
    stats: roster.map(c => ({
      id: c.id,
      pts: 0, reb: 0, ast: 0,
      minutes: 0,
      hot: 0, cold: 0,
      threepm: 0, threepa: 0,
      ftm: 0, fta: 0,
      pm: 0,
    })),
  };
}

export function newGame(rosterA, rosterB) {
  return {
    teamA: makeTeam(rosterA, 'Team A'),
    teamB: makeTeam(rosterB, 'Team B'),
    quarter: 1,
    section: 1,
    phase: 'draft', // draft | matchup_strats | scoring | done
    draft: { step: 0, aPool: rosterA.slice(), bPool: rosterB.slice() },
    offMatchups: { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] },
    matchupTurn: 'A',
    matchupPasses: 0,
    lastMatchupCard: null,
    scoringTurn: 'B',
    scoringPasses: 0,
    pendingShotCheck: null,
    rollResults: { A: [], B: [] },
    tempEff: {},
    ghosted: {},
    ignFatigue: {},
    blockedRolls: {},
    log: [],
    done: false,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────
export function getTeam(g, key) {
  return key === 'A' ? g.teamA : g.teamB;
}

export function getOpp(g, key) {
  return key === 'A' ? g.teamB : g.teamA;
}

export function getPS(g, key, id) {
  return getTeam(g, key).stats.find(s => s.id === id);
}

export function roll20() {
  return Math.floor(Math.random() * 20) + 1;
}

// ── Advantage Calculation ──────────────────────────────────────────────────
// Rules:
//   - Both Speed AND Power negative → penalty = max(rawSpeed, rawPower) (least negative)
//   - DefBoost only reduces POSITIVE advantages, never creates negatives
//   - Hot/cold: ±2 per marker
//   - tempDefEff: { [defSlot]: { speedBoost, powerBoost } } from Defensive Stopper etc.
export function calcAdv(off, def, tempEff = {}, idx = 0, tempDefEff = null, defIdx = null) {
  // Defensive temp boosts (e.g. Defensive Stopper +5/+5)
  let defSpeedExtra = 0, defPowerExtra = 0;
  if (tempDefEff && defIdx !== null && tempDefEff[defIdx]) {
    defSpeedExtra = tempDefEff[defIdx].speedBoost || 0;
    defPowerExtra = tempDefEff[defIdx].powerBoost || 0;
  }

  const rawSpeed = off.speed - (def.speed + defSpeedExtra) + (tempEff['s' + idx] || 0);
  const rawPower = off.power - (def.power + defPowerExtra) + (tempEff['p' + idx] || 0);
  const db = Math.max(0, def.defBoost || 0);

  if (rawSpeed <= 0 && rawPower <= 0) {
    const rollBonus = Math.max(rawSpeed, rawPower);
    return { speedAdv: rawSpeed, powerAdv: rawPower, rawSpeedDiff: rawSpeed, rawPowerDiff: rawPower, db, rollBonus, hasPenalty: true };
  }

  const speedAdv = Math.max(0, rawSpeed - db);
  const powerAdv = Math.max(0, rawPower - db);
  return { speedAdv, powerAdv, rawSpeedDiff: rawSpeed, rawPowerDiff: rawPower, db, rollBonus: Math.max(speedAdv, powerAdv), hasPenalty: false };
}

// ── Fatigue ────────────────────────────────────────────────────────────────
export function getFatigue(g, key, idx) {
  const player = getTeam(g, key).starters[idx];
  if (!player) return 0;
  const ps = getPS(g, key, player.id);
  if (g.ignFatigue?.[`${key}_${idx}`]) return 0;
  const min = ps?.minutes || 0;
  if (min >= 12) return -4;
  if (min >= 8) return -2;
  return 0;
}

// ── Shot Check ─────────────────────────────────────────────────────────────
// No speed/power advantage — only player's own boost + hot/cold + card bonus
export function shotCheck(player, type, extra, ps) {
  const die = roll20();
  let bonus = extra || 0;
  if (type === '3pt')   bonus += (player.threePtBoost || 0);
  if (type === 'paint') bonus += (player.paintBoost || 0);
  if (type === 'ft')    bonus += 10;
  bonus += ((ps?.hot || 0) - (ps?.cold || 0)) * 2;
  const total = die + bonus;
  const hit = total >= player.shotLine;
  const pts = hit ? (type === '3pt' ? 3 : type === 'paint' ? 2 : 1) : 0;
  return { die, bonus, total, line: player.shotLine, hit, pts, type };
}

// ── Assist Spending ────────────────────────────────────────────────────────
// Spend 1 AST: +1 to a player's next shot check
// Spend 2 AST: initiate a 3PT shot check for a player with 3PT bonus
// Spend 3 AST: initiate a Paint shot check for a player with Paint bonus
export function spendAssist(g, teamKey, type, playerIdx) {
  const ng = deepClone(g);
  const myT = getTeam(ng, teamKey);
  const player = myT.starters[playerIdx];
  if (!player) return { game: ng, ok: false, msg: 'Invalid player' };
  const ps = getPS(ng, teamKey, player.id) || {};

  if (type === 'boost') {
    if (myT.assists < 1) return { game: ng, ok: false, msg: `Need 1 assist (have ${myT.assists})` };
    myT.assists -= 1;
    if (!ng.tempEff[teamKey]) ng.tempEff[teamKey] = {};
    ng.tempEff[teamKey]['astBoost_' + playerIdx] = (ng.tempEff[teamKey]['astBoost_' + playerIdx] || 0) + 1;
    ng.log = [...ng.log, { team: teamKey, msg: `Spent 1 AST: ${player.name} gets +1 to next shot check` }];
    return { game: ng, ok: true };
  }

  if (type === '3pt') {
    if (myT.assists < 2) return { game: ng, ok: false, msg: `Need 2 assists (have ${myT.assists})` };
    if (!(player.threePtBoost > 0)) return { game: ng, ok: false, msg: `${player.name} needs a 3PT Bonus` };
    myT.assists -= 2;
    const astBonus = ng.tempEff?.[teamKey]?.['astBoost_' + playerIdx] || 0;
    const r = shotCheck(player, '3pt', astBonus, ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) { ps2.pts += r.pts; ps2.threepa = (ps2.threepa || 0) + 1; ps2.threepm = (ps2.threepm || 0) + 1; }
    } else {
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.threepa = (ps2.threepa || 0) + 1;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    if (ng.tempEff?.[teamKey]) delete ng.tempEff[teamKey]['astBoost_' + playerIdx];
    ng.log = [...ng.log, { team: teamKey, msg: `Spent 2 AST: ${player.name} 3PT check 🎲${r.die}${r.bonus ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? '3pts!' : 'MISS'}` }];
    return { game: ng, ok: true };
  }

  if (type === 'paint') {
    if (myT.assists < 3) return { game: ng, ok: false, msg: `Need 3 assists (have ${myT.assists})` };
    if (!(player.paintBoost > 0)) return { game: ng, ok: false, msg: `${player.name} needs a Paint Bonus` };
    myT.assists -= 3;
    const astBonus = ng.tempEff?.[teamKey]?.['astBoost_' + playerIdx] || 0;
    const r = shotCheck(player, 'paint', astBonus, ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    if (ng.tempEff?.[teamKey]) delete ng.tempEff[teamKey]['astBoost_' + playerIdx];
    ng.log = [...ng.log, { team: teamKey, msg: `Spent 3 AST: ${player.name} Paint check 🎲${r.die}${r.bonus ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? '2pts!' : 'MISS'}` }];
    return { game: ng, ok: true };
  }

  return { game: ng, ok: false, msg: 'Unknown assist spend type' };
}

// ── Rebound Bonus Shot Checks ──────────────────────────────────────────────
// +3 reb diff → Paint shot check for a chosen player
// +5 reb diff → Speed-based fast break shot check for a chosen player
// Putback → player who got 2+ reb in a section gets a Paint check
export function spendReboundBonus(g, teamKey, type, playerIdx) {
  const ng = deepClone(g);
  const myT = getTeam(ng, teamKey);
  const player = myT.starters[playerIdx];
  if (!player) return { game: ng, ok: false, msg: 'Invalid player' };
  const ps = getPS(ng, teamKey, player.id) || {};

  if (type === 'paint_check') {
    // Second-chance paint shot check (from +3 reb advantage)
    const r = shotCheck(player, 'paint', 0, ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    // Mark as used
    if (ng.reboundBonuses?.[teamKey]) ng.reboundBonuses[teamKey].paintCheck = false;
    ng.log = [...ng.log, { team: teamKey, msg: `Rebound +3 Paint Check: ${player.name} 🎲${r.die}${r.bonus ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? '2pts!' : 'MISS'}` }];
    return { game: ng, ok: true };
  }

  if (type === 'fast_break') {
    // Speed-based fast break (from +5 reb advantage). Use speed as bonus
    const speedBonus = Math.floor(player.speed / 4);
    const r = shotCheck(player, 'paint', speedBonus, ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    if (ng.reboundBonuses?.[teamKey]) ng.reboundBonuses[teamKey].fastBreak = false;
    ng.log = [...ng.log, { team: teamKey, msg: `Fast Break (Reb +5): ${player.name} 🎲${r.die}${r.bonus ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? '2pts!' : 'MISS'}` }];
    return { game: ng, ok: true };
  }

  if (type === 'putback') {
    const r = shotCheck(player, 'paint', 0, ps);
    if (r.hit) {
      myT.score += r.pts;
      const ps2 = myT.stats.find(s => s.id === player.id);
      if (ps2) ps2.pts += r.pts;
    }
    if (r.die <= 2) ps.cold = (ps.cold || 0) + 1;
    if (r.die >= 19) ps.hot = (ps.hot || 0) + 1;
    // Remove this player from putback list
    if (ng.reboundBonuses?.[teamKey]?.putbackPlayers) {
      ng.reboundBonuses[teamKey].putbackPlayers = ng.reboundBonuses[teamKey].putbackPlayers.filter(p => p.idx !== playerIdx);
    }
    ng.log = [...ng.log, { team: teamKey, msg: `Putback (2+ Reb): ${player.name} 🎲${r.die}${r.bonus ? (r.bonus > 0 ? '+' : '') + r.bonus : ''}=${r.total} vs ${r.line} → ${r.hit ? '2pts!' : 'MISS'}` }];
    return { game: ng, ok: true };
  }

  return { game: ng, ok: false, msg: 'Unknown rebound bonus type' };
}

// ── Scoring Roll ───────────────────────────────────────────────────────────
export function doRoll(g, teamKey, idx) {
  const myT = getTeam(g, teamKey);
  const oppT = getOpp(g, teamKey);
  const player = myT.starters[idx];
  if (!player) return g;

  const defIdx = (g.offMatchups[teamKey] || [])[idx] ?? idx;
  const defPlayer = oppT.starters[defIdx] || oppT.starters[0];
  if (!defPlayer) return g;

  // Clone state for immutability
  const ng = deepClone(g);
  const nMyT = getTeam(ng, teamKey);
  const nOppT = getOpp(ng, teamKey);
  const nPlayer = nMyT.starters[idx];
  const nDefPlayer = nOppT.starters[defIdx];

  const ghosted = ng.ghosted?.[`${teamKey}_${idx}`];
  let adv;
  if (ghosted) {
    adv = { speedAdv: 0, powerAdv: 0, rollBonus: 0, hasPenalty: false };
  } else {
    const oppKey = teamKey === 'A' ? 'B' : 'A';
    adv = calcAdv(nPlayer, nDefPlayer, ng.tempEff[teamKey], idx, ng.tempDefEff?.[oppKey], defIdx);
  }

  let bonus = adv.rollBonus;
  const te = ng.tempEff[teamKey] || {};
  if (te['r' + idx]) bonus += te['r' + idx];

  const fat = getFatigue(ng, teamKey, idx);
  const ps = getPS(ng, teamKey, nPlayer.id) || {};
  const mrkB = ((ps.hot || 0) - (ps.cold || 0)) * 2;
  const die = roll20();
  const totalBonus = bonus + fat + mrkB;
  const finalRoll = Math.max(1, Math.min(die + totalBonus, 99));
  const result = lookupChart(nPlayer, finalRoll);
  const topPts = nPlayer.chart[nPlayer.chart.length - 1].pts;
  const isTop = result.pts >= topPts && result.pts > 0;

  if (!ng.rollResults[teamKey]) ng.rollResults[teamKey] = [];
  ng.rollResults[teamKey][idx] = { die, bonus: totalBonus, finalRoll, pts: result.pts, reb: result.reb, ast: result.ast, isTop };

  nMyT.score += result.pts;
  nMyT.assists += result.ast;
  nMyT.rebounds += result.reb;
  const ps2 = nMyT.stats.find(s => s.id === nPlayer.id);
  if (ps2) { ps2.pts += result.pts; ps2.reb += result.reb; ps2.ast += result.ast; }

  // Auto hot/cold from natural roll
  const ps3 = getPS(ng, teamKey, nPlayer.id) || {};
  if (die <= 2) ps3.cold = (ps3.cold || 0) + 1;
  else if (die >= 19) ps3.hot = (ps3.hot || 0) + 1;

  ng.log = [...ng.log, {
    team: teamKey,
    msg: `${nPlayer.name} 🎲${die}${totalBonus !== 0 ? (totalBonus > 0 ? '+' : '') + totalBonus : ''}=${finalRoll} → ${result.pts}pts ${result.reb}reb ${result.ast}ast${adv.hasPenalty && !ghosted ? ' ⚠️ penalty' : ''}${isTop ? ' ⭐' : ''}${die === 20 ? ' 🎯' : ''}`,
  }];

  // Check assist bonus draw
  const after = checkAssistDraw(ng);
  return after;
}

function checkAssistDraw(g) {
  let ng = g;
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    if (t.assists === 5) {
      const drawn = drawCards(t.hand, t.deck, 1);
      ng = {
        ...ng,
        [k === 'A' ? 'teamA' : 'teamB']: { ...t, hand: drawn.hand, deck: drawn.deck, assists: 6 },
        log: [...ng.log, { team: k, msg: `${t.name} reached 5 assists — bonus card drawn!` }],
      };
    }
  });
  return ng;
}

// ── Section End ────────────────────────────────────────────────────────────
export function endSection(g) {
  let ng = deepClone(g);

  // Clear previous section's rebound bonuses before calculating new ones
  ng.reboundBonuses = {};

  // +/- and minutes
  const segPtsA = (ng.rollResults.A || []).reduce((s, r) => s + (r?.pts || 0), 0);
  const segPtsB = (ng.rollResults.B || []).reduce((s, r) => s + (r?.pts || 0), 0);
  ['A', 'B'].forEach(k => {
    const segFor = k === 'A' ? segPtsA : segPtsB;
    const segAg  = k === 'A' ? segPtsB : segPtsA;
    getTeam(ng, k).starters.forEach(p => {
      const ps = getPS(ng, k, p.id);
      if (ps) { ps.minutes += 4; ps.pm = (ps.pm || 0) + (segFor - segAg); }
    });
  });

  // Rebound track bonuses (based on differential)
  const rd = ng.teamA.rebounds - ng.teamB.rebounds;
  const absRd = Math.abs(rd);
  if (absRd > 0) {
    const wk = rd > 0 ? 'A' : 'B';
    const wTeam = getTeam(ng, wk);

    // Winning the rebound track at section end → +1 stored assist
    wTeam.assists++;
    ng.log = [...ng.log, { team: wk, msg: `Rebound Track lead → ${wTeam.name} +1 AST` }];

    // Track rebound bonuses earned this section for UI display
    if (!ng.reboundBonuses) ng.reboundBonuses = {};
    ng.reboundBonuses[wk] = { diff: absRd, paintCheck: absRd >= 3, fastBreak: absRd >= 5 };
  }

  // Check individual player +2 reb in this section → putback opportunity
  ['A', 'B'].forEach(k => {
    const sectionRolls = ng.rollResults[k] || [];
    const t = getTeam(ng, k);
    sectionRolls.forEach((r, i) => {
      if (r && (r.reb || 0) >= 2) {
        const p = t.starters[i];
        if (p) {
          if (!ng.reboundBonuses) ng.reboundBonuses = {};
          if (!ng.reboundBonuses[k]) ng.reboundBonuses[k] = {};
          if (!ng.reboundBonuses[k].putbackPlayers) ng.reboundBonuses[k].putbackPlayers = [];
          ng.reboundBonuses[k].putbackPlayers.push({ name: p.name, id: p.id, idx: i });
          ng.log = [...ng.log, { team: k, msg: `${p.name} grabbed 2+ rebounds → Putback opportunity!` }];
        }
      }
    });
  });

  // Reset section state
  ng.tempEff = {}; ng.tempDefEff = {}; ng.ghosted = {}; ng.ignFatigue = {};
  ng.rollResults = { A: [], B: [] }; ng.pendingShotCheck = null;
  // reboundBonuses were set earlier in this function — they persist to the next section's scoring phase

  if (ng.section < 3) {
    ng.section++;
    ng.phase = 'draft';
  } else if (ng.quarter < 4) {
    ng.quarter++;
    ng.section = 1;
    ng.phase = 'draft';
    if (ng.quarter === 3) {
      // Halftime — reset all fatigue
      ['A', 'B'].forEach(k => getTeam(ng, k).stats.forEach(ps => { ps.minutes = 0; }));
      ng.log = [...ng.log, { team: null, msg: '=== HALFTIME — All fatigue reset. Q3 begins. ===' }];
    } else {
      ng.log = [...ng.log, { team: null, msg: `=== Q${ng.quarter} begins ===` }];
    }
  } else {
    ng.done = true;
    return ng;
  }

  // Auto draw to 7
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    const drawn = drawCards(t.hand, t.deck, 7 - t.hand.length);
    if (k === 'A') { ng.teamA = { ...ng.teamA, hand: drawn.hand, deck: drawn.deck }; }
    else           { ng.teamB = { ...ng.teamB, hand: drawn.hand, deck: drawn.deck }; }
  });

  // Save current starters before clearing for bench recovery check
  const prevStartersA = ng.teamA.starters.map(p => p.id);
  const prevStartersB = ng.teamB.starters.map(p => p.id);

  // Reset for new draft
  ng.draft = { step: 0, aPool: ng.teamA.roster.slice(), bPool: ng.teamB.roster.slice() };
  ng.teamA.starters = []; ng.teamB.starters = [];
  ng.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  ng.matchupTurn = 'A'; ng.matchupPasses = 0; ng.lastMatchupCard = null;
  ng.scoringTurn = 'B'; ng.scoringPasses = 0;
  ng.blockedRolls = {};

  // Clear hot/cold for benched players, recover fatigue (using previous starters)
  ng = clearBenchedMarkers(ng, { A: prevStartersA, B: prevStartersB });

  return ng;
}

function clearBenchedMarkers(g, prevStarters) {
  const ng = { ...g };
  ['A', 'B'].forEach(k => {
    const t = getTeam(ng, k);
    const wasPlaying = prevStarters[k] || [];
    t.stats.forEach(ps => {
      if (!wasPlaying.includes(ps.id)) {
        // Was on the bench last segment — recover fatigue
        ps.hot = 0; ps.cold = 0;
        ps.minutes = Math.max(0, (ps.minutes || 0) - 8);
      }
    });
  });
  return ng;
}

// ── Deep Clone (simple - avoids React mutation issues) ─────────────────────
export function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

export { checkAssistDraw };
