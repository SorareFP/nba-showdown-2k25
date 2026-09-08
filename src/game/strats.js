// NBA Showdown 2026 — Strategy card definitions
export const STRATS = [
  // ── MATCHUP PHASE ──
  { id:'high_screen_roll',    name:'High Screen & Roll', phase:'matchup',  side:'off', copies:2, locked:false, color:'#0369A1', rarity:'common',
    desc:'Select two of your own players to swap their defenders. The opponent may react with Go Under, Fight Over, or Veer Switch.' },
  { id:'stagger_action',      name:'Stagger Action',     phase:'matchup',  side:'off', copies:2, locked:false, color:'#0284C7', rarity:'uncommon',
    desc:'One player with Speed 13+ and one with a 3PT Bonus each gain +2 Speed for this segment.' },
  { id:'second_wind',         name:'Second Wind',        phase:'matchup',  side:'off', copies:2, locked:false, color:'#16A34A', rarity:'common',
    desc:'Choose a fatigued player. They ignore their fatigue penalty this segment (gains +1 fatigue marker after).' },
  { id:'chip_on_shoulder',    name:'Chip on the Shoulder', phase:'matchup', side:'off', copies:2, locked:false, color:'#D97706', rarity:'uncommon',
    desc:'Player with salary ≤$250 gets +3 Speed and +3 Power this segment. If they now have a positive roll bonus, draw a card.' },
  { id:'defensive_stopper',   name:'Defensive Stopper',  phase:'matchup',  side:'def', copies:2, locked:false, color:'#1D4ED8', rarity:'common',
    desc:'Choose a player who was benched last segment. They gain +5 Speed and +5 Power on defense this segment.' },
  { id:'pick_up_full_court',  name:'Pick Up Full Court', phase:'matchup',  side:'def', copies:2, locked:false, color:'#475569', rarity:'common',
    desc:'Hound one opposing player the length of the floor: −1 to their scoring roll this segment, and they gain 4 minutes of fatigue.' },

  // ── PRE-ROLL ──
  { id:'ghost_screen',        name:'Ghost Screen',       phase:'pre_roll', side:'off', copies:2, locked:false, color:'#6366F1', rarity:'common',
    desc:'Choose an offensive player with Speed 12+. They are treated as having no defender for matchup advantage — roll penalty is negated to 0.' },
  { id:'you_stand_over_there',name:'You Stand Over There',phase:'pre_roll',side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'uncommon',
    desc:'Before a player makes their scoring roll: they skip it and attempt two 3PT Shot Checks instead.' },
  { id:'putback_dunk',        name:'Putback Dunk',       phase:'pre_roll', side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'uncommon',
    desc:'Your team leads in rebounds and a player has Power 14+: score 2 points automatically.' },
  { id:'pin_down_screen',     name:'Pin-Down Screen',    phase:'pre_roll', side:'off', copies:2, locked:false, color:'#BE185D', rarity:'uncommon',
    desc:'Discard a card. Choose a player to attempt a 3PT Shot Check at +5. Success: 3 pts + 1 assist to a teammate.' },
  { id:'turnover',            name:'Turnover',           phase:'pre_roll', side:'def', copies:2, locked:false, color:'#DC2626', rarity:'common',
    desc:'Opponent has a cold marker: draw 2 strategy cards.' },

  // ── SCORING PHASE ──
  { id:'green_light',         name:'Green Light',        phase:'scoring',  side:'off', copies:2, locked:false, color:'#16A34A', rarity:'uncommon',
    desc:'Select one player to attempt three 3PT Shot Checks instead of their scoring roll.' },
  { id:'from_way_downtown',   name:'From Way Downtown',  phase:'scoring',  side:'off', copies:3, locked:false, color:'#2563EB', rarity:'common',
    desc:'3PT Shot Check at +1. Roll 1–3: cold marker. Roll 18–20: hot marker.' },
  { id:'catch_and_shoot',     name:'Catch & Shoot',      phase:'scoring',  side:'off', copies:3, locked:false, color:'#0891B2', rarity:'common',
    desc:'Player with Speed 12+ attempts a 3PT Shot Check at +2. Success: +1 assist.' },
  { id:'elevator_doors',      name:'Elevator Doors',     phase:'scoring',  side:'off', copies:2, locked:false, color:'#EA580C', rarity:'uncommon',
    desc:'Choose a player with a 3PT Bonus. They attempt a 3PT Shot Check at an additional +3.' },
  { id:'bully_ball',          name:'Bully Ball',         phase:'scoring',  side:'off', copies:3, locked:false, color:'#DC2626', rarity:'common',
    desc:'Player with a Power advantage attempts two Paint Shot Checks. Power advantage ≥4: +2 to each check.' },
  { id:'power_move',          name:'Power Move',         phase:'scoring',  side:'off', copies:3, locked:false, color:'#9333EA', rarity:'common',
    desc:'Choose a player: +2 Power. If their Power advantage is already ≥5: +3 Power instead.' },
  { id:'and_one',             name:'And One!!!',         phase:'scoring',  side:'off', copies:3, locked:true,  color:'#F59E0B', rarity:'uncommon',
    desc:'Speed or Power advantage ≥3: +1 pt. Advantage ≥5: also attempt a free throw check. 🔒 Uncancelable.' },
  { id:'rimshaker',           name:'Rimshaker',          phase:'scoring',  side:'off', copies:2, locked:false, color:'#EF4444', rarity:'uncommon',
    desc:'Player has Power 13+ and a hot marker: +2 pts and add another hot marker.' },
  { id:'drive_the_lane',      name:'Drive the Lane',     phase:'scoring',  side:'off', copies:3, locked:false, color:'#0EA5E9', rarity:'uncommon',
    desc:'Player with a Speed advantage attempts two free throw checks. Speed advantage ≥5: defender gains a cold marker.' },
  { id:'uncontested_layup',   name:'Uncontested Layup',  phase:'scoring',  side:'off', copies:2, locked:false, color:'#10B981', rarity:'uncommon',
    desc:'Any of your players with +2 Speed AND +2 Power advantage over their matchup automatically scores 2 pts.' },
  { id:'back_to_basket',      name:'Back to the Basket', phase:'scoring',  side:'off', copies:2, locked:false, color:'#B45309', rarity:'uncommon',
    desc:'Player with Power 13+ and a Paint Bonus attempts a Paint Shot Check.' },
  { id:'cross_court_dime',    name:'Cross-Court Dime',   phase:'scoring',  side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'uncommon',
    desc:'Spend 3 assists: player skips scoring roll and makes one Paint + one 3PT Shot Check instead.' },
  { id:'energy_injection',    name:'Energy Injection',   phase:'scoring',  side:'off', copies:2, locked:false, color:'#059669', rarity:'common',
    desc:'Two players with salary <$400 each get +2 to their scoring roll. If either scores 4+: +1 assist.' },
  { id:'double_team',         name:'Double Team',        phase:'scoring',  side:'def', copies:2, locked:false, color:'#1E40AF', rarity:'uncommon',
    desc:'Send two at the ball: choose an opposing player who hasn\'t rolled — their defender gets +6 Speed/+6 Power this segment. But someone is open: your opponent gets +3 on the next scoring roll they choose to make.' },
  { id:'crowd_favorite',      name:'Crowd Favorite',     phase:'scoring',  side:'off', copies:2, locked:false, color:'#F97316', rarity:'common',
    desc:'Player with salary ≤$350: if they score 2+ pts this section (rolls or shot checks), they gain a hot marker.' },
  { id:'switch_everything',   name:'Switch Everything',  phase:'scoring',  side:'def', copies:2, locked:true,  color:'#1D4ED8', rarity:'rare',
    desc:'Fully reassign your defense: choose who guards each of the opponent\'s players. All opponent offensive advantages are doubled. 🔒 Uncancelable.' },
  { id:'this_is_my_house',    name:'This Is My House!',  phase:'scoring',  side:'def', copies:2, locked:true,  color:'#991B1B', rarity:'legendary',
    desc:'Your defender has higher Speed AND Power than their offensive matchup: that player skips their scoring roll entirely. 🔒 Uncancelable.' },

  // ── POST-ROLL ──
  { id:'heat_check',          name:'Heat Check',         phase:'post_roll',side:'off', copies:3, locked:true,  color:'#F97316', rarity:'uncommon',
    desc:'A player hit their highest scoring tier: attempt a 3PT Shot Check at −2. Success: +3 pts + hot marker. 🔒 Uncancelable.' },
  { id:'burst_of_momentum',   name:'Burst of Momentum',  phase:'post_roll',side:'off', copies:2, locked:false, color:'#DC2626', rarity:'uncommon',
    desc:'Player hits their top tier AND scores 5+ pts this segment: +1 AST, +1 REB, and a hot marker.' },
  { id:'flare_screen',        name:'Flare Screen',       phase:'post_roll',side:'off', copies:2, locked:false, color:'#F59E0B', rarity:'uncommon',
    desc:'A player rolled a natural 20: they make a 3PT Shot Check. Success: +3 pts + draw a card.' },

  // ── REACTION ──
  { id:'go_under',            name:'Go Under',           phase:'reaction', side:'def', copies:2, locked:false, color:'#6D28D9', rarity:'common',
    desc:'Cancel opponent\'s screen-and-roll card. The offensive player involved gets a 3PT Shot Check at +2.' },
  { id:'fight_over',          name:'Fight Over',         phase:'reaction', side:'def', copies:2, locked:false, color:'#B45309', rarity:'common',
    desc:'Cancel opponent\'s screen-and-roll card. The faster of the two involved offensive players gets +2 to their scoring roll.' },
  { id:'veer_switch',         name:'Veer Switch',        phase:'reaction', side:'def', copies:2, locked:false, color:'#7C3AED', rarity:'common',
    desc:'Cancel opponent\'s screen-and-roll card. You choose the new defender assignments instead.' },
  { id:'close_out',           name:'Close Out',          phase:'reaction', side:'def', copies:3, locked:false, color:'#15803D', rarity:'common',
    desc:'When opponent announces a 3PT Shot Check: −3 to that check. If they miss: cold marker on that player.' },
  { id:'cold_spell',          name:'Cold Spell',         phase:'reaction', side:'def', copies:3, locked:false, color:'#0284C7', rarity:'common',
    desc:'Opponent rolls a natural 1 or 2 on their scoring roll: apply a cold marker + reduce their Rebound Track by 1.' },
  { id:'anticipate_pass',     name:'Anticipate the Pass',phase:'reaction', side:'def', copies:2, locked:false, color:'#0F766E', rarity:'common',
    desc:'Opponent has 6+ assists: spend 1 of your assists to remove 2 from their track.' },
  { id:'offensive_foul',      name:'Offensive Foul',     phase:'reaction', side:'def', copies:2, locked:false, color:'#64748B', rarity:'common',
    desc:'Play after an opponent activates a card that boosts Power. Their Power boost is halved (rounded down), and they suffer −1 Rebound.' },
  { id:'dogged',              name:'Dogged',             phase:'scoring',  side:'def', copies:2, locked:false, color:'#78716C', rarity:'common',
    desc:'Target an opposing fatigued player: they suffer an additional −2 Speed and −2 Power until benched for a segment.' },
  { id:'overhelp',            name:'Overhelp',           phase:'reaction', side:'off', copies:2, locked:false, color:'#0369A1', rarity:'common',
    desc:'Opponent plays a defensive switching card: one of your players gets +3 to their scoring roll this segment.' },
  { id:'burned_switch',       name:'Burned on the Switch',phase:'reaction',side:'off', copies:2, locked:false, color:'#DC2626', rarity:'common',
    desc:'Opponent forces a matchup switch: if the new defender has lower Speed OR Power than the original, you get +3 to your scoring roll.' },
  { id:'offensive_board',     name:'Offensive Board Mastery',phase:'reaction',side:'off',copies:2,locked:false,color:'#EA580C', rarity:'common',
    desc:'Spend 3 rebounds: take a second scoring roll with a different player at −2.' },
  { id:'rebound_tap_out',     name:'Rebound Tap-Out',    phase:'reaction', side:'off', copies:2, locked:false, color:'#F59E0B', rarity:'common',
    desc:'Spend 2 rebounds: +1 assist to a player with a 3PT Bonus. That player makes a 3PT Shot Check at +1.' },

  // ── SPECIAL ──
  { id:'coaches_challenge',   name:"Coach's Challenge",  phase:'reaction', side:'def', copies:2, locked:false, color:'#B91C1C', rarity:'uncommon',
    desc:'Re-roll any opponent shot check (not a scoring roll). They must accept the new result. Limit: 2 per game per team.' },

  // ── CRUNCH TIME ── powerful but rare, playable only when the final section
  // arms within the margin. The four timeout riders play only during YOUR
  // called timeout — the momentum-control family.
  { id:'desperation_press',   name:'Desperation Press',  phase:'scoring',  side:'def', copies:1, locked:false, color:'#7F1D1D', rarity:'rare',
    desc:'CRUNCH TIME, and you are trailing: the next opposing scoring roll that lands in its top tier must be re-rolled. The second result stands.' },
  { id:'ato_masterpiece',     name:'ATO Masterpiece',    phase:'scoring',  side:'off', copies:1, locked:false, color:'#B45309', rarity:'rare',
    desc:'Play during your Timeout: coming out of the huddle, a chosen player takes a 3PT or Paint shot check at +2.' },
  { id:'fresh_legs',          name:'Fresh Legs',         phase:'scoring',  side:'off', copies:1, locked:false, color:'#15803D', rarity:'rare',
    desc:'Play during your Timeout: up to two chosen players each shed 4 minutes of fatigue.' },
  { id:'ice_the_hot_hand',    name:'Ice the Hot Hand',   phase:'scoring',  side:'def', copies:1, locked:false, color:'#0E7490', rarity:'rare',
    desc:'Play during your Timeout: strip all hot markers from one opposing player. The run stops here.' },
  { id:'reset',               name:'Reset',              phase:'scoring',  side:'off', copies:1, locked:false, color:'#4338CA', rarity:'rare',
    desc:'Play during your Timeout: clear all cold markers from one of your players. Deep breath.' },
  { id:'second_closer',       name:'Second Closer',      phase:'scoring',  side:'off', copies:1, locked:false, color:'#A21CAF', rarity:'rare',
    desc:'CRUNCH TIME: your team gains a second Clutch Possession this game, for a different player.' },
  { id:'delayed_slip',        name:'Delayed Slip',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'common',
    desc:'Choose a player with Speed ≥12 and Power ≥10. If they have no matchup advantage, give them +2 to scoring roll and +1 Rebound.' },
  // ── Wave one of the docx backlog (the user's own designs, 2026-09-06) ────
  // Matchup phase
  { id:'spain_pick_roll',     name:'Spain Pick & Roll',  phase:'matchup',  side:'off', copies:2, locked:false, color:'#B45309', rarity:'common',
    desc:'Choose a player faster than their defender: +2 to their scoring roll this period. If they score on that roll, +1 Assist.' },
  { id:'mismatch_hunter',     name:'Mismatch Hunter',    phase:'matchup',  side:'off', copies:3, locked:false, color:'#9A3412', rarity:'common',
    desc:'Choose a player with a Speed or Power advantage of +4 or more: their scoring roll gains an additional +2.' },
  { id:'strength_in_numbers', name:'Strength in Numbers',phase:'matchup',  side:'off', copies:1, locked:false, color:'#7C2D12', rarity:'legendary',
    desc:'If all five of your players hold at least a +1 advantage (Speed or Power) on offense, your team gains +3 Assists immediately.' },
  { id:'energizer',           name:'Energizer',          phase:'matchup',  side:'def', copies:2, locked:false, color:'#166534', rarity:'common',
    desc:'Choose a player with salary below $250: +3 Speed and +3 Power on defense this period.' },
  { id:'defensive_identity',  name:'Defensive Identity', phase:'matchup',  side:'def', copies:2, locked:false, color:'#14532D', rarity:'rare',
    desc:'If three or more of your players have a Defensive Bonus, all five get +2 Speed and +2 Power on defense this period.' },
  { id:'defensive_anchor',    name:'Defensive Anchor',   phase:'matchup',  side:'def', copies:2, locked:false, color:'#1E3A8A', rarity:'uncommon',
    desc:'Choose a defender with a Defensive Bonus: it counts double this section — against the player they guard, and on every shot check they contest.' },
  { id:'swarming_defense',    name:'Swarming Defense',   phase:'matchup',  side:'def', copies:1, locked:false, color:'#1E40AF', rarity:'uncommon',
    desc:'Target the opposing player with the highest salary and roll a D20: on 11+ they roll their scoring twice this period and keep the lower.' },
  // Scoring phase — offense
  { id:'five_out',            name:'Five-Out Offense',   phase:'pre_roll', side:'off', copies:2, locked:false, color:'#C2410C', rarity:'uncommon',
    desc:'Choose a player with a 3PT Bonus who has not rolled: they take two 3PT Shot Checks at +1 instead of their scoring roll.' },
  { id:'hammer_set',          name:'Hammer Set',         phase:'scoring',  side:'off', copies:2, locked:false, color:'#D97706', rarity:'common',
    desc:'A player WITHOUT a 3PT Bonus who holds a Speed advantage announces a 3PT Shot Check at normal difficulty. Hit: +2 Assists.' },
  { id:'iso_heavy',           name:'Iso-Heavy Offense',  phase:'pre_roll', side:'off', copies:2, locked:false, color:'#B91C1C', rarity:'common',
    desc:'One player takes over: +3 to their scoring roll this period. Every teammate rolls at −2.' },
  { id:'three_point_barrage', name:'Three-Point Barrage',phase:'scoring',  side:'off', copies:1, locked:false, color:'#DC2626', rarity:'rare',
    desc:'If three or more of your players have a 3PT Bonus, each of them takes a 3PT Shot Check. You may spend 1 Assist for one more check.' },
  { id:'crash_and_kick',      name:'Crash and Kick',     phase:'scoring',  side:'off', copies:2, locked:false, color:'#A16207', rarity:'common',
    desc:'Spend 3 Rebounds and 1 Assist: a player of your choice announces a 3PT Shot Check at +2.' },
  { id:'pick_and_pop',        name:'Pick-and-Pop',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#CA8A04', rarity:'common',
    desc:'Spend 2 Assists: a player with a 3PT Bonus announces a 3PT Shot Check at +1. Hit: gain 2 Assists back.' },
  { id:'extra_pass',          name:'Extra Pass',         phase:'scoring',  side:'off', copies:3, locked:false, color:'#EAB308', rarity:'common',
    desc:'Spend 2 Assists: any player announces a 3PT or Paint Shot Check. No card bonuses apply to this check.' },
  // ── WAVE TWO (2026-09-07) ────────────────────────────────────────────────
  // The user's own designs, recovered from the damaged backlog docx — see
  // docs/strategy-cards-backlog-recovered.md. Run the Floor and Twin Towers
  // are NOT here: they persist across sections and the allocation is the
  // opponent's, which is an interaction this game has never had.
  // ── THE SIGN-UP CARD ───────────────────────────────────────────────────
  // Every new account's starter carries one (packEngine: bonusStrats), and
  // `promo` keeps it out of every pack pool — it is a gift, not a pull. The
  // user, 2026-09-07: "a picture of Shai getting fouled, an Underdog logo
  // somewhere on it, and it should just award +4 FT checks to any player with
  // an offensive power or speed advantage of their choosing during
  // Crunch-Time." Read as a foul drawn: TWO free throws, each at +4.
  { id:'unethical_hoops',     name:'Unethical Hoops',    phase:'scoring',  side:'off', copies:1, locked:false, color:'#B91C1C', rarity:'rare', promo:true,
    // The sponsor line on the face: a small PRESENTED BY over the logo in
    // public/logos/, beside the team logos. Only this card has one today.
    presentedBy: { name: 'Underdog', logo: 'underdog.png' },
    desc:'CRUNCH TIME: a player of yours with a Speed or Power advantage draws the foul — four free-throw checks at +4.' },
  { id:'run_the_floor',       name:'Run the Floor',      phase:'scoring',  side:'off', copies:1, locked:false, color:'#0D9488', rarity:'legendary',
    desc:'With three players at Speed 12+ on the floor: two Paint Shot Checks at +2, allocated by the defence, +1 Assist each. Stays in play until one of them is benched.' },
  { id:'twin_towers',         name:'Twin Towers',        phase:'scoring',  side:'off', copies:1, locked:false, color:'#7C2D12', rarity:'legendary',
    desc:'With two players at Power 14+ on the floor: two Paint Shot Checks at +2, allocated by the defence. Your opponent takes every Paint Check at −2. Stays in play until one of them is benched.' },
  { id:'outside_pick',        name:'Outside Pick',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#B45309', rarity:'uncommon',
    desc:'Discard a card: this player takes a 3PT Shot Check at +5. Hit: 3 points and +1 Assist.' },
  { id:'pick_and_roll_maestro', name:'Pick-and-Roll Maestro', phase:'matchup', side:'off', copies:1, locked:true, color:'#9A3412', rarity:'rare',
    desc:'A player at Speed 14+ swaps defenders with a teammate. If their new defender is 5+ slower than they are, they take a Paint Shot Check: 2 points and +1 Assist.' },
  { id:'short_roll_playmaker', name:'Short-Roll Playmaker', phase:'matchup', side:'off', copies:2, locked:false, color:'#155E75', rarity:'uncommon',
    desc:'Designate a player with Speed 8+ and Power 8+: they add +1 Assist every time they score in the paint this period.' },
  { id:'inside_out',          name:'Inside-Out',         phase:'reaction', side:'off', copies:2, locked:false, color:'#1D4ED8', rarity:'uncommon',
    desc:'After one of your players scores in the paint: a teammate takes a free 3PT Shot Check.' },
  { id:'lob_city',            name:'Lob City',           phase:'scoring',  side:'off', copies:1, locked:false, color:'#7E22CE', rarity:'rare',
    desc:'Needs a player with Speed or Power 15+. Discard a card: every player with Speed 15+ adds an Assist, every player with Power 15+ scores 2.' },
  { id:'stretch_five',        name:'Stretch Five',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#6D28D9', rarity:'rare',
    desc:'A C or PF whose 3PT line is 14 or lower takes a 3PT Shot Check; then a teammate of your choice takes a Paint Shot Check at +2.' },
  { id:'post_domination',     name:'Post Domination',    phase:'pre_roll', side:'off', copies:1, locked:false, color:'#5B21B6', rarity:'rare',
    desc:'With two players at Power 15+ on the floor, choose one: their rebounds from scoring rolls are doubled this period.' },
  { id:'unsung_hero',         name:'Unsung Hero',        phase:'pre_roll', side:'off', copies:2, locked:false, color:'#0F766E', rarity:'common',
    desc:'Choose a player with salary $400 or less who has not rolled: they roll two D20 and keep the higher this period.' },
  { id:'transition_outlet',   name:'Transition Outlet',  phase:'scoring',  side:'off', copies:2, locked:false, color:'#0E7490', rarity:'common',
    desc:'Spend 1 Rebound and 1 Assist: a player with a Speed advantage announces a 3PT or Paint Shot Check at +2. Hit: +1 Assist.' },
  // Reactions — offense
  { id:'find_the_open_man',   name:'Find the Open Man',  phase:'reaction', side:'off', copies:2, locked:false, color:'#0369A1', rarity:'common',
    desc:'The opponent has a Double Team on the floor: a player of yours they are NOT trapping gets +4 to their scoring roll.' },
  { id:'putback_specialist',  name:'Putback Specialist', phase:'reaction', side:'off', copies:2, locked:false, color:'#0284C7', rarity:'uncommon',
    desc:'After your player misses a shot check, spend 2 Rebounds: any player of yours announces a Paint Shot Check at +3.' },
  // Reactions — defense
  { id:'rim_protector',       name:'Rim Protector',      phase:'reaction', side:'def', copies:2, locked:false, color:'#1D4ED8', rarity:'common',
    desc:'Opponent announces a Paint Shot Check and your defender on them has Power + Defensive Bonus of 15+: −4 to the check. Miss: +2 Rebounds for you.' },
  { id:'drop_coverage',       name:'Drop Coverage',      phase:'reaction', side:'def', copies:3, locked:false, color:'#2563EB', rarity:'common',
    desc:'Opponent announces a Paint Shot Check and your defender on them has a Defensive Bonus: −2 to the check.' },
  { id:'smothering_defense',  name:'Smothering Defense', phase:'reaction', side:'def', copies:2, locked:false, color:'#3730A3', rarity:'common',
    desc:'Opponent announces any shot check and your defender on them has a Defensive Bonus: the check\'s card bonus is reduced by 3, to a minimum of 0.' },
  { id:'denial',              name:'Denial',             phase:'reaction', side:'def', copies:2, locked:false, color:'#4338CA', rarity:'common',
    desc:'Discard a card. Opponent announces a shot check: they lose 2 Assists — if they have fewer than 2, the check is at −3 instead.' },
  { id:'hustle_play',         name:'Hustle Play',        phase:'reaction', side:'def', copies:2, locked:false, color:'#15803D', rarity:'common',
    desc:'An opponent with salary above $800 announces a shot check: a player of yours under $400 contests it, subtracting their Defensive Bonus.' },
  { id:'glass_cleaner',       name:'Glass Cleaner',      phase:'reaction', side:'def', copies:3, locked:false, color:'#047857', rarity:'common',
    desc:'After an opponent misses any shot check: +2 Rebounds. +1 more if your defender on the shooter has more Power than them.' },
  { id:'help_defender',       name:'Help Defender',      phase:'reaction', side:'def', copies:2, locked:false, color:'#1D4ED8', rarity:'common',
    desc:'An opponent yet to roll has a Speed or Power advantage of +4 or more: one of your other defenders rotates over. He gets no positive matchup bonus this section — and the man your helper left gets +3 on his next roll.' },
  { id:'box_out',             name:'Box Out',            phase:'reaction', side:'def', copies:2, locked:false, color:'#065F46', rarity:'common',
    desc:'Right after an opponent\'s scoring roll wins rebounds: cancel them. −1 more from their track if your defender on them has more Power.' },
];

export const STRAT_MAP = Object.fromEntries(STRATS.map(s => [s.id, s]));

export function getStrat(id) {
  return STRAT_MAP[id];
}

/**
 * THE CARDS THAT ONLY EXIST IN CRUNCH TIME.
 *
 * One list, here with the data, because it had two copies — canPlay's gate and
 * the audit's CRUNCH_RIDERS — and a third reader arrived: the crunch tutor in
 * endSection, which pulls these out of the deck the moment the last section
 * arms. The user, 2026-09-07: "In a 50-card deck, the odds of that card
 * occurring in that one section of the game seems unlikely." They were: a
 * one-copy card has roughly a one-in-seven chance of being in hand for the
 * section it is for. Now it is there if it is anywhere in the deck.
 */
export const CRUNCH_CARDS = [
  'desperation_press', 'ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset', 'second_closer',
  'unethical_hoops',
];
