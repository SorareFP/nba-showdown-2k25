// NBA Showdown 2026 — Strategy card definitions
export const STRATS = [
  // ── MATCHUP PHASE ──
  { id:'high_screen_roll',    name:'High Screen & Roll', phase:'matchup',  side:'off', copies:2, locked:false, color:'#0369A1', rarity:'common',
    desc:'Select two of your own players to swap their defenders. The opponent may react with Go Under, Fight Over, or Veer Switch.' },
  { id:'stagger_action',      name:'Stagger Action',     phase:'matchup',  side:'off', copies:2, locked:false, color:'#0284C7', rarity:'uncommon',
    desc:'One player with Speed 13+ and one with a 3PT Bonus each gain +2 Speed for this segment.' },
  { id:'second_wind',         name:'Second Wind',        phase:'matchup',  side:'off', copies:2, locked:false, color:'#16A34A', rarity:'common',
    desc:'Choose a fatigued player. They ignore their fatigue penalty this segment (+4 minutes on their tracker after).' },
  { id:'chip_on_shoulder',    name:'Chip on the Shoulder', phase:'matchup', side:'off', copies:2, locked:false, color:'#D97706', rarity:'uncommon',
    desc:'Player with salary ≤$250 gets +3 Speed and +3 Power this segment. If they now have a positive roll bonus, draw a card.' },
  { id:'defensive_stopper',   name:'Defensive Stopper',  phase:'matchup',  side:'def', copies:2, locked:false, color:'#1D4ED8', rarity:'common',
    desc:'Choose a player who was benched last segment. They gain +5 Speed and +5 Power on defense this segment.' },
  { id:'pick_up_full_court',  name:'Pick Up Full Court', phase:'matchup',  side:'def', copies:2, locked:false, color:'#475569', rarity:'common',
    desc:'Hound one opposing player the length of the floor: −1 to their scoring roll this segment, and they gain 4 minutes of fatigue. Once per player per section.' },

  // ── PRE-ROLL ──
  { id:'switch_the_screen',   name:'Switch the Screen',  phase:'matchup',  side:'def', copies:3, locked:false, color:'#1D4ED8', rarity:'common',
    desc:'Swap the defenders on two opposing players. The offence may answer with Overhelp or Burned on the Switch.' },
  { id:'ghost_screen',        name:'Ghost Screen',       phase:'pre_roll', side:'off', copies:2, locked:false, color:'#6366F1', rarity:'common',
    desc:'Choose an offensive player with Speed 12+. They are treated as having no defender — roll penalty is negated to 0, and their shot checks are uncontested.' },
  { id:'you_stand_over_there',name:'You Stand Over There',phase:'pre_roll',side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'uncommon',
    desc:'Before a player makes their scoring roll: they skip it and attempt two 3PT Shot Checks instead.' },
  { id:'putback_dunk',        name:'Putback Dunk',       phase:'pre_roll', side:'off', copies:2, locked:false, color:'#7C3AED', rarity:'uncommon',
    desc:'Your team leads in rebounds and a player has Power 14+: score 2 points automatically. Once per section.' },
  { id:'pin_down_screen',     name:'Pin-Down Screen',    phase:'pre_roll', side:'off', copies:2, locked:false, color:'#BE185D', rarity:'uncommon',
    desc:'Discard a card. Choose a player to attempt a 3PT Shot Check at +5. Success: 3 pts + 1 assist to a teammate.' },
  { id:'turnover',            name:'Turnover',           phase:'pre_roll', side:'def', copies:2, locked:false, color:'#DC2626', rarity:'common',
    desc:'Opponent has a cold marker: draw 2 strategy cards.' },

  // ── SCORING PHASE ──
  { id:'green_light',         name:'Green Light',        phase:'scoring',  side:'off', copies:2, locked:false, color:'#16A34A', rarity:'uncommon',
    desc:'Select one player to attempt three 3PT Shot Checks instead of their scoring roll. Once per player per section.' },
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
  { id:'first_step',          name:'First Step',         phase:'scoring',  side:'off', copies:3, locked:false, color:'#0891B2', rarity:'common',
    desc:'Choose a player: +2 Speed. If their Speed advantage is already 5 or more: +3 Speed instead.' },
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
    desc:'Send two at the ball: choose an opposing player who hasn\'t rolled — their defender gets +6 Speed/+6 Power this segment. But someone is open: your opponent gets +3 on the next scoring roll they choose to make. Once per section.' },
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
    // 3+, not 5+ (2026-09-16): a chart's top band pays at most 4 points a
    // roll, so the old door never opened once — measured, not guessed.
    // ONCE PER PLAYER PER SECTION (2026-09-24, the user). burstTargets in canPlay.js.
    desc:'Player hits their top tier AND scores 3+ pts this segment: +1 AST, +1 REB, and a hot marker. Once per player per section.' },
  { id:'flare_screen',        name:'Flare Screen',       phase:'post_roll',side:'off', copies:2, locked:false, color:'#F59E0B', rarity:'uncommon',
    desc:'A player rolled a natural 20: they make a 3PT Shot Check. Success: +3 pts + draw a card.' },

  // ── REACTION ──
  { id:'go_under',            name:'Go Under',           phase:'reaction', side:'def', copies:2, locked:false, color:'#6D28D9', rarity:'common',
    desc:'Cancel opponent\'s screen-and-roll card. The offence chooses which of the two players involved takes a 3PT Shot Check at +2.' },
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
  { id:'beat_to_the_spot',    name:"Beat 'Em to the Spot", phase:'reaction', side:'def', copies:2, locked:false, color:'#334155', rarity:'common',
    desc:'Play after an opponent activates a card that boosts Speed. Their Speed boost is halved (rounded down), and they suffer −1 Assist.' },
  { id:'verticality',         name:'Verticality',        phase:'reaction', side:'def', copies:2, locked:false, color:'#0F766E', rarity:'common',
    desc:'An opponent card just scored with no roll and no check: if your defender on that player has a Defensive Bonus or matches their Power, those points are wiped.' },
  { id:'dogged',              name:'Dogged',             phase:'scoring',  side:'def', copies:1, locked:false, color:'#78716C', rarity:'rare',
    // UNTIL BENCHED, AS PRINTED (2026-10-01, the user: "The effects should last
    // until a player is benched"): the −2/−2 used to vanish at section end; it
    // now follows the player into every section until he sits one
    // (engine.js applyLingering).
    // A RARE (2026-09-24, the user: "Dogged is a VERY valuable card and should
    // be a rare. You can basically knock a star out of the game with it."):
    // one copy and the rare's share of packs and deck caps; it was a common x2.
    // ANY AMOUNT OF FATIGUE (2026-09-16, the user: "with any amount of
    // fatigue"). The door was the fatigue PENALTY — eight minutes on the
    // tracker — and once the coach rested its players at twelve the AI held
    // this 337 times and played it never. Now any minutes on the tracker.
    desc:'Target a fatigued opposing player, however little: −2 Speed and −2 Power until benched for a segment.' },
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
  { id:'hack_a',              name:'Hack-A-____',        phase:'scoring',  side:'def', copies:1, locked:false, color:'#78350F', rarity:'rare',
    desc:'CRUNCH TIME: foul a chosen opponent before they can go to work. They skip their scoring roll and shoot two free throws at −3 instead.' },
  { id:'foul_trouble',        name:'Foul Trouble',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#9A3412', rarity:'uncommon',
    desc:'Choose an opposing defender your player is beating by 4 or more on Speed or Power: they pick up the foul that sits them for the whole next section.' },
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
  // Crunch-Time." Read as a foul drawn: TWO free throws, each at +4; four
  // since 2026-09-08, and PLAIN since 2026-09-21 (the user: "Unethical Hoops
  // should not boost free throw shot checks" — a free throw carries its own
  // +10 in shotCheck, and the +4 on top was the boost). The face prints this
  // desc, so the PNG needs a re-export.
  { id:'unethical_hoops',     name:'Unethical Hoops',    phase:'scoring',  side:'off', copies:1, locked:false, color:'#B91C1C', rarity:'rare', promo:true,
    // The sponsor line on the face: a small PRESENTED BY over the logo in
    // public/logos/, beside the team logos. Only this card has one today.
    presentedBy: { name: 'Underdog', logo: 'underdog.png' },
    desc:'CRUNCH TIME: a player of yours with a Speed or Power advantage draws the foul — four free-throw checks.' },
  { id:'run_the_floor',       name:'Run the Floor',      phase:'scoring',  side:'off', copies:1, locked:false, color:'#0D9488', rarity:'legendary',
    desc:'With three players at Speed 12+ on the floor: two Paint Shot Checks at +2, allocated by the defence, +1 Assist each. Stays in play until one of them is benched.' },
  { id:'twin_towers',         name:'Twin Towers',        phase:'scoring',  side:'off', copies:1, locked:false, color:'#7C2D12', rarity:'legendary',
    desc:'With two players at Power 14+ on the floor: two Paint Shot Checks at +2, allocated by the defence. Your opponent takes every Paint Check at −2. Stays in play until one of them is benched.' },
  { id:'outside_pick',        name:'Outside Pick',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#B45309', rarity:'uncommon',
    desc:'Discard a card: this player takes a 3PT Shot Check at +5. Hit: 3 points and +1 Assist.' },
  { id:'pick_and_roll_maestro', name:'Pick-and-Roll Maestro', phase:'matchup', side:'off', copies:1, locked:true, color:'#9A3412', rarity:'rare',
    desc:'A player at Speed 14+ swaps defenders with a teammate. If their new defender is 5+ slower than they are, they take a Paint Shot Check: 2 points and +1 Assist.' },
  { id:'short_roll_playmaker', name:'Short-Roll Playmaker', phase:'matchup', side:'off', copies:2, locked:false, color:'#155E75', rarity:'uncommon',
    desc:'Designate a player with Speed 8+ and Power 8+: they add +1 Assist every time they HIT A PAINT CHECK this period. A scoring roll is not a paint check.' },
  { id:'inside_out',          name:'Inside-Out',         phase:'reaction', side:'off', copies:2, locked:false, color:'#1D4ED8', rarity:'uncommon',
    desc:'After one of your players scores in the paint: a teammate takes a free 3PT Shot Check.' },
  { id:'lob_city',            name:'Lob City',           phase:'scoring',  side:'off', copies:1, locked:false, color:'#7E22CE', rarity:'rare',
    desc:'Needs a player with Speed or Power 15+. Discard a card: every player with Speed 15+ adds an Assist, every player with Power 15+ scores 2.' },
  { id:'stretch_five',        name:'Stretch Five',       phase:'scoring',  side:'off', copies:2, locked:false, color:'#6D28D9', rarity:'rare',
    desc:'A C or PF whose 3PT line is 14 or lower takes a 3PT Shot Check; then a teammate of your choice takes a Paint Shot Check at +2.' },
  { id:'post_domination',     name:'Post Domination',    phase:'pre_roll', side:'off', copies:1, locked:false, color:'#5B21B6', rarity:'rare',
    // A MATCHUP DOOR (2026-09-16): two Power-15+ players on the floor was a
    // door 3.4% of cap-legal tens could open. Now the way Bully Ball reads.
    desc:'Choose a player with a Power advantage over their defender, before they roll: their rebounds from scoring rolls are doubled this period.' },
  { id:'unsung_hero',         name:'Unsung Hero',        phase:'pre_roll', side:'off', copies:2, locked:false, color:'#0F766E', rarity:'common',
    desc:'Choose a player with salary $400 or less who has not rolled: they roll two D20 and keep the higher this period.' },
  { id:'transition_outlet',   name:'Transition Outlet',  phase:'scoring',  side:'off', copies:2, locked:false, color:'#0E7490', rarity:'common',
    desc:'Spend 1 Rebound and 1 Assist: a player with a Speed advantage announces a 3PT or Paint Shot Check at +2. Hit: +1 Assist.' },
  // Reactions — offense
  { id:'find_the_open_man',   name:'Find the Open Teammate', phase:'reaction', side:'off', copies:2, locked:false, color:'#0369A1', rarity:'common',
    desc:'The opponent has a Double Team on the floor: a player of yours they are NOT trapping gets +4 to their scoring roll.' },
  { id:'putback_specialist',  name:'Putback Specialist', phase:'reaction', side:'off', copies:2, locked:false, color:'#0284C7', rarity:'uncommon',
    desc:'After your player misses a shot check, spend 2 Rebounds: any player of yours announces a Paint Shot Check at +3. Hit: the rebound is theirs.' },
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
    desc:'An opponent yet to roll has a Speed or Power advantage of +4 or more: one of your other defenders rotates over. They get no positive matchup bonus this section — and the player your helper left gets +3 on their next roll.' },
  { id:'box_out',             name:'Box Out',            phase:'reaction', side:'def', copies:2, locked:false, color:'#065F46', rarity:'common',
    desc:'Right after an opponent\'s scoring roll wins rebounds: cancel them. −1 more from their track if your defender on them has more Power.' },

  // ── WAVE TWO TWINS (2026-09-23) — the unpaired half of the twin survey ──
  // Power buys rebounds and Speed buys assists (Offensive Foul / Beat 'Em to
  // the Spot set the pattern); each of these mirrors a card that had one
  // side only. Built for the user's sign-off, per the approval rule.
  { id:'blow_by',             name:'Blow-By',            phase:'scoring',  side:'off', copies:2, locked:false, color:'#2563EB', rarity:'uncommon',
    // Rimshaker's Speed twin.
    desc:'Player has Speed 13+ and a hot marker: +2 pts and add another hot marker.' },
  { id:'point_god',           name:'Point God',          phase:'pre_roll', side:'off', copies:1, locked:false, color:'#1D4ED8', rarity:'rare',
    // Post Domination's Speed twin: the same matchup door, on the other stat.
    desc:'Choose a player with a Speed advantage over their defender, before they roll: their assists from scoring rolls are doubled this period.' },
  { id:'passing_lane',        name:'Passing Lane',       phase:'reaction', side:'def', copies:2, locked:false, color:'#047857', rarity:'common',
    // Box Out, for the other currency.
    desc:'Right after an opponent\'s scoring roll wins assists: cancel them. −1 more from their track if your defender on them has more Speed.' },
  { id:'clamp_the_reserve',   name:'Clamp the Reserve',  phase:'pre_roll', side:'def', copies:2, locked:false, color:'#7F1D1D', rarity:'common',
    // Unsung Hero's defensive mirror.
    desc:'Choose an opposing player with salary $400 or less who has not rolled: they roll two D20 and keep the lower this period.' },
  { id:'feeling_it',          name:'Feeling It',         phase:'pre_roll', side:'off', copies:2, locked:false, color:'#EA580C', rarity:'common',
    // Turnover, off the hot marker instead of the cold one.
    desc:'One of your players has a hot marker: draw 2 strategy cards.' },

  // ── THE GLASS (2026-09-23) — ways to spend a surplus on the boards ──────
  // The user: "Definitely a few rebound-based strategy cards, ways to
  // leverage surplus rebounding." Drafted in
  // docs/plans/2026-09-23-rebound-cards-design.md and approved ("Great,
  // let's do it"). Rebounds spend like assists now (REBOUND_RULES: 5 REB, a
  // paint check), so each of these beats the check its rebounds would buy.
  { id:'kick_out_three',      name:'Kick-Out Three',     phase:'reaction', side:'off', copies:2, locked:false, color:'#0369A1', rarity:'uncommon',
    // Putback Specialist's three-point twin: the board goes back out.
    desc:'After your player misses a shot check, spend 2 Rebounds: a different player of yours with a 3PT Bonus of +1 or more announces a 3PT Shot Check.' },
  { id:'grab_and_go',         name:'Grab and Go',        phase:'scoring',  side:'off', copies:2, locked:false, color:'#15803D', rarity:'common',
    // The plain exchange: the currency you have too much of for the one that buys threes.
    desc:'Spend 3 Rebounds: +2 Assists.' },
  { id:'rebound_and_push',    name:'Rebound and Push',   phase:'reaction', side:'def', copies:2, locked:false, color:'#0F766E', rarity:'uncommon',
    // Glass Cleaner's miss, turned into a transition bucket the other way.
    desc:'Right after an opponent misses a shot check, spend 2 Rebounds: your defender on the shooter announces a Paint Shot Check at +1.' },
  { id:'own_the_glass',       name:'Own the Glass',      phase:'scoring',  side:'off', copies:1, locked:false, color:'#166534', rarity:'rare',
    // The dominant front line's card: the lead is the door, the bank the fuel.
    desc:'Your team leads the Rebound Track by 6 or more: spend 5 Rebounds: a player of yours announces two Paint Shot Checks at +1.' },
  // THE USER'S CARD (2026-09-25): "a reaction strategy card that forces the
  // offense to select another shooter for an already-announced shot check",
  // approved as designed ("This is all perfect"). Its own answer, not the
  // one-per-check answer: Close Out and the rest can still follow, and apply
  // to the new shooter. Only the check just announced moves; the roll a
  // roll-replacer spends stays the original player's.
  { id:'blitz',               name:'Blitz',              phase:'reaction', side:'def', copies:2, locked:false, color:'#9F1239', rarity:'uncommon',
    desc:'Opponent announces a 3PT or Paint Shot Check: blitz the shooter. The offense must give that check to another player on the floor, with the same card bonus.' },
  // ── CLIMB-ONLY (The Climb, piece 2, 2026-10-19) ──────────────────────────
  // Offered only as rewards inside a run: never in a pack, the market, a
  // collection, a deck you build or a coach's deck (`climbOnly`: packEngine,
  // rarity, the default deck, DeckEditor, MyCollection, StratsTab skip it). The
  // user: the cards are what lasts a game ("negate all fatigue this game, +X
  // power this game"); run-long things are perks. Chemistry, approved "Go for
  // it" from docs/plans/2026-10-19-the-climb-scaling-draft.md, pays off the
  // screens every kit carries.
  { id:'chemistry',           name:'Chemistry',          phase:'matchup',  side:'off', copies:1, locked:false, color:'#7C3AED', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: each screen card you play gives your next scoring roll +1 more than the last: +1, then +2, then +3.' },
  // THE FIRST WAVE BY PLAYBOOK (2026-10-19; the user: "Whichever makes sense,
  // you don't have to ask"), from docs/plans/2026-10-19-the-climb-scaling-draft.md.
  // Each lasts the game it is played in (g.buffs); Stay Hot and Ice Bath carry
  // into the run (the user's own: "Cards carrying hot markers into next game
  // could be great, or erasing fatigue after a game").
  { id:'let_it_fly',          name:'Let It Fly',         phase:'matchup',  side:'off', copies:1, locked:false, color:'#0EA5E9', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: your 3PT Shot Checks are +1.' },
  { id:'pace_and_space',      name:'Pace and Space',     phase:'matchup',  side:'off', copies:1, locked:false, color:'#0284C7', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: +1 Speed to every player of yours.' },
  { id:'bruise_brothers',     name:'Bruise Crew',        phase:'matchup',  side:'off', copies:1, locked:false, color:'#B45309', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: your Paint Shot Checks are +1.' },
  { id:'weight_room',         name:'Weight Room',        phase:'matchup',  side:'off', copies:1, locked:false, color:'#92400E', rarity:'uncommon', climbOnly:true,
    desc:'Choose a player: +3 Power for the rest of this game.' },
  { id:'conditioning',        name:'Conditioning',       phase:'matchup',  side:'def', copies:1, locked:false, color:'#15803D', rarity:'uncommon', climbOnly:true,
    desc:'Your players\' fatigue costs them nothing this game.' },
  { id:'shut_the_door',       name:'Shut the Door',      phase:'matchup',  side:'def', copies:1, locked:false, color:'#166534', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: opposing Paint Shot Checks are −1.' },
  { id:'stay_hot',            name:'Stay Hot',           phase:'matchup',  side:'off', copies:1, locked:false, color:'#DC2626', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: your players carry the hot markers they finish it with into the next game (up to 2 each).' },
  { id:'ice_bath',            name:'Ice Bath',           phase:'matchup',  side:'off', copies:1, locked:false, color:'#0891B2', rarity:'uncommon', climbOnly:true,
    desc:'After this game, your players\' fatigue is cleared. Ice Bath then leaves your deck.' },
  // BUILD-AROUNDS (2026-10-19, "keep going down the list"): weak alone, strong
  // in a deck built for them — the skill lever of a focused deck over a pile.
  { id:'splash',              name:'Splash',             phase:'matchup',  side:'off', copies:1, locked:false, color:'#0369A1', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: your 3PT Shot Checks get +1 for every two threes your team has made this game (up to +3).' },
  { id:'on_fire',             name:'On Fire',            phase:'matchup',  side:'off', copies:1, locked:false, color:'#EA580C', rarity:'uncommon', climbOnly:true,
    desc:'Stays in play this game: a player of yours who makes three shot checks in a row is On Fire — their shot checks are +3 until they miss.' },
  // ── THE CLIMB, WAVE TWO (2026-10-20, the user: "I love 'em, go for all") ──
  // POWERS from the "+" draft (docs/plans/2026-10-20-the-climb-plus-every-card.md):
  // played once, they pay on a trigger for the rest of the game. And the GRIND
  // cards (docs/plans/2026-10-20-the-climb-grind-cards.md): minutes on the
  // tracker are the price, added at the end of the section (`extraMinutes`,
  // endSection) so the cost never hurts the roll the card is helping.
  { id:'get_stops',          name:'Get Stops',        phase:'matchup', side:'def', copies:1, locked:false, color:'#14532D', rarity:'uncommon', climbOnly:true,
    desc:"Stays in play this game: each time you play a defense card, gain 1 Rebound." },
  { id:'talk_on_defense',    name:'Talk on Defense',  phase:'matchup', side:'def', copies:1, locked:false, color:'#3F6212', rarity:'uncommon', climbOnly:true,
    desc:"Stays in play this game: each time you play a switching card (Switch the Screen, Veer Switch, Switch Everything, Go Under, Fight Over), your defenders get +1 Speed this section." },
  { id:'ball_movement',      name:'Ball Movement',    phase:'matchup', side:'off', copies:1, locked:false, color:'#0284C7', rarity:'uncommon', climbOnly:true,
    desc:"Stays in play this game: each time you hit a 3PT Shot Check, gain 1 Assist." },
  { id:'wear_them_down',     name:'Wear Them Down',   phase:'matchup', side:'off', copies:1, locked:false, color:'#78350F', rarity:'uncommon', climbOnly:true,
    desc:"Stays in play this game: each time you hit a Paint Shot Check, the defender on that player has −1 Power for the rest of the game (up to −3 each)." },
  { id:'film_session',       name:'Film Session',     phase:'matchup', side:'off', copies:1, locked:false, color:'#4338CA', rarity:'uncommon', climbOnly:true,
    desc:"Stays in play this game: at the start of each section, draw 1 card." },
  { id:'signature_set',      name:'Signature Set',    phase:'pre_roll', side:'off', copies:1, locked:false, color:'#BE185D', rarity:'uncommon', climbOnly:true,
    desc:"A player of yours who has not rolled gets +2 to their scoring roll this section. After each game you play it in, it gives 1 more for the rest of the run (up to +6)." },
  { id:'leave_it_all',       name:'Leave It All Out There', phase:'matchup', side:'off', copies:1, locked:false, color:'#B91C1C', rarity:'uncommon', climbOnly:true,
    desc:"Every player of yours gets +3 to their scoring roll this section. After this game it leaves your deck." },
  { id:'up_tempo',           name:'Up-Tempo',         phase:'scoring', side:'off', copies:1, locked:false, color:'#0EA5E9', rarity:'uncommon', climbOnly:true,
    desc:"Draw 2 cards. At the end of this section, each of your starters adds 1 minute." },
  { id:'ride_your_star',     name:'Ride Your Star',   phase:'pre_roll', side:'off', copies:1, locked:false, color:'#CA8A04', rarity:'uncommon', climbOnly:true,
    desc:"Your highest-salary starter, still to roll, gets +4 to their scoring roll this section. At the end of the section they add 3 minutes." },
  { id:'full_court_press',   name:'Full-Court Press', phase:'matchup', side:'def', copies:1, locked:false, color:'#15803D', rarity:'uncommon', climbOnly:true,
    desc:"Your five get +3 Speed on defense this section. At the end of it, each adds 2 minutes." },
  { id:'crash_every_board',  name:'Crash Every Board', phase:'scoring', side:'off', copies:1, locked:false, color:'#A16207', rarity:'uncommon', climbOnly:true,
    desc:"Gain 3 Rebounds. At the end of this section, your two highest-Power starters each add 2 minutes." },
  { id:'play_through_contact', name:'Play Through Contact', phase:'scoring', side:'off', copies:1, locked:false, color:'#9A3412', rarity:'uncommon', climbOnly:true,
    desc:"A player with a Power advantage takes a Paint Shot Check at +3. Hit: a hot marker. At the end of this section they add 3 minutes." },
  // A DEAD CARD (2026-10-25): Summer-League Tape's price (climbEvents.js).
  // Never played, never offered (`promo`), never in a pack (`climbOnly`): it
  // only fills a draw until it goes back under the deck or is cut.
  { id:'bad_contract',       name:'Bad Contract',     phase:'matchup', side:'off', copies:3, locked:false, color:'#57534E', rarity:'common', climbOnly:true, promo:true, dead:true,
    desc:"Does nothing. A contract nobody wanted: put it back under your deck, or cut it at a Rest Day." },
  { id:'two_a_days',         name:'Two-a-Days',       phase:'matchup', side:'off', copies:1, locked:false, color:'#6D28D9', rarity:'uncommon', climbOnly:true,
    desc:"After this game, practise one card in your deck into its \"+\" (from the map), and your players carry 4 more minutes into the next game. Two-a-Days then leaves your deck." },
];

/** The Climb-only cards that last a game (g.buffs): one rule in canPlay, one in execCard. */
export const CLIMB_GAME_CARDS = Object.freeze(['let_it_fly', 'pace_and_space', 'bruise_brothers', 'weight_room', 'conditioning', 'shut_the_door', 'stay_hot', 'ice_bath', 'splash', 'on_fire',
  'get_stops', 'talk_on_defense', 'ball_movement', 'wear_them_down', 'film_session', 'leave_it_all', 'two_a_days']);

/** The switching cards Talk on Defense pays on: the defence's own switches and screen calls. */
export const TALK_CARDS = Object.freeze(['switch_the_screen', 'veer_switch', 'switch_everything', 'go_under', 'fight_over']);

/**
 * A Climb game card's number from its g.buffs flag (execCard stores it since
 * the "+" cards, 2026-10-20); `fallback` is the plain card's, for a game saved
 * when the flag was `true`.
 */
export function buffNumber(v, fallback) {
  return v === true ? fallback : (Number(v) || fallback);
}

export const STRAT_MAP = Object.fromEntries(STRATS.map(s => [s.id, s]));

/**
 * THE SCREEN CARDS — what Chemistry counts (2026-10-19): the offence's
 * screening actions, on or off the ball. Switch the Screen is the defence's.
 */
export const SCREEN_CARDS = Object.freeze([
  'high_screen_roll', 'spain_pick_roll', 'ghost_screen', 'pin_down_screen', 'stagger_action', 'flare_screen',
  'elevator_doors', 'pick_and_pop', 'outside_pick', 'delayed_slip', 'pick_and_roll_maestro', 'short_roll_playmaker', 'hammer_set',
]);

// ── "+" COPIES (The Climb, 2026-10-18) ────────────────────────────────────────
// A Rest Day's Practice upgrades ONE copy of a card (the user: "It should only be
// each card, not all of one"), and that copy rides in the deck, the hand and
// the discard as its id with a `+`, so it travels as itself through every
// draw and undo. The engine compares ids as strings in ~40 places, so the
// mark is read at the doors — execCard, canPlay, the AI, the board — and
// nowhere inside: there a "+" copy is its card. Only a Climb deck holds one.
export const PLUS_MARK = '+';
/** The card a copy is: `close_out+` -> `close_out`. */
export const baseId = id => (typeof id === 'string' && id.endsWith(PLUS_MARK) ? id.slice(0, -PLUS_MARK.length) : id);
export const isPlus = id => typeof id === 'string' && id.endsWith(PLUS_MARK);
export const plusId = id => (isPlus(id) ? id : `${id}${PLUS_MARK}`);

/**
 * THE "+" TEXT of each upgradable card, by its plain id: the starter kits'
 * twenty-six (docs/plans/2026-10-18-the-climb-upgrades.md). APPROVED by the
 * user 2026-10-19, after a second draft made each one worth a Rest Day ("there
 * are seldom upgrades that justify using a rest day on them instead of resting
 * the players"). The effects are execCard.js's `opts.plus` and canPlay.js's
 * `plus`; the faces are public/cards/strats-plus/ — re-export them
 * (npm run export:cards -- --set strats-plus) when a text here changes.
 */
export const PLUS = {
  high_screen_roll: { desc: "Select two of your own players to swap their defenders, and gain 1 Assist. 🔒 Uncancelable." },
  // The four the kits gained on 2026-10-19, approved that day ("Perfect").
  second_closer: { desc: "CRUNCH TIME: your team gains two more Clutch Possessions this game, each for a different player." },
  ato_masterpiece: { desc: "Play during your Timeout: coming out of the huddle, a chosen player takes a 3PT or Paint shot check at +4." },
  hack_a: { desc: "CRUNCH TIME: foul a chosen opponent before they can go to work. They skip their scoring roll and shoot two free throws at −6 instead." },
  transition_outlet: { desc: "Spend 1 Rebound: a player with a Speed advantage announces a 3PT or Paint Shot Check at +2. Hit: +1 Assist." },
  switch_the_screen: { desc: "Swap the defenders on two opposing players, and the opponent loses 1 Assist. 🔒 Uncancelable." },
  veer_switch: { desc: "Cancel opponent's screen-and-roll card. You choose the new defender assignments instead, and draw a card." },
  go_under: { desc: "Cancel opponent's screen-and-roll card. The offence chooses which of the two players involved takes a 3PT Shot Check at −4." },
  overhelp: { desc: "Opponent plays a defensive switching card: one of your players gets +5 to their scoring roll this segment." },
  burned_switch: { desc: "Opponent forces a matchup switch: if the new defender has lower Speed OR Power than the original, you get +5 to your scoring roll." },
  catch_and_shoot: { desc: "Player with Speed 11+ attempts a 3PT Shot Check at +4. Success: +1 assist." },
  first_step: { desc: "Choose a player: +4 Speed. If their Speed advantage is already 5 or more: +6 Speed instead." },
  drive_the_lane: { desc: "Player with a Speed advantage attempts three free throw checks. Speed advantage ≥4: defender gains a cold marker." },
  spain_pick_roll: { desc: "Choose a player faster than their defender: +4 to their scoring roll this period. If they score on that roll, +1 Assist." },
  ghost_screen: { desc: "Choose an offensive player with Speed 11+. They are treated as having no defender — roll penalty is negated to 0, their shot checks are uncontested, and their scoring roll gets +2." },
  close_out: { desc: "When opponent announces a 3PT Shot Check: −5 to that check. If they miss: cold marker on that player." },
  passing_lane: { desc: "Right after an opponent's scoring roll wins assists: cancel them, and you gain 1 Assist. −2 more from their track if your defender on them has more Speed." },
  bully_ball: { desc: "Player with a Power advantage attempts two Paint Shot Checks at +2 each. Power advantage ≥4: +4 to each check." },
  power_move: { desc: "Choose a player: +4 Power. If their Power advantage is already ≥5: +6 Power instead." },
  back_to_basket: { desc: "Player with Power 12+ and a Paint Bonus attempts a Paint Shot Check at +3." },
  offensive_board: { desc: "Spend 2 rebounds: take a second scoring roll with a different player." },
  putback_specialist: { desc: "After your player misses a shot check, spend 2 Rebounds: any player of yours announces a Paint Shot Check at +5. Hit: the rebound is theirs, and +1 Assist." },
  glass_cleaner: { desc: "After an opponent misses any shot check: +4 Rebounds. +1 more if your defender on the shooter has more Power than them." },
  box_out: { desc: "Right after an opponent's scoring roll wins rebounds: cancel them, and you gain 1 Rebound. −2 more from their track if your defender on them has more Power." },
  drop_coverage: { desc: "Opponent announces a Paint Shot Check and your defender on them has a Defensive Bonus: −4 to the check." },
  smothering_defense: { desc: "Opponent announces any shot check and your defender on them has a Defensive Bonus: the check loses its card bonus entirely and is at −1." },
  pick_up_full_court: { desc: "Hound one opposing player the length of the floor: −4 to their scoring roll this segment, and they gain 4 minutes of fatigue. Once per player per section." },
  rim_protector: { desc: "Opponent announces a Paint Shot Check and your defender on them has Power + Defensive Bonus of 13+: −5 to the check. Miss: +3 Rebounds for you." },
  help_defender: { desc: "An opponent yet to roll has a Speed or Power advantage of +3 or more: one of your other defenders rotates over. They get no positive matchup bonus this section." },
  cold_spell: { desc: "Opponent rolls a natural 1 to 5 on their scoring roll: apply a cold marker + reduce their Rebound Track by 1." },
  // EVERY OTHER CARD A RUN CAN OFFER (79), approved 2026-10-20 ("I think you
  // can just push all of the + cards"): docs/plans/2026-10-20-the-climb-plus-every-card.md.
  // `runItBack` goes back into the deck after a play (execCard); `innate`
  // starts the game in the opening hand (engine.js makeTeam).
  // commons
  anticipate_pass: { desc: "Opponent has 6+ assists: spend 1 of your assists to remove 4 from their track." },
  beat_to_the_spot: { desc: "Play after an opponent activates a card that boosts Speed. Their Speed boost is cancelled, and they suffer −1 Assist." },
  clamp_the_reserve: { desc: "Choose an opposing player with salary $400 or less who has not rolled: they roll three D20 and keep the lowest this period." },
  crash_and_kick: { desc: "Spend 3 Rebounds and 1 Assist: a player of your choice announces a 3PT Shot Check at +4." },
  crowd_favorite: { desc: "Player with salary ≤$350: if they score 2+ pts this section (rolls or shot checks), they gain two hot markers." },
  defensive_stopper: { desc: "Choose a player who was benched last segment. They gain +8 Speed and +8 Power on defense this segment." },
  delayed_slip: { desc: "Choose a player with Speed ≥12 and Power ≥10. If they have no matchup advantage, give them +4 to scoring roll and +1 Rebound." },
  denial: { desc: "No discard. Opponent announces a shot check: they lose 2 Assists — if they have fewer than 2, the check is at −3 instead." },
  energizer: { desc: "Choose a player with salary below $250: +5 Speed and +5 Power on defense this period." },
  energy_injection: { desc: "Two players with salary <$400 each get +4 to their scoring roll. If either scores 4+: +1 assist." },
  extra_pass: { desc: "Spend 2 Assists: any player announces a 3PT or Paint Shot Check. No card bonuses apply to this check. Run It Back: it goes back into your deck, to be drawn again this game.", runItBack: true },
  find_the_open_man: { desc: "The opponent has a Double Team on the floor: a player of yours they are NOT trapping gets +6 to their scoring roll." },
  feeling_it: { desc: "One of your players has a hot marker: draw 3 strategy cards." },
  fight_over: { desc: "Cancel opponent's screen-and-roll card. The faster of the two involved offensive players gets +1 to their scoring roll." },
  from_way_downtown: { desc: "3PT Shot Check at +3. Roll 1–3: cold marker. Roll 18–20: hot marker." },
  grab_and_go: { desc: "Spend 3 Rebounds: +3 Assists." },
  hammer_set: { desc: "A player WITHOUT a 3PT Bonus who holds a Speed advantage announces a 3PT Shot Check at +3. Hit: +2 Assists." },
  hustle_play: { desc: "An opponent with salary above $800 announces a shot check: a player of yours under $400 contests it, subtracting their Defensive Bonus and 2 more." },
  iso_heavy: { desc: "One player takes over: +5 to their scoring roll this period. Every teammate rolls at −2." },
  mismatch_hunter: { desc: "Choose a player with a Speed or Power advantage of +4 or more: their scoring roll gains an additional +4." },
  offensive_foul: { desc: "Play after an opponent activates a card that boosts Power. Their Power boost is cancelled, and they suffer −1 Rebound." },
  pick_and_pop: { desc: "Spend 2 Assists: a player with a 3PT Bonus announces a 3PT Shot Check at +3. Hit: gain 2 Assists back." },
  rebound_tap_out: { desc: "Spend 2 rebounds: +1 assist to a player with a 3PT Bonus. That player makes a 3PT Shot Check at +3." },
  second_wind: { desc: "Choose a fatigued player. They ignore their fatigue penalty this segment (+2 minutes on their tracker after)." },
  turnover: { desc: "Opponent has a cold marker: draw 3 strategy cards." },
  unsung_hero: { desc: "Choose a player with salary $400 or less who has not rolled: they roll three D20 and keep the highest this period." },
  verticality: { desc: "An opponent card just scored with no roll and no check: if your defender on that player has a Defensive Bonus or matches their Power, those points are wiped, and you gain 1 Rebound." },
  // uncommons
  and_one: { desc: "Speed or Power advantage ≥2: +1 pt. Advantage ≥4: also attempt a free throw check. 🔒 Uncancelable." },
  blitz: { desc: "Opponent announces a 3PT or Paint Shot Check: blitz the shooter. The offense must give that check to another player on the floor, with the card bonus less 2." },
  blow_by: { desc: "Player has Speed 12+ and a hot marker: +2 pts and add another hot marker." },
  burst_of_momentum: { desc: "Player hits their top tier AND scores 3+ pts this segment: +2 AST, +2 REB, and a hot marker. Once per player per section." },
  chip_on_shoulder: { desc: "Player with salary ≤$250 gets +5 Speed and +5 Power this segment. If they now have a positive roll bonus, draw a card." },
  coaches_challenge: { desc: "Re-roll any opponent shot check (not a scoring roll); they must accept the new result. Limit: 2 per game per team, and an overturned make does not count." },
  cross_court_dime: { desc: "Spend 2 assists: player skips scoring roll and makes one Paint + one 3PT Shot Check instead." },
  defensive_anchor: { desc: "Choose a defender with a Defensive Bonus: it counts double this section — against the player they guard, and on every shot check they contest. Draw a card." },
  double_team: { desc: "Send two at the ball: choose an opposing player who hasn't rolled — their defender gets +6 Speed/+6 Power this segment. The rotation recovers: your opponent gets +1 on the next scoring roll they choose. Once per section." },
  elevator_doors: { desc: "Choose a player with a 3PT Bonus. They attempt a 3PT Shot Check at an additional +5." },
  five_out: { desc: "Choose a player with a 3PT Bonus who has not rolled: they take two 3PT Shot Checks at +3 instead of their scoring roll." },
  flare_screen: { desc: "A player rolled a natural 19 or 20: they make a 3PT Shot Check. Success: +3 pts + draw a card." },
  foul_trouble: { desc: "Choose an opposing defender your player is beating by 3 or more on Speed or Power: they pick up the foul that sits them for the whole next section." },
  green_light: { desc: "Select one player to attempt three 3PT Shot Checks at +2 each instead of their scoring roll. Once per player per section." },
  heat_check: { desc: "A player hit their highest scoring tier: attempt a 3PT Shot Check at +1. Success: +3 pts + hot marker. 🔒 Uncancelable." },
  inside_out: { desc: "After one of your players scores in the paint: a teammate takes a free 3PT Shot Check at +2." },
  kick_out_three: { desc: "After your player misses a shot check, spend 2 Rebounds: a different player of yours with a 3PT Bonus of +1 or more announces a 3PT Shot Check at +3." },
  outside_pick: { desc: "No discard: this player takes a 3PT Shot Check at +5. Hit: 3 points and +1 Assist." },
  pin_down_screen: { desc: "No discard. Choose a player to attempt a 3PT Shot Check at +5. Success: 3 pts + 1 assist to a teammate." },
  putback_dunk: { desc: "Your team leads in rebounds and a player has Power 12+: score 2 points automatically. Once per section." },
  rebound_and_push: { desc: "Right after an opponent misses a shot check, spend 2 Rebounds: your defender on the shooter announces a Paint Shot Check at +3." },
  rimshaker: { desc: "Player has Power 12+ and a hot marker: +2 pts and add another hot marker." },
  short_roll_playmaker: { desc: "Designate a player with Speed 8+ and Power 8+: they add +1 Assist every time ANY OF YOUR PLAYERS HITS A PAINT CHECK this period. A scoring roll is not a paint check." },
  stagger_action: { desc: "One player with Speed 13+ and one with a 3PT Bonus each gain +4 Speed for this segment." },
  swarming_defense: { desc: "Target the opposing player with the highest salary and roll a D20: on 6+ they roll their scoring twice this period and keep the lower." },
  uncontested_layup: { desc: "Any of your players with +2 Speed AND +2 Power advantage over their matchup automatically scores 2 pts, and +1 Assist." },
  you_stand_over_there: { desc: "Before a player makes their scoring roll: they skip it and attempt two 3PT Shot Checks at +2 each instead." },
  // rares
  defensive_identity: { desc: "If three or more of your players have a Defensive Bonus, all five get +4 Speed and +4 Power on defense this period." },
  desperation_press: { desc: "CRUNCH TIME, and you are trailing: the next two opposing scoring rolls that land in their top tier must be re-rolled. The second results stand." },
  dogged: { desc: "Target a fatigued opposing player, however little: −3 Speed and −3 Power until benched for a segment." },
  fresh_legs: { desc: "Play during your Timeout: up to three chosen players each shed 4 minutes of fatigue." },
  ice_the_hot_hand: { desc: "Play during your Timeout: strip all hot markers from two opposing players. The run stops here." },
  lob_city: { desc: "Needs a player with Speed or Power 15+. No discard: every player with Speed 15+ adds an Assist, every player with Power 15+ scores 2." },
  own_the_glass: { desc: "Your team leads the Rebound Track by 6 or more: spend 5 Rebounds: a player of yours announces two Paint Shot Checks at +3." },
  pick_and_roll_maestro: { desc: "A player at Speed 14+ swaps defenders with a teammate. If their new defender is 3+ slower than they are, they take a Paint Shot Check: 2 points and +1 Assist." },
  point_god: { desc: "Choose a player with a Speed advantage over their defender, before they roll: their assists from scoring rolls are doubled this period. Draw a card." },
  post_domination: { desc: "Choose a player with a Power advantage over their defender, before they roll: their rebounds from scoring rolls are doubled this period. Draw a card." },
  reset: { desc: "Play during your Timeout: clear all cold markers from one of your players, and they gain a hot marker. Deep breath." },
  stretch_five: { desc: "A C or PF whose 3PT line is 14 or lower takes a 3PT Shot Check; then a teammate of your choice takes a Paint Shot Check at +4." },
  switch_everything: { desc: "Fully reassign your defense: choose who guards each of the opponent's players. Opponent offensive advantages grow by half (rounded down) instead of doubling. 🔒 Uncancelable." },
  three_point_barrage: { desc: "If three or more of your players have a 3PT Bonus, each of them takes a 3PT Shot Check at +2. You may spend 1 Assist for one more check." },
  // Climb-only
  bruise_brothers: { desc: "Stays in play this game: your Paint Shot Checks are +2." },
  chemistry: { desc: "Innate: starts the game in your hand. Stays in play this game: each screen card you play gives your next scoring roll +1 more than the last: +1, then +2, then +3.", innate: true },
  conditioning: { desc: "Your players' fatigue costs them nothing this game and the next." },
  ice_bath: { desc: "After this game, your players' fatigue is cleared. Ice Bath+ stays in your deck." },
  let_it_fly: { desc: "Stays in play this game: your 3PT Shot Checks are +2." },
  on_fire: { desc: "Stays in play this game: a player of yours who makes two shot checks in a row is On Fire — their shot checks are +3 until they miss." },
  pace_and_space: { desc: "Stays in play this game: +2 Speed to every player of yours." },
  shut_the_door: { desc: "Stays in play this game: opposing Paint Shot Checks are −2." },
  splash: { desc: "Stays in play this game: your 3PT Shot Checks get +1 for every three your team has made this game (up to +3)." },
  stay_hot: { desc: "Stays in play this game: your players carry the hot markers they finish it with into the next game (up to 3 each)." },
  weight_room: { desc: "Choose a player: +5 Power for the rest of this game." },
  // The Climb's wave two (2026-10-20), each with its "+" as approved.
  get_stops: { desc: "Stays in play this game: each time you play a defense card, gain 2 Rebounds." },
  talk_on_defense: { desc: "Stays in play this game: each time you play a switching card (Switch the Screen, Veer Switch, Switch Everything, Go Under, Fight Over), your defenders get +2 Speed this section." },
  ball_movement: { desc: "Innate: starts the game in your hand. Stays in play this game: each time you hit a 3PT Shot Check, gain 1 Assist.", innate: true },
  wear_them_down: { desc: "Stays in play this game: each time you hit a Paint Shot Check, the defender on that player has −1 Power for the rest of the game (up to −5 each)." },
  film_session: { desc: "Innate: starts the game in your hand. Stays in play this game: at the start of each section, draw 1 card.", innate: true },
  signature_set: { desc: "A player of yours who has not rolled gets +2 to their scoring roll this section. After each game you play it in, it gives 2 more for the rest of the run (up to +6)." },
  leave_it_all: { desc: "Every player of yours gets +4 to their scoring roll this section. After this game it leaves your deck." },
  up_tempo: { desc: "Draw 3 cards. At the end of this section, each of your starters adds 1 minute." },
  ride_your_star: { desc: "Your highest-salary starter, still to roll, gets +4 to their scoring roll this section. At the end of the section they add 2 minutes." },
  full_court_press: { desc: "Your five get +4 Speed on defense this section. At the end of it, each adds 2 minutes." },
  crash_every_board: { desc: "Gain 4 Rebounds. At the end of this section, your two highest-Power starters each add 2 minutes." },
  play_through_contact: { desc: "A player with a Power advantage takes a Paint Shot Check at +5. Hit: a hot marker. At the end of this section they add 3 minutes." },
  two_a_days: { desc: "After this game, practise one card in your deck into its \"+\" (from the map), and your players carry 2 more minutes into the next game. Two-a-Days+ then leaves your deck." },
};

const PLUS_STRATS = new Map();
/** A card by id — a "+" copy as its card, named with the "+" and its "+" text. */
export function getStrat(id) {
  if (!isPlus(id)) return STRAT_MAP[id];
  if (PLUS_STRATS.has(id)) return PLUS_STRATS.get(id);
  const base = STRAT_MAP[baseId(id)];
  const out = base ? { ...base, id, base: base.id, upgraded: true, name: `${base.name}${PLUS_MARK}`, desc: PLUS[base.id]?.desc ?? base.desc } : undefined;
  PLUS_STRATS.set(id, out);
  return out;
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
  'unethical_hoops', 'hack_a',
];

/**
 * THE TIMEOUT RIDERS: the crunch cards that play only inside your own called
 * timeout (canPlay's gate). One list (2026-09-18): canPlay let them through by
 * falling past every other crunch card, the coach's card values retyped them,
 * and the tutorial asked players to search for and play "timeout cards"
 * without saying which these were.
 */
export const TIMEOUT_RIDERS = ['ato_masterpiece', 'fresh_legs', 'ice_the_hot_hand', 'reset'];
