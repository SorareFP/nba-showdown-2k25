import { useEffect, useState } from 'react';
import { calcAdv, getTeam, getOpp, getPS, getFatigue, SNAKE, SPEND_COSTS, clutchAvailable, burnedSlots } from '../../game/engine.js';
import { canPlayCard, myHouseTargets, fwdTargets, preRollTargets, helpTargets } from '../../game/canPlay.js';
import { benchRest, passTurn } from '../../game/engine.js';
import { getStrat } from '../../game/strats.js';
import { aiDraftPick, aiPlacementPick } from '../../game/ai.js';
import styles from './CourtBoard.module.css';
import { getPlayerImageUrl, getStratImagePath } from '../../game/cardImages.js';
import { useLightbox } from '../CardLightbox.jsx';
import { useDialogs } from '../../ui/dialogs.jsx';
import RollResult from './RollResult.jsx';

function HelpBtn({ section }) {
  const handleClick = (e) => {
    e.stopPropagation();
    window.dispatchEvent(new CustomEvent('showdown-help', { detail: { section } }));
  };
  return <button className={styles.helpBtn} onClick={handleClick} title="How to Play">?</button>;
}

export default function CourtBoard({ game, setGame, onRoll, onEndSection, onExecCard, onResolve, onSpendAssist, onSpendRebound, onDraftSubmit, onPlacePlayer, onTimeout = null, onEndTimeout = null, pvpMode = false, myTeamKey = null, isMyTurn = true, defenceIsHuman = false, rollGate = null }) {
  // ── Solo placement ─────────────────────────────────────────────────────────
  //
  // PvP passes a Firebase-backed onPlacePlayer; solo places locally with the
  // same rules. The AI takes its own steps a beat after the human, through
  // aiPlacementPick — counter-picking whatever just took the floor.
  const soloPlace = (playerId) => {
    const g = JSON.parse(JSON.stringify(game));
    const step = g.placementStep ?? 10;
    if (step >= 10) return;
    const order = g.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const teamKey = order[step];
    const team = teamKey === 'A' ? g.teamA : g.teamB;
    const picks = teamKey === 'A' ? g.draft?.aPicks ?? [] : g.draft?.bPicks ?? [];
    if (!picks.includes(playerId) || team.starters.find(pl => pl.id === playerId)) return;
    const player = (team.roster || []).find(r => r.id === playerId);
    if (!player) return;
    team.starters.push(player);
    g.placementStep = step + 1;
    g.log = [...g.log, { team: teamKey, msg: `${player.name} takes the floor.` }];
    if (g.placementStep === 10) {
      g.matchupTurn = 'A';
      g.matchupPasses = 0;
      g.log = [...g.log, { team: null, msg: 'Placement complete — Matchup Strategy Phase.' }];
    }
    setGame(g);
  };
  const placeHandler = onPlacePlayer ?? soloPlace;

  useEffect(() => {
    if (pvpMode) return;
    const step = game.placementStep ?? 10;
    if (game.phase !== 'matchup_strats' || step >= 10) return;
    const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    if (order[step] !== 'B') return;
    const t = setTimeout(() => {
      const action = aiPlacementPick(game, 'B');
      if (action) soloPlace(action.playerId);
    }, 650);
    return () => clearTimeout(t);
  }, [pvpMode, game]);

  const [modal, setModal] = useState(null);
  const [draftSelected, setDraftSelected] = useState([]);

  const { toast, ask } = useDialogs();
  const openModal = (config) => new Promise(res => setModal({ ...config, resolve: res }));
  const closeModal = (val) => { const r = modal?.resolve; setModal(null); r?.(val); };

  const handleExecCard = async (teamKey, cardId, baseOpts = {}) => {
    const opts = await buildOpts(game, teamKey, cardId, baseOpts, openModal, { toast, ask, defenceIsHuman });
    if (opts === null) return;
    onExecCard(teamKey, cardId, opts);
  };

  return (
    <div className={styles.wrap}>
      <PhaseBar game={game} setGame={setGame} onEndSection={onEndSection} onTimeout={onTimeout} onEndTimeout={onEndTimeout} pvpMode={pvpMode} myTeamKey={myTeamKey} isMyTurn={isMyTurn} draftSelectedCount={draftSelected.length} />

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
                  onPlacePlayer={placeHandler}
                  pvpMode={pvpMode} myTeamKey={myTeamKey} isMyTurn={isMyTurn} rollGate={rollGate} />
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

/**
 * The options a card needs before it can be played — which player, which
 * check, whether to spend an assist.
 *
 * `ui` is `{ toast, ask }`, passed in rather than hooked because this is a
 * plain function. Every one of these used to be an alert() or a confirm(),
 * which BLOCKED THE WHOLE TAB mid-possession: `toast` carries the notes
 * ("nobody is eligible"), `ask` the two that are genuinely questions.
 */
async function buildOpts(game, teamKey, cardId, base, openModal, ui = {}) {
  const toast = ui.toast ?? (() => {});
  const ask = ui.ask ?? (async () => false);
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
    // Roll-replacing / roll-modifying cards — must be pre-roll only.
    'cross_court_dime', 'you_stand_over_there', 'elevator_doors',
    'pin_down_screen', 'from_way_downtown', 'power_move',
    // The answers to a defensive switch — see lastDefSwitch in engine.js.
    'overhelp', 'burned_switch',
    // Wave one of the docx backlog (2026-09-06).
    'spain_pick_roll', 'mismatch_hunter', 'energizer', 'defensive_anchor',
    'five_out', 'hammer_set', 'iso_heavy', 'crash_and_kick', 'pick_and_pop', 'extra_pass',
    'stretch_five', 'post_domination', 'unsung_hero', 'transition_outlet',
    'find_the_open_man', 'putback_specialist', 'hustle_play',
    // Wave two (2026-09-07).
    'outside_pick', 'short_roll_playmaker', 'pick_and_roll_maestro',
  ];

  // Cards that show ALL my starters (no filtering — additive, safe post-roll)
  const unfilteredPlayerCards = [
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
      case 'overhelp': {
        eligible = filterStarters(myT.starters, (p, i) => rolls[i] == null);
        label = 'Select player for +3 (must not have rolled yet)';
        break;
      }
      case 'burned_switch': {
        const burned = burnedSlots(game, game.lastDefSwitch);
        eligible = filterStarters(myT.starters, (p, i) => burned.includes(i) && rolls[i] == null);
        label = 'Select the player whose new defender is weaker';
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
      case 'spain_pick_roll': {
        eligible = filterStarters(myT.starters, (p, i) => { const dp = defenders[offMatchups[i] ?? i]; return dp && p.speed > dp.speed; });
        label = 'Select a player faster than their defender';
        break;
      }
      case 'mismatch_hunter': {
        eligible = filterStarters(myT.starters, (p, i) => {
          const dp = defenders[offMatchups[i] ?? i];
          if (!dp) return false;
          const a = calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i);
          return Math.max(a.speedAdv, a.powerAdv) >= 4;
        });
        label = 'Select the mismatch (+4 Speed or Power advantage)';
        break;
      }
      case 'energizer': {
        eligible = filterStarters(myT.starters, p => (p.salary || 0) < 250);
        label = 'Select a player under $250 (+3/+3 on defense)';
        break;
      }
      case 'defensive_anchor': {
        eligible = filterStarters(myT.starters, p => (p.defBoost || 0) >= 3);
        label = 'Select your anchor (Defensive Bonus +3 or more)';
        break;
      }
      case 'five_out': {
        eligible = preRollTargets(game, teamKey, p => (p.threePtBoost || 0) > 0).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = 'Select a 3PT shooter — two checks at +1 instead of the roll';
        break;
      }
      case 'hammer_set': {
        eligible = filterStarters(myT.starters, (p, i) => {
          if ((p.threePtBoost || 0) > 0) return false;
          const dp = defenders[offMatchups[i] ?? i];
          return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0;
        });
        label = 'Select a non-shooter with a Speed advantage';
        break;
      }
      case 'iso_heavy': case 'unsung_hero': {
        eligible = preRollTargets(game, teamKey, cardId === 'unsung_hero' ? (p => (p.salary || 0) <= 400) : undefined).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = cardId === 'iso_heavy' ? 'Who takes over? (+3, teammates −2)' : 'Select a $400-or-less player (two dice, keep higher)';
        break;
      }
      case 'crash_and_kick': case 'extra_pass': case 'putback_specialist': {
        eligible = filterStarters(myT.starters, () => true);
        label = cardId === 'putback_specialist' ? 'Who takes the paint check at +3?' : 'Who takes the shot check?';
        break;
      }
      case 'pick_and_pop': {
        eligible = filterStarters(myT.starters, p => (p.threePtBoost || 0) > 0);
        label = 'Select a 3PT shooter (check at +1; hit = +2 AST back)';
        break;
      }
      case 'stretch_five': {
        eligible = filterStarters(myT.starters, p => String(p.pos || '').split(/[-/]/).some(t => t === 'C' || t === 'PF') && ((p.shotLine ?? 18) - (p.threePtBoost || 0)) <= 14);
        label = 'Select the stretch big (3PT check)';
        break;
      }
      case 'post_domination': {
        eligible = filterStarters(myT.starters, p => (p.power || 0) >= 15);
        label = 'Whose rebounds are doubled this period?';
        break;
      }
      case 'transition_outlet': {
        eligible = filterStarters(myT.starters, (p, i) => { const dp = defenders[offMatchups[i] ?? i]; return dp && calcAdv(p, dp, game.tempEff?.[teamKey] || {}, i).speedAdv > 0; });
        label = 'Select a player with a Speed advantage (check at +2)';
        break;
      }
      case 'find_the_open_man': {
        const trapped = game.lastDoubleTeam?.targetIdx;
        eligible = preRollTargets(game, teamKey, (p, i) => i !== trapped).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = 'Who is open? (+4 roll)';
        break;
      }
      case 'hustle_play': {
        eligible = filterStarters(myT.starters, p => (p.salary || 0) < 400 && (p.defBoost || 0) > 0);
        label = 'Select the hustler (under $400, subtracts their Defensive Bonus)';
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
      // Roll-replacing / roll-modifying cards — must be pre-roll only.
      // A shot check, not a roll: playable on a player whose roll was skipped
      // by their own card. See fwdTargets in canPlay.js.
      case 'from_way_downtown': {
        eligible = fwdTargets(game, teamKey).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = 'Select shooter (not rolled yet, or roll skipped)';
        break;
      }
      // The same list playability checked — see preRollTargets in canPlay.js.
      case 'cross_court_dime':
      case 'you_stand_over_there':
      case 'pin_down_screen':
      case 'power_move': {
        eligible = preRollTargets(game, teamKey).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = 'Select player (must not have rolled yet)';
        break;
      }
      case 'elevator_doors': {
        eligible = preRollTargets(game, teamKey, p => (p.threePtBoost || 0) > 0).map(({ p, idx }) => ({ p, origIdx: idx }));
        label = 'Select 3PT player (must not have rolled yet)';
        break;
      }
      default:
        eligible = filterStarters(myT.starters, () => true);
        label = 'Select target player';
    }

    if (eligible.length === 0) { toast('No eligible players for this card.'); return null; }

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
      const spend = await ask({
        title: 'Spend 1 Assist for +1 to this shot check?',
        body: `${ast} assist${ast === 1 ? '' : 's'} available.`,
        confirmLabel: 'Spend it',
        cancelLabel: 'Save it',
      });
      if (spend) {
        opts.spendAssistBoost = true;
      }
    }
  }

  // ── Help Defender: which mismatch, and who rotates over ────────────────
  if (cardId === 'help_defender') {
    const targets = helpTargets(game, teamKey);
    if (targets.length === 0) { toast('No opponent yet to roll is beating his defender by +4.'); return null; }
    const t = targets.length === 1 ? 0 : await pickFiltered(
      targets.map(x => ({ p: x.off, origIdx: x.offSlot })),
      'Who is beating his man?', teamKey
    );
    if (t === null) return null;
    const chosen = targets.find(x => x.offSlot === t) ?? targets[0];
    opts.targetIdx = chosen.offSlot;
    const helpers = myT.starters
      .map((p, i) => ({ p, origIdx: i }))
      .filter(({ origIdx }) => origIdx !== chosen.defIdx);
    const h = await pickFiltered(helpers, 'Who rotates over? (his man gets +3)', teamKey);
    if (h === null) return null;
    opts.helperIdx = h;
  }

  // ── Stretch Five: the teammate who takes the paint check ───────────────
  if (cardId === 'stretch_five') {
    const mates = myT.starters.map((p, i) => ({ p, origIdx: i })).filter(({ origIdx }) => origIdx !== opts.playerIdx);
    const m = await pickFiltered(mates, 'Select the teammate for the paint check at +2', teamKey);
    if (m === null) return null;
    opts.player2Idx = m;
  }
  // ── Extra Pass / Transition Outlet: which check ────────────────────────
  if (cardId === 'extra_pass' || cardId === 'transition_outlet') {
    // NOT A CONFIRM — a choice between two things. It only ever wore a
    // confirm's clothes because confirm() was the only dialog available, and
    // "Cancel = Paint check" is what that costs you.
    opts.checkType = await ask({
      title: 'Which check do you want?',
      confirmLabel: '3PT check',
      cancelLabel: 'Paint check',
    }) ? '3pt' : 'paint';
  }
  // ── Three-Point Barrage: spend 1 AST for one more check ────────────────
  if (cardId === 'three_point_barrage' && myT.assists >= 1) {
    const extra = await ask({
      title: 'Spend 1 Assist for one extra 3PT check?',
      body: `${myT.assists} assist${myT.assists === 1 ? '' : 's'} available.`,
      confirmLabel: 'Spend it',
      cancelLabel: 'Save it',
    });
    if (extra) {
      const shooters = myT.starters.map((p, i) => ({ p, origIdx: i }));
      const s = await pickFiltered(shooters, 'Who takes the extra 3PT check?', teamKey);
      if (s !== null) opts.extraShooterIdx = s;
    }
  }
  // ── Pin Down Screen, Lob City, Denial, Outside Pick: discard from hand ──
  if (cardId === 'pin_down_screen' || cardId === 'lob_city' || cardId === 'denial' || cardId === 'outside_pick') {
    const handWithoutThis = myT.hand.filter(id => id !== cardId);
    if (handWithoutThis.length === 0) { toast('No cards to discard.'); return null; }
    const discardPlayers = handWithoutThis.map((id, i) => ({ id, name: id.replace(/_/g, ' '), origIdx: i }));
    const discardDisplay = discardPlayers.map(d => ({ ...d, name: d.name }));
    const pick = await openModal({ teamKey, cardId, players: discardDisplay, label: `Discard a card for ${cardId.replace(/_/g, ' ')}` });
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
    if (!lc) { toast('No switch to react to.'); return null; }
    // The switch was on the opponent's offense — pick which of YOUR players benefited
    // Show your starters and ask who got the weaker defender after the switch
    const idx = await openModal({ teamKey, cardId, players: myT.starters, label: 'Select your player who got a weaker defender' });
    if (idx === null) return null;
    opts.playerIdx = idx;
    // Track original and new defender from the switch
    opts.originalDefIdx = lc.opts.origD1;
    opts.newDefIdx = lc.opts.origD2;
  }

  // ── Run the Floor / Twin Towers: the DEFENCE places the two checks ─────
  //
  // The only choice in the game that belongs to the player whose turn it is
  // NOT. It is offered when a person is sitting on the other side (hotseat);
  // against the coach, and in PvP where the defender is on another machine
  // and would need a synced decision, the engine allocates the way a rational
  // opponent would — see allocateStandingChecks.
  if (cardId === 'run_the_floor' || cardId === 'twin_towers') {
    const isFloor = cardId === 'run_the_floor';
    const standing = (game.standing || []).find(e => e.teamKey === teamKey && e.cardId === cardId);
    const eligible = filterStarters(myT.starters, p => p && (standing
      ? standing.playerIds.includes(p.id)
      : (isFloor ? (p.speed || 0) >= 12 : (p.power || 0) >= 14)));
    if (eligible.length === 0) { toast('None of its players are on the floor.'); return null; }
    if (ui.defenceIsHuman) {
      const label = n => `DEFENCE: who takes check ${n} of 2? (paint at +2)`;
      const first = await pickFiltered(eligible, label(1), teamKey);
      if (first === null) return null;
      const second = await pickFiltered(eligible, label(2), teamKey);
      if (second === null) return null;
      opts.allocation = [first, second];
    }
  }

  // ── Short-Roll Playmaker: the 8/8 facilitator ──────────────────────────
  if (cardId === 'short_roll_playmaker') {
    const eligible = filterStarters(myT.starters, p => p && (p.speed || 0) >= 8 && (p.power || 0) >= 8);
    if (eligible.length === 0) { toast('Nobody on the floor has Speed 8+ and Power 8+.'); return null; }
    const pick = await pickFiltered(eligible, 'Who is your short-roll facilitator?', teamKey);
    if (pick === null) return null;
    opts.playerIdx = pick;
  }

  // ── Pick-and-Roll Maestro: the ball-handler, then who he trades with ────
  if (cardId === 'pick_and_roll_maestro') {
    const fast = filterStarters(myT.starters, p => p && (p.speed || 0) >= 14);
    if (fast.length === 0) { toast('Nobody on the floor is Speed 14+.'); return null; }
    const who = await pickFiltered(fast, 'Who runs the pick-and-roll? (Speed 14+)', teamKey);
    if (who === null) return null;
    opts.playerIdx = who;
    // The mismatch it BUYS, shown before the choice: this is the whole card.
    const mine = myT.starters[who];
    const mates = filterStarters(myT.starters, (p, i) => p && i !== who);
    // THE MISMATCH EACH SWAP WOULD BUY, on the option itself — the whole card
    // is this choice, and making it blind would be making it a coin flip.
    const mate = await pickFiltered(
      mates,
      `Swap ${mine?.name}'s defender with whose?`,
      teamKey,
      (p, origIdx) => {
        const d = defenders[offMatchups[origIdx]];
        const gap = (mine?.speed || 0) - (d?.speed || 0);
        return `→ draws ${d?.name}, ${gap >= 5 ? `${gap} slower — CHECK` : `only ${gap} slower, no check`}`;
      }
    );
    if (mate === null) return null;
    opts.player2Idx = mate;
  }

  // ── Inside-Out: who gets the kick-out three ────────────────────────────
  if (cardId === 'inside_out') {
    const scorer = game.lastPaintScore;
    if (!scorer || scorer.teamKey !== teamKey) { toast('No paint score of yours to play off.'); return null; }
    const mates = filterStarters(myT.starters, (p, i) => p && i !== scorer.playerIdx);
    if (mates.length === 0) { toast('No teammate to kick out to.'); return null; }
    const mate = await pickFiltered(mates, 'Kick it out to whom?', teamKey);
    if (mate === null) return null;
    opts.player2Idx = mate;
  }

  // ── Cold Spell: target OPPONENT who rolled natural 1 or 2 ──────────────
  if (cardId === 'cold_spell') {
    const oppRolls = game.rollResults[oppKey] || [];
    const eligible = filterStarters(oppT.starters, (p, i) => {
      const r = oppRolls[i];
      return r && (r.die === 1 || r.die === 2) && !r.coldSpellUsed;
    });
    if (eligible.length === 0) { toast('No opponent rolled a natural 1 or 2.'); return null; }
    const idx = await pickFiltered(eligible, 'Apply Cold Spell to:', oppKey,
      (p, oi) => `(rolled ${oppRolls[oi]?.die})`);
    if (idx === null) return null;
    opts.playerIdx = idx;
  }

  // ── Dogged: target fatigued OPPONENT ───────────────────────────────────
  if (cardId === 'dogged') {
    const eligible = filterStarters(oppT.starters, (_, i) => getFatigue(game, oppKey, i) < 0);
    if (eligible.length === 0) { toast('No fatigued opponent players.'); return null; }
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
    if (cheapPlayers.length === 0) { toast('No second player with salary under $400.'); return null; }
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
  // Only the opponents the engine would accept — myHouseTargets is the same
  // list the playability check uses, so a card that is lit in the hand always
  // has at least one, and nothing offered here can be refused afterwards. The
  // old list was "anyone who has not rolled", which put targets the defender
  // could not beat in front of the player and then rejected the pick.
  if (cardId === 'this_is_my_house') {
    const targets = myHouseTargets(game, teamKey);
    if (targets.length === 0) return null; // greyed in the hand; nothing to say
    const display = targets.map(({ off }) => off);
    const extraInfo = targets.map(
      ({ off, def }) => `S${off.speed}/P${off.power} — guarded by your ${def.name} (S${def.speed}/P${def.power})`
    );
    const pick = await openModal({
      teamKey: oppKey, cardId, players: display, label: 'Shut out which opponent?', extraInfo,
    });
    if (pick === null) return null;
    opts.offSlot = targets[pick].offSlot;
  }

  // ── Pick Up Full Court: choose which opposing player to hound ──────────
  if (cardId === 'pick_up_full_court') {
    const minsInfo = oppT.starters.map(p => {
      const ps = getPS(game, oppKey, p.id);
      return `${ps?.minutes || 0} min on the fatigue tracker`;
    });
    const pick = await openModal({ teamKey: oppKey, cardId, players: oppT.starters, label: 'Hound which opponent? (−1 roll + 4 min fatigue)', extraInfo: minsInfo });
    if (pick === null) return null;
    opts.targetIdx = pick;
  }

  // ── Double Team: pick the opposing player to trap ──────────────────────
  if (cardId === 'double_team') {
    const oppRolls = game.rollResults[oppKey] || [];
    const eligible = oppT.starters
      .map((p, i) => ({ p, origIdx: i }))
      .filter(({ origIdx }) => oppRolls[origIdx] == null);
    if (eligible.length < 2) {
      toast('Needs two opposing players who have not rolled yet.');
      return null;
    }
    const display = eligible.map(({ p }) => p);
    const pick = await openModal({ teamKey: oppKey, cardId, players: display, label: 'Trap which opponent? (+6/+6 to their defender — but they get +3 on their next roll)' });
    if (pick === null) return null;
    opts.targetIdx = eligible[pick].origIdx;
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
    if (!lc) { toast('No switch card to react to.'); return null; }
    // The two defenders in the screen are the only ones who can switch: the
    // choice is who guards the first screened attacker, and the other takes
    // the second. (It used to offer all five for each slot, which is not a veer.)
    const offT = getTeam(game, lc.teamKey);
    const p1 = offT.starters[lc.opts.swapSlot1];
    const p2 = offT.starters[lc.opts.swapSlot2];
    const pair = [lc.opts.origD1, lc.opts.origD2];
    const fmtVeer = (a) => {
      const sA = a.speedAdv > 0 ? `+${a.speedAdv}` : `${a.speedAdv}`;
      const pA = a.powerAdv > 0 ? `+${a.powerAdv}` : `${a.powerAdv}`;
      const rollStr = a.rollBonus > 0 ? `+${a.rollBonus}` : a.hasPenalty ? `${a.rollBonus}` : '0';
      return `${sA} spd · ${pA} pwr → roll ${rollStr}`;
    };
    const eff = game.tempEff?.[lc.teamKey] || {};
    const info = pair.map((di, k) => {
      const other = pair[1 - k];
      const on1 = fmtVeer(calcAdv(p1, myT.starters[di], eff, lc.opts.swapSlot1));
      const on2 = fmtVeer(calcAdv(p2, myT.starters[other], eff, lc.opts.swapSlot2));
      return `${p1?.name} gets ${on1}; ${p2?.name} vs ${myT.starters[other]?.name} gets ${on2}`;
    });
    const pick = await openModal({ teamKey, cardId, players: pair.map(di => myT.starters[di]), label: `🛡 Veer Switch — who guards ${p1?.name}? (${p2?.name} takes the other)`, extraInfo: info });
    if (pick === null) return null;
    opts.newDefender1 = pair[pick];
    opts.newDefender2 = pair[1 - pick];
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
    const ok = await ask({
      title: 'Switch Everything — review the assignments',
      lines: reviewLines,
      warn: 'All opponent advantages will be DOUBLED.',
      confirmLabel: 'Switch everything',
    });
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

function PhaseBar({ game, setGame, onEndSection, onTimeout = null, onEndTimeout = null, pvpMode = false, myTeamKey = null, isMyTurn = true, draftSelectedCount = 0 }) {
  const { phase, quarter, section, matchupTurn, matchupPasses, scoringTurn, scoringPasses } = game;
  const rA = game.rollResults.A || [], rB = game.rollResults.B || [];
  // A player is "done" if they have a roll result OR they are blocked
  const isDone = (rr, blocked, i) => rr[i] != null || (blocked?.[i] === true);
  const bA = game.blockedRolls?.A || {}, bB = game.blockedRolls?.B || {};
  const allRolled = [0,1,2,3,4].every(i => isDone(rA,bA,i)) && [0,1,2,3,4].every(i => isDone(rB,bB,i));
  const rollingOpen = scoringPasses >= 99;

  // Whoever holds the turn passes — the engine owns the rule (passTurn).
  const pass = () => setGame(passTurn(game, phase === 'matchup_strats' ? matchupTurn : scoringTurn));
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
    const step = game.placementStep ?? 10;
    const inPlacement = step < 10;
    const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = inPlacement ? order[step] : matchupTurn;
    const activeCol = activeTeam === 'A' ? 'var(--orange)' : 'var(--blue)';

    return (
      <div className={styles.phaseBar}>
        <div className={styles.phaseInfo}>
          <span className={styles.phaseLabel}>
            Q{quarter} · Sec {section}/3 · Matchup Strategy
            {inPlacement && <span> · Placement {step}/10</span>}
            <HelpBtn section="matchup" />
          </span>
          <span className={styles.phaseSub}>
            {inPlacement
              ? 'Place your players (strategy cards also playable)'
              : 'Play a card or pass twice to start scoring'}
          </span>
        </div>
        <div className={styles.phaseCtrls}>
          <span style={{color:activeCol,fontWeight:600}}>Team {activeTeam}</span>
          {!inPlacement && <span className={styles.passCount}>{matchupPasses}/2 passes</span>}
          <button className={styles.passBtn} onClick={pass} disabled={inPlacement || (pvpMode && !isMyTurn)}>Pass →</button>
          <button className={styles.ctaBtn} onClick={lock} disabled={inPlacement || (pvpMode && !isMyTurn)}>Lock → Scoring</button>
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
          {['A', 'B'].map(k => {
            // `openMan` carries its exclusions now — the trapped man cannot be
            // the open man. Reads the old bare-number shape too.
            const om = game.openMan?.[k];
            const pts = typeof om === 'number' ? om : (om?.pts ?? 0);
            if (!pts) return null;
            const team = k === 'A' ? game.teamA : game.teamB;
            const barred = (typeof om === 'object' ? om.except ?? [] : [])
              .map(i => team.starters[i]?.name).filter(Boolean);
            return (
              <span key={k} className={styles.phaseSub} style={{ color: k === 'A' ? 'var(--orange)' : 'var(--blue)' }}>
                🎯 Team {k} has an open man: +{pts} on their next roll
                {barred.length ? ` — anyone but ${barred.join(' or ')}` : ''}
              </span>
            );
          })}
          {game.crunch?.active && <span className={styles.phaseSub} style={{color:'#F87171',fontWeight:700}}>🚨 CRUNCH TIME · margin {game.crunch.margin} · clutch, timeouts & crunch cards live</span>}
          {game.timeoutActive && <span className={styles.phaseSub} style={{color:'#FBBF24'}}>⏸ Team {game.timeoutActive} timeout — defense re-set, timeout cards playable</span>}
        </div>
        <div className={styles.phaseCtrls}>
          {(segA>0||segB>0) && <span className={styles.segScore}><span style={{color:'var(--orange)'}}>A {segA}</span>–<span style={{color:'var(--blue)'}}>{segB} B</span></span>}
          {!rollingOpen && <button className={styles.passBtn} onClick={pass} disabled={pvpMode && !isMyTurn}>Pass →</button>}
          {onTimeout && game.crunch?.active && rollingOpen && !game.timeoutActive && !game.crunch.timeoutUsed?.[pvpMode ? myTeamKey : 'A'] && (!pvpMode || isMyTurn) &&
            <button className={styles.passBtn} onClick={() => onTimeout(pvpMode ? myTeamKey : 'A')}>⏸ Timeout</button>}
          {onEndTimeout && game.timeoutActive === (pvpMode ? myTeamKey : 'A') &&
            <button className={styles.ctaBtn} onClick={onEndTimeout}>▶ Resume play</button>}
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

function MatchupRow({ idx, game, setGame, onRoll, onExecCard, onSpendAssist, onSpendRebound, onPlacePlayer, pvpMode = false, myTeamKey = null, isMyTurn = true, rollGate = null }) {
  if (game.phase === 'draft') return null; // Draft handled by BlindPickPhase
  const ap=game.teamA.starters[idx], bp=game.teamB.starters[idx];
  // During placement phase, empty slots need special handling
  const step = game.placementStep ?? 10;
  const inPlacement = game.phase === 'matchup_strats' && step < 10;

  if (!ap || !bp) {
    if (!inPlacement) {
      return <div className={styles.emptyRow}/>;
    }
    // Figure out which side is the "next to be placed" given the snake order
    const order = game.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    const activeTeam = order[step];
    const aCount = game.teamA.starters.length;
    const bCount = game.teamB.starters.length;
    const isActiveSlotA = activeTeam === 'A' && idx === aCount;
    const isActiveSlotB = activeTeam === 'B' && idx === bCount;

    return (
      <div className={styles.matchupRow}>
        <div className={styles.placementSlot}>
          {ap ? (
            <PlayerSlot player={ap} ps={getPS(game,'A',ap.id)||{}} adv={null}
              fat={getFatigue(game,'A',idx)} result={null} blocked={null}
              teamKey="A" idx={idx} phase={game.phase} game={game}
              defPlayer={null} defSelect={[]} defIdx={0}
              onDefChange={()=>{}} onRoll={()=>{}} pvpDisabled={true} />
          ) : isActiveSlotA && (!pvpMode || myTeamKey === 'A') ? (
            /* Solo's human coaches Team A, so the affordance opens for them
               too; Team B stays hands-off — the AI places via its effect. */
            <PlacementAffordance game={game} teamKey="A" onPlacePlayer={onPlacePlayer} />
          ) : (
            <div className={styles.placementWaiting}>
              {activeTeam === 'A' ? 'Team A is placing…' : 'Awaiting pick'}
            </div>
          )}
        </div>
        <div className={styles.connector}>
          <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
        </div>
        <div className={styles.placementSlot}>
          {bp ? (
            <PlayerSlot player={bp} ps={getPS(game,'B',bp.id)||{}} adv={null}
              fat={getFatigue(game,'B',idx)} result={null} blocked={null}
              teamKey="B" idx={idx} phase={game.phase} game={game}
              defPlayer={null} defSelect={[]} defIdx={0}
              onDefChange={()=>{}} onRoll={()=>{}} pvpDisabled={true} />
          ) : isActiveSlotB && pvpMode && myTeamKey === 'B' ? (
            <PlacementAffordance game={game} teamKey="B" onPlacePlayer={onPlacePlayer} />
          ) : (
            <div className={styles.placementWaiting}>
              {activeTeam === 'B' ? 'Team B is placing…' : 'Awaiting pick'}
            </div>
          )}
        </div>
      </div>
    );
  }
  const aDefIdx=game.offMatchups.A[idx], bDefIdx=game.offMatchups.B[idx];
  const aDef=game.teamB.starters[aDefIdx], bDef=game.teamA.starters[bDefIdx];
  return (
    <div className={styles.matchupRow}>
      <PlayerSlot player={ap} ps={getPS(game,'A',ap.id)||{}} adv={aDef?calcAdv(ap,aDef,game.tempEff?.A||{},idx,game.tempDefEff?.B,aDefIdx):null}
        fat={getFatigue(game,'A',idx)} result={(game.rollResults.A||[])[idx]} blocked={game.blockedRolls?.A?.[idx]}
        teamKey="A" idx={idx} phase={game.phase} game={game}
        defPlayer={aDef} defSelect={game.teamB.starters} defIdx={aDefIdx}
        onDefChange={di=>{const g=JSON.parse(JSON.stringify(game));g.offMatchups.A[idx]=di;setGame(g);}}
        onRoll={()=>onRoll('A',idx)} onClutch={()=>onRoll('A',idx,{clutch:true})} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
        pvpDisabled={pvpMode && myTeamKey !== 'A'} rollLocked={rollGate ? !rollGate.A : false} />
      <div className={styles.connector}>
        <div className={styles.connLine}/><div className={styles.slotNum}>{idx+1}</div><div className={styles.connLine}/>
      </div>
      <PlayerSlot player={bp} ps={getPS(game,'B',bp.id)||{}} adv={bDef?calcAdv(bp,bDef,game.tempEff?.B||{},idx,game.tempDefEff?.A,bDefIdx):null}
        fat={getFatigue(game,'B',idx)} result={(game.rollResults.B||[])[idx]} blocked={game.blockedRolls?.B?.[idx]}
        teamKey="B" idx={idx} phase={game.phase} game={game}
        defPlayer={bDef} defSelect={game.teamA.starters} defIdx={bDefIdx}
        onDefChange={di=>{const g=JSON.parse(JSON.stringify(game));g.offMatchups.B[idx]=di;setGame(g);}}
        onRoll={()=>onRoll('B',idx)} onClutch={()=>onRoll('B',idx,{clutch:true})} onSpendAssist={onSpendAssist} onSpendRebound={onSpendRebound}
        pvpDisabled={pvpMode && myTeamKey !== 'B'} rollLocked={rollGate ? !rollGate.B : false} />
    </div>
  );
}

// ── Placement Affordance ─────────────────────────────────────────────────
// Shown in the active placer's next empty slot during snake placement.
// Reads my picks from game.draft.aPicks / bPicks and shows remaining ones.
function PlacementAffordance({ game, teamKey, onPlacePlayer }) {
  const [open, setOpen] = useState(false);
  const pickIds = teamKey === 'A' ? (game.draft?.aPicks || []) : (game.draft?.bPicks || []);
  const team = teamKey === 'A' ? game.teamA : game.teamB;
  const placedIds = new Set(team.starters.map(p => p.id));
  const roster = team.roster || [];
  const remaining = pickIds.filter(id => !placedIds.has(id));

  // If the opposing team has already placed someone in my upcoming slot,
  // my pick will defend against them. Preview the matchup for each candidate.
  const mySlot = team.starters.length;
  const oppKey = teamKey === 'A' ? 'B' : 'A';
  const oppTeam = oppKey === 'A' ? game.teamA : game.teamB;
  const oppPlayer = oppTeam.starters[mySlot] || null;

  if (remaining.length === 0) return <div className={styles.placementWaiting}>Placed.</div>;

  return (
    <div className={styles.placementAffordance}>
      {!open ? (
        <button className={styles.placementBtn} onClick={() => setOpen(true)}>
          Place next player →
        </button>
      ) : (
        <div className={styles.placementPopover}>
          <div className={styles.placementHeader}>
            {oppPlayer
              ? <>Slot {mySlot + 1} pairs with <b>{oppPlayer.name}</b> (S{oppPlayer.speed}·P{oppPlayer.power}) — both ways</>
              : 'Choose a player:'}
          </div>
          {remaining.map(id => {
            const p = roster.find(r => r.id === id);
            if (!p) return null;
            // A SLOT IS A PAIRING, NOT A POST. Placing here puts my player on
            // defence against theirs AND on offence against them — offMatchups
            // starts as the identity both ways. The preview used to show only
            // the first (the user, 2026-09-07: "I'm not seeing what MY player's
            // boost would be"). Now: my attack on the left, their attack on the
            // right, each coloured from my side of the table.
            const mine = oppPlayer ? calcAdv(p, oppPlayer, {}, 0) : null;   // I attack them
            const theirs = oppPlayer ? calcAdv(oppPlayer, p, {}, 0) : null; // they attack me
            const good = '#4ADE80', bad = '#F87171', flat = '#94A3B8';
            const mineCol = mine ? (mine.rollBonus > 0 ? good : mine.hasPenalty ? bad : flat) : flat;
            // Their roll bonus is bad for me, so the colours flip.
            const theirsCol = theirs ? (theirs.rollBonus > 0 ? bad : theirs.hasPenalty ? good : flat) : flat;
            const sgn = n => (n > 0 ? '+' : '') + n;
            const fmt = a => 'S' + sgn(a.rawSpeedDiff) + ' P' + sgn(a.rawPowerDiff) + ' · roll ' + sgn(a.rollBonus) + (a.hasPenalty ? ' ⚠' : '');
            return (
              <button key={id} className={styles.placementOption}
                onClick={() => { setOpen(false); onPlacePlayer(id); }}>
                <span className={styles.placementName}>{p.name}</span>
                <span className={styles.placementStats}>S{p.speed}·P{p.power}·D{p.defBoost||0}</span>
                {mine && theirs && (
                  <span className={styles.placementBoth}>
                    <span className={styles.placementAdv} style={{ color: mineCol }} title="What my player gets attacking them">⚔ {fmt(mine)}</span>
                    <span className={styles.placementAdv} style={{ color: theirsCol }} title="What their player gets attacking mine">🛡 {fmt(theirs)}</span>
                  </span>
                )}
              </button>
            );
          })}
          <button className={styles.placementCancel} onClick={() => setOpen(false)}>Cancel</button>
        </div>
      )}
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

    // ── SOLO GETS THE PLACEMENT SNAKE TOO ─────────────────────────────────
    //
    // The chosen fives move to pick lists and the starters empty back out, so
    // the same snake PvP runs decides who lines up opposite whom — the row a
    // player lands in IS his starting matchup. Before this, solo rows paired
    // by pick order and neither side ever chose an assignment.
    g.draft.aPicks = g.teamA.starters.map(pl => pl.id);
    g.draft.bPicks = g.teamB.starters.map(pl => pl.id);
    g.teamA.starters = [];
    g.teamB.starters = [];
    g.placementStep = 0;
    g.placementOrder = g.placementOrder || ['A','B','B','A','A','B','B','A','A','B'];
    g.phase = 'matchup_strats';
    g.log = [...g.log, { team: null, msg: 'Lineups locked — begin placement.' }];

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
          const imgUrl = getPlayerImageUrl(p.id, p.set);

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
      ['A','B'].forEach(k=>{const t=k==='A'?g.teamA:g.teamB;t.stats.forEach(ps=>{if(!t.starters.find(p=>p.id===ps.id))benchRest(ps);});});
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
  const pImgUrl = getPlayerImageUrl(player.id, player.set);
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

/** The temporary, card-driven effects on one slot — see the note at its call site. */
function LiveEffects({ game, teamKey, idx }) {
  const te = game.tempEff?.[teamKey] || {};
  const de = game.tempDefEff?.[teamKey]?.[idx];
  const sgn = n => (n > 0 ? '+' : '') + n;
  const tags = [];
  const push = (key, cls, text, title) => tags.push(
    <span key={key} className={styles.live + ' ' + cls} title={title}>{text}</span>
  );
  if (te['r' + idx])    push('r',    styles.liveGood, 'roll ' + sgn(te['r' + idx]), 'Temporary scoring-roll bonus this period');
  if (te['s' + idx])    push('s',    te['s' + idx] > 0 ? styles.liveGood : styles.liveBad, 'SPD ' + sgn(te['s' + idx]), 'Temporary Speed this segment');
  if (te['p' + idx])    push('p',    te['p' + idx] > 0 ? styles.liveGood : styles.liveBad, 'PWR ' + sgn(te['p' + idx]), 'Temporary Power this segment');
  if (te['adv' + idx])  push('adv',  styles.liveGood, '2d20 ↑', 'Rolls two dice, keeps the higher');
  if (te['dis' + idx])  push('dis',  styles.liveBad,  '2d20 ↓', 'Rolls two dice, keeps the lower');
  if (te['reb2' + idx]) push('reb2', styles.liveGood, 'REB ×2', 'Rebounds from scoring rolls are doubled');
  if (te['astOnScore' + idx]) push('ast',  styles.liveGood, '+AST on score', 'A score adds an assist');
  if (te['paintAst' + idx])   push('past', styles.liveGood, '+AST inside', 'A paint score adds an assist (Short-Roll Playmaker)');
  if (de && (de.speedBoost || de.powerBoost)) {
    push('def', styles.liveDef, 'D +' + (de.speedBoost || 0) + '/+' + (de.powerBoost || 0),
      'Defensive Speed/Power boost this segment (Double Team, Energizer, Defensive Identity, Defensive Stopper)');
  }
  if (game.ghosted?.[teamKey]?.[idx])    push('ghost', styles.liveGood, '👻 no defender', 'Ghost Screen: treated as unguarded for matchups');
  if (game.ignFatigue?.[teamKey]?.[idx]) push('wind',  styles.liveGood, 'ignores FAT', 'Second Wind: fatigue penalty ignored this segment');
  const om = game.openMan?.[teamKey];
  if (om && typeof om === 'object' && om.except?.includes(idx)) push('trapped', styles.liveBad, 'trapped', 'Doubled — cannot be the open man');
  return tags.length ? <div className={styles.liveRow}>{tags}</div> : null;
}

function PlayerSlot({ player, ps, adv, fat, result, blocked, teamKey, idx, phase, game, defPlayer, defSelect, defIdx, onDefChange, onRoll, onClutch = null, onSpendAssist, onSpendRebound, pvpDisabled = false, rollLocked = false }) {
  const { open } = useLightbox();
  const col=teamKey==='A'?'var(--orange)':'var(--blue)';
  const rollCol=adv?(adv.rollBonus>0?'#4ADE80':adv.hasPenalty?'#F87171':'#94A3B8'):'#94A3B8';
  const allStats=[...game.teamA.stats,...game.teamB.stats];
  const min=allStats.find(s=>s.id===player.id)?.minutes||0;
  const myHand=(teamKey==='A'?game.teamA:game.teamB).hand;
  const glowCheap=(myHand.some(id=>['chip_on_shoulder'].includes(id))&&player.salary<=250)||
                  (myHand.some(id=>['crowd_favorite'].includes(id))&&player.salary<=350);

  const imgUrl = getPlayerImageUrl(player.id, player.set);
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
        {/* WHAT IS ACTING ON THIS PLAYER RIGHT NOW. The printed boosts above
            never change; these come and go with cards, and until now the only
            place they showed was the log — which is how a +6/+6 on a defender
            and an itemised shot check both became bug reports on the same
            night (the user, 2026-09-07: "There should be indications on cards
            ... when something is boosting one of their traits at the moment").
            Each badge names its source in the tooltip. */}
        <LiveEffects game={game} teamKey={teamKey} idx={idx} />
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
            :result!=null?<RollResult result={result} col={col} />
            :<>
              <button className={styles.rollBtn} style={{background:col}} onClick={onRoll} disabled={pvpDisabled || rollLocked}
                title={rollLocked ? 'Their roll — play a reaction now, or wait for the die' : undefined}>
                {rollLocked ? '🎲 Their roll' : '🎲 Roll'}
              </button>
              {onClutch && !pvpDisabled && !rollLocked && game.crunch?.active && clutchAvailable(game, teamKey) > 0 && fat > -6 &&
                <button className={styles.rollBtn} style={{background:'#B45309'}} title={`Clutch Possession: roll ${2 + (game.clutchDice?.[player.id] || 0)} dice, keep the best`} onClick={onClutch}>⭐ Clutch ({2 + (game.clutchDice?.[player.id] || 0)})</button>}
            </>}
            {/* Assist spending buttons — costs come from SPEND_COSTS so the
                buttons can never show at a count the engine will refuse */}
            {onSpendAssist && !pvpDisabled && (() => {
              const myT = teamKey==='A'?game.teamA:game.teamB;
              const ast = myT.assists;
              const has3pt = (player.threePtBoost||0) > 0;
              const hasPaint = (player.paintBoost||0) > 0;
              const c3 = SPEND_COSTS.assistThree, cP = SPEND_COSTS.assistPaint;
              const anyBtn = (ast>=c3 && has3pt) || (ast>=cP && hasPaint);
              if (!anyBtn) return null;
              return (
                <div className={styles.assistSpend}>
                  {ast>=c3 && has3pt && <button className={styles.astBtn} title={`Spend ${c3} AST: 3PT shot check`} onClick={()=>onSpendAssist(teamKey,'3pt',idx)}>3PT ({c3}A)</button>}
                  {ast>=cP && hasPaint && <button className={styles.astBtn} title={`Spend ${cP} AST: Paint shot check`} onClick={()=>onSpendAssist(teamKey,'paint',idx)}>Paint ({cP}A)</button>}
                </div>
              );
            })()}
            {/* Rebound bonus buttons */}
            {onSpendRebound && !pvpDisabled && (() => {
              const rb = game.reboundBonuses?.[teamKey];
              if (!rb) return null;
              const myT2 = teamKey==='A'?game.teamA:game.teamB;
              const cR = SPEND_COSTS.reboundPaint;
              const hasPaint = ((player.paintBoost||0) > 0 || player.power >= 10) && myT2.rebounds >= cR;
              // The 2-REB putback was removed — see spendReboundBonus in engine.js.
              if (!(rb.paintCheck && hasPaint)) return null;
              return (
                <div className={styles.assistSpend}>
                  <button className={styles.rebBtn} title={`Costs ${cR} REB: Paint shot check`} onClick={()=>onSpendRebound(teamKey,'paint_check',idx)}>Paint (−{cR}R)</button>
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
