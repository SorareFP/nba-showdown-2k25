// THE CLIMB'S SCREENS — presentational, one per step of a run (run.js). The
// container (ClimbTab.jsx) owns the run, the store and the server calls; each
// screen here is the run plus the buttons for its next steps.
// docs/plans/2026-10-18-the-climb-design.md, docs/plans/2026-10-18-the-climb.md Task 9.
import { useMemo, useState } from 'react';
import { ZoomImg } from '../CardLightbox.jsx';
import { getPlayerThumbUrl, getPlayerImageUrl, getStratThumbPath, getStratImagePath, fallbackTo } from '../../game/cardImages.js';
import { AI_LEVELS, payNote } from '../../game/aiLevels.js';
import { capOf } from '../../game/coinRewards.js';
import { getStrat, isPlus, plusId, baseId } from '../../game/strats.js';
import { fatigueForMinutes } from '../../game/engine.js';
import { capSal, playerOnRoster } from '../../game/teamRules.js';
import { CLIMB, openStops, deckLine, potPreview, rosterCards, fiveProblem } from '../../game/modes/run.js';
import { cardKey, getCardByKey } from '../../game/cardSets.js';
import { FLOORS, stopById } from '../../game/modes/climbMap.js';
import { PLAYBOOKS, KIT_CARD_IDS, kitDeck } from '../../game/modes/climbKits.js';
import styles from './Climb.module.css';

const dollars = n => `$${Math.round(n).toLocaleString('en-US')}`;
const PLAYBOOK_NAME = { speed: 'Speed', paint: 'Paint', defense: 'Defense' };
const PLAYBOOK_LINE = {
  speed: 'Threes off movement, drives, the faster man.',
  paint: 'The paint, the post and the glass.',
  defense: 'Contests, rim protection, wearing them down.',
};
export const BOON_TEXT = {
  extra_picks: ['Extra pick', 'Take two strategy cards after each of your next three wins.'],
  cut_two: ['Trim the deck', 'Cut two cards from your starting fifteen.'],
  cap_400: ['Front office', '+$400 of cap room for the players you add.'],
  rare_strat: ['Scouting report', 'A random rare strategy card joins your deck.'],
  free_rest: ['Day off', 'One free Rest Day, to take from the map whenever you like.'],
};
const KIND = {
  game: { icon: '🏀', name: 'Game' },
  rivalry: { icon: '🔥', name: 'Rivalry' },
  rest: { icon: '⛺', name: 'Rest Day' },
  boss: { icon: '👑', name: 'Boss' },
};

/** A player card tile: the face opens the whole card. */
function PlayerTile({ cardKey, card, children, selected = false, onClick = null, extra = null }) {
  return (
    <div className={`${styles.tile} ${selected ? styles.selected : ''}`}>
      <ZoomImg
        player={cardKey}
        className={styles.face}
        src={getPlayerThumbUrl(cardKey)}
        onError={fallbackTo(getPlayerImageUrl(cardKey))}
        alt={card?.name ?? cardKey}
        loading="lazy"
      />
      <div className={styles.tileName}>{card?.name}</div>
      <div className={styles.tileMeta}>{dollars(card?.salary ?? 0)}{extra}</div>
      {onClick && <button type="button" className={styles.tileBtn} onClick={onClick}>{children}</button>}
    </div>
  );
}

/** A strategy card tile with its text. */
function StratTile({ id, children = null, onClick = null, disabled = false, note = null }) {
  const s = getStrat(id);
  if (!s) return null;
  return (
    <div className={`${styles.tile} ${styles.stratTile}`} data-rarity={s.rarity}>
      <ZoomImg strat={id} className={styles.face} src={getStratThumbPath(id)} onError={fallbackTo(getStratImagePath(id))} alt={s.name} loading="lazy" />
      <div className={styles.tileName}>{s.name}</div>
      <div className={styles.tileMeta}>{s.rarity}</div>
      <p className={styles.stratText}>{s.desc}</p>
      {note && <p className={styles.note}>{note}</p>}
      {onClick && <button type="button" className={styles.tileBtn} onClick={onClick} disabled={disabled}>{children}</button>}
    </div>
  );
}

function DeckLine({ run }) {
  const d = deckLine(run);
  return (
    <p className={styles.deckLine}>
      Deck: <strong>{d.size} cards</strong> · {d.leaning} lean {PLAYBOOK_NAME[d.playbook] ?? '—'}
      {' · '}{d.fits ? 'fits your team' : 'your team leans elsewhere'}
    </p>
  );
}

function PotLine({ run }) {
  const pot = potPreview(run);
  return <span>{pot.coins.toLocaleString('en-US')} coins{pot.booster ? ' and a Booster' : ''}</span>;
}

// ── Start ────────────────────────────────────────────────────────────────────

/** Pick a rung and five of your players under the starting cap. */
// `saved`: your saved teams; the Climb fives among them (made in My Teams,
// or with "Save these five" here) fill the five in one tap (the user,
// 2026-10-19). One that no longer works says why.
export function ClimbStart({ owned = [], saved = [], onStart, onSaveFive = null, busy = false }) {
  const [rung, setRung] = useState('prince');
  const [picked, setPicked] = useState([]);
  const ownedKeys = useMemo(() => new Set(owned.map(o => o.key)), [owned]);
  const fives = saved.filter(t => t.climb);
  const list = useMemo(() => [...owned].sort((a, b) => (b.card.salary ?? 0) - (a.card.salary ?? 0) || a.card.name.localeCompare(b.card.name)), [owned]);
  const cards = picked.map(k => list.find(o => o.key === k)?.card).filter(Boolean);
  const total = capSal(cards);
  // What is left must still buy the rest of the five: a player fits when
  // he and the cheapest others for the open spots fit under the cap.
  const byPrice = useMemo(() => [...list].sort((a, b) => (a.card.salary ?? 0) - (b.card.salary ?? 0)), [list]);
  const fits = o => {
    if (picked.length >= 5 || playerOnRoster(cards, o.card)) return false;
    const spotsAfter = 4 - picked.length;
    let reserve = 0;
    let n = 0;
    for (const x of byPrice) {
      if (n >= spotsAfter) break;
      if (x.card.id === o.card.id || picked.includes(x.key) || playerOnRoster(cards, x.card)) continue;
      reserve += x.card.salary ?? 0;
      n += 1;
    }
    return n === spotsAfter && total + (o.card.salary ?? 0) + reserve <= CLIMB.startCap;
  };
  const toggle = o => {
    if (picked.includes(o.key)) { setPicked(picked.filter(k => k !== o.key)); return; }
    if (fits(o)) setPicked([...picked, o.key]);
  };
  const chosen = list.filter(o => picked.includes(o.key));
  const open = list.filter(o => !picked.includes(o.key) && fits(o));
  const hidden = list.length - chosen.length - open.length;
  const ready = picked.length === 5 && total <= CLIMB.startCap;
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>The Climb</h2>
      <p className={styles.lede}>
        Bring five of your players under a {dollars(CLIMB.startCap)} cap, then climb seven floors of one-quarter games to a classic team.
        Wins add to the pot; one loss ends the run and the pot with it. Retire between stops to bank it.
      </p>
      <h3 className={styles.h3}>Coach</h3>
      <div className={styles.rungs}>
        {AI_LEVELS.map(l => (
          <button key={l.id} type="button" className={`${styles.rung} ${rung === l.id ? styles.on : ''}`} aria-pressed={rung === l.id} onClick={() => setRung(l.id)}>
            <strong>{l.label}</strong><span>{payNote(l.id)}</span>
          </button>
        ))}
      </div>
      {fives.length > 0 && (
        <>
          <h3 className={styles.h3}>Your Climb fives <span className={styles.muted}>saved in My Teams</span></h3>
          <div className={styles.fives}>
            {fives.map(t => {
              const problem = fiveProblem(t.players, ownedKeys);
              const cards5 = (t.players ?? []).map(k => getCardByKey(k)).filter(Boolean);
              return (
                <button key={t.id} type="button" data-five={t.id} className={styles.five} disabled={Boolean(problem) || busy}
                  onClick={() => setPicked(cards5.map(cardKey))} title={problem ?? `Bring ${t.name}`}>
                  <strong>{t.name}</strong>
                  <span>{problem ? problem : `${dollars(capSal(cards5))} · ${cards5.map(c => c.name.split(' ').slice(-1)[0]).join(', ')}`}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
      <h3 className={styles.h3}>Your five <span className={total > CLIMB.startCap ? styles.over : styles.muted}>{dollars(total)} of {dollars(CLIMB.startCap)} · {picked.length}/5</span></h3>
      {list.length === 0 && <p className={styles.muted}>Open your starter pack first: a climb starts with players you own.</p>}
      <div className={styles.grid}>
        {[...chosen, ...open].map(o => {
          const on = picked.includes(o.key);
          return (
            <PlayerTile key={o.key} cardKey={o.key} card={o.card} selected={on} onClick={() => toggle(o)}>
              {on ? 'Take out' : 'Bring'}
            </PlayerTile>
          );
        })}
      </div>
      {hidden > 0 && <p className={styles.muted}>{hidden} more of your players {picked.length >= 5 ? 'wait for the next climb' : 'do not fit what is left of the cap'}.</p>}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!ready || busy} onClick={() => onStart({ rung, keys: picked })}>Start the climb</button>
        {onSaveFive && <button type="button" disabled={!ready || busy} onClick={() => onSaveFive(picked)}>Save these five</button>}
      </div>
    </div>
  );
}

// ── Training Camp ────────────────────────────────────────────────────────────

/** A playbook and one boon of three. */
export function TrainingCamp({ run, onChoose, busy = false }) {
  const [playbook, setPlaybook] = useState(run.camp?.fits ?? 'speed');
  const [boon, setBoon] = useState(null);
  const [cuts, setCuts] = useState([]);
  const deck = kitDeck(playbook);
  const copies = Object.entries(deck).flatMap(([id, n]) => Array.from({ length: n }, (_, i) => `${id}#${i}`));
  const ready = boon && (boon !== 'cut_two' || cuts.length === 2);
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Training Camp</h2>
      <h3 className={styles.h3}>Playbook</h3>
      <div className={styles.playbooks}>
        {PLAYBOOKS.map(pb => (
          <button key={pb} type="button" className={`${styles.playbook} ${playbook === pb ? styles.on : ''}`} aria-pressed={playbook === pb} onClick={() => { setPlaybook(pb); setCuts([]); }}>
            <strong>{PLAYBOOK_NAME[pb]}</strong>
            {run.camp?.fits === pb && <span className={styles.badge}>fits your team</span>}
            <span className={styles.muted}>{PLAYBOOK_LINE[pb]}</span>
            <ul className={styles.cardList}>
              {Object.entries(kitDeck(pb)).map(([id, n]) => <li key={id}>{getStrat(id)?.name}{n > 1 ? ` ×${n}` : ''}</li>)}
            </ul>
          </button>
        ))}
      </div>
      <h3 className={styles.h3}>One of three</h3>
      <div className={styles.boons}>
        {(run.camp?.boons ?? []).map(b => (
          <button key={b} type="button" data-boon={b} className={`${styles.boon} ${boon === b ? styles.on : ''}`} aria-pressed={boon === b} onClick={() => { setBoon(b); setCuts([]); }}>
            <strong>{BOON_TEXT[b]?.[0] ?? b}</strong><span>{BOON_TEXT[b]?.[1]}</span>
          </button>
        ))}
      </div>
      {boon === 'cut_two' && (
        <>
          <h3 className={styles.h3}>Cut two <span className={styles.muted}>{cuts.length}/2</span></h3>
          <div className={styles.chips}>
            {copies.map(c => {
              const on = cuts.includes(c);
              return (
                <button key={c} type="button" className={`${styles.chip} ${on ? styles.on : ''}`} aria-pressed={on}
                  onClick={() => setCuts(on ? cuts.filter(x => x !== c) : cuts.length < 2 ? [...cuts, c] : cuts)}>
                  {getStrat(c.split('#')[0])?.name}
                </button>
              );
            })}
          </div>
        </>
      )}
      <div className={styles.actions}>
        <button type="button" className={styles.primary} disabled={!ready || busy}
          onClick={() => onChoose({ playbook, boon, cuts: cuts.map(c => c.split('#')[0]) })}>To the map</button>
      </div>
    </div>
  );
}

// ── The map ──────────────────────────────────────────────────────────────────

const ROW = 74;
const PAD = 20;
const yOf = floor => PAD + (FLOORS + 1 - floor) * ROW + ROW / 2;
const xOf = lane => (lane + 0.5) * 100;

/** The act: seven floors and the boss, the open stops tappable; your team, the pot and the way out beside it. */
export function ClimbMap({ run, onGo, onRetire, onFreeRest, onAbandon = null, busy = false }) {
  const open = new Set(openStops(run).map(s => s.id));
  const stops = [...run.map.floors.flat(), run.map.boss];
  const height = (FLOORS + 1) * ROW + PAD * 2;
  const links = run.map.floors.flat().flatMap(s => s.next.map(id => [s, stopById(run.map, id)]));
  const { cards } = rosterCards(run);
  const mult = capOf(run.rung);
  const capAt = s => s.kind === 'boss' ? CLIMB.bossCap * mult
    : s.kind === 'rest' ? null
      : (CLIMB.floorCap(s.floor) + (s.kind === 'rivalry' ? CLIMB.rivalryExtra : 0)) * mult;
  const rung = AI_LEVELS.find(l => l.id === run.rung)?.label ?? run.rung;
  const floor = run.at ? stopById(run.map, run.at)?.floor ?? 0 : 0;
  return (
    <div className={styles.screen}>
    <h2 className={styles.title}>The Climb <span className={styles.muted}>· {rung} · {floor ? `floor ${floor} cleared` : 'floor 1 ahead'}</span></h2>
    <div className={styles.mapScreen}>
      <div className={styles.mapWrap} style={{ height }}>
        <svg className={styles.links} viewBox={`0 0 300 ${height}`} preserveAspectRatio="none" aria-hidden="true">
          {links.map(([a, b]) => (
            <line key={`${a.id}-${b.id}`} x1={xOf(a.lane)} y1={yOf(a.floor)} x2={xOf(b.lane)} y2={yOf(b.floor)}
              className={run.cleared.includes(a.id) || run.at === a.id ? styles.linkLit : styles.link} />
          ))}
        </svg>
        {stops.map(s => {
          const isOpen = open.has(s.id);
          const done = run.cleared.includes(s.id) || run.at === s.id;
          const cap = capAt(s);
          return (
            <button
              key={s.id}
              type="button"
              data-stop={s.id}
              data-open={isOpen ? 'true' : 'false'}
              className={`${styles.stop} ${styles[s.kind]} ${isOpen ? styles.open : ''} ${done ? styles.done : ''}`}
              style={{ left: `${(s.lane + 0.5) / 3 * 100}%`, top: yOf(s.floor) }}
              disabled={!isOpen || busy}
              onClick={() => onGo(s.id)}
              title={`${KIND[s.kind].name}${cap ? ` · coach's cap ${dollars(cap)}` : ''}`}
            >
              <span className={styles.stopIcon}>{done ? '✓' : KIND[s.kind].icon}</span>
              <span className={styles.stopName}>{KIND[s.kind].name}</span>
              {cap && <span className={styles.stopCap}>{dollars(cap)}</span>}
            </button>
          );
        })}
      </div>
      <aside className={styles.side}>
        <div className={styles.stat}><span>Pot</span><strong><PotLine run={run} /></strong></div>
        <div className={styles.stat}><span>Cap</span><strong>{dollars(capSal(cards))} of {dollars(run.cap)}</strong></div>
        <DeckLine run={run} />
        <h3 className={styles.h3}>Your team</h3>
        <ul className={styles.roster}>
          {cards.map(c => {
            const min = run.fatigue?.[c.id] ?? 0;
            const pen = fatigueForMinutes(min);
            return (
              <li key={c.id}>
                <span>{c.name}</span>
                <span className={pen < 0 ? styles.tired : styles.muted}>{min ? `${min} min${pen < 0 ? ` (${pen})` : ''}` : 'fresh'}</span>
              </li>
            );
          })}
        </ul>
        <div className={styles.sideActions}>
          {run.freeRest > 0 && <button type="button" onClick={onFreeRest} disabled={busy}>Take the free Rest Day</button>}
          <button type="button" className={styles.danger} onClick={onRetire} disabled={busy}>Retire and bank the pot</button>
          {onAbandon && <button type="button" onClick={onAbandon} disabled={busy}>Give up this run</button>}
        </div>
      </aside>
    </div>
    </div>
  );
}

// ── Rewards ──────────────────────────────────────────────────────────────────

/** Pick a strategy card (or two), maybe a player, or skip. */
export function RewardPicker({ run, onPickStrat, onPickPlayer, onSkip, busy = false }) {
  const o = run.offers ?? { strats: [], players: [], picks: 0 };
  const room = run.cap - capSal(rosterCards(run).cards);
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>A win. Choose your reward.</h2>
      <DeckLine run={run} />
      {o.strats.length > 0 && o.picks > 0 && (
        <>
          <h3 className={styles.h3}>Strategy cards <span className={styles.muted}>take {o.picks}, or skip</span></h3>
          <div className={styles.grid}>
            {o.strats.map(id => <StratTile key={id} id={id} onClick={() => onPickStrat(id)} disabled={busy}>Take</StratTile>)}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => onSkip('strats')} disabled={busy}>Skip the cards</button></div>
        </>
      )}
      {o.players.length > 0 && (
        <>
          <h3 className={styles.h3}>A player <span className={styles.muted}>{dollars(room)} of room · for this run only</span></h3>
          <div className={styles.grid} data-player-offer="true">
            {o.players.map(k => {
              const card = rosterCards({ roster: [k] }).cards[0];
              return <PlayerTile key={k} cardKey={k} card={card} onClick={busy ? null : () => onPickPlayer(k)}>Sign</PlayerTile>;
            })}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => onSkip('players')} disabled={busy}>Skip the players</button></div>
        </>
      )}
      {o.players.length > 0 && o.strats.length > 0 && o.picks > 0 && (
        <div className={styles.actions}><button type="button" onClick={() => onSkip()} disabled={busy}>Skip everything</button></div>
      )}
    </div>
  );
}

// ── Rest Day ─────────────────────────────────────────────────────────────────

/** Rest everyone, or practice: upgrade one copy (the user, 2026-10-19: not "smith"). */
export function RestDay({ run, onRest, onPractice, busy = false, free = false }) {
  const { cards } = rosterCards(run);
  const tired = cards.filter(c => (run.fatigue?.[c.id] ?? 0) > 0);
  const ids = Object.keys(run.deck ?? {}).filter(id => run.deck[id] > 0).sort((a, b) => (getStrat(a)?.name ?? a).localeCompare(getStrat(b)?.name ?? b));
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>{free ? 'A day off' : 'Rest Day'}</h2>
      <p className={styles.lede}>One of two: rest the whole team, or practice and upgrade one card.</p>
      <div className={styles.restChoice}>
        <section className={styles.restCard}>
          <h3 className={styles.h3}>Rest</h3>
          <p className={styles.muted}>{tired.length ? `${tired.map(c => `${c.name} (${run.fatigue[c.id]} min)`).join(', ')} come back fresh.` : 'Everyone is fresh already.'}</p>
          <button type="button" className={styles.primary} onClick={onRest} disabled={busy}>Rest</button>
        </section>
        <section className={styles.restCard}>
          <h3 className={styles.h3}>Practice <span className={styles.muted}>upgrade one copy</span></h3>
          <ul className={styles.practiceList}>
            {ids.map(id => {
              const plus = isPlus(id);
              const kit = KIT_CARD_IDS.has(baseId(id));
              return (
                <li key={id}>
                  <strong>{getStrat(id)?.name}</strong>
                  {run.deck[id] > 1 && <span className={styles.muted}> ×{run.deck[id]}</span>}
                  {plus ? <span className={styles.muted}> already upgraded</span>
                    : kit ? (
                      <>
                        <span className={styles.practiceText}><strong>{getStrat(plusId(id))?.name}:</strong> {getStrat(plusId(id))?.desc}</span>
                        <button type="button" onClick={() => onPractice(id)} disabled={busy}>Practice it</button>
                      </>
                    ) : <span className={styles.muted}> no upgrade yet</span>}
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ── The end ──────────────────────────────────────────────────────────────────

/** Won, retired or lost: the pot, banked or gone. */
export function RunOver({ run, onBank, onNew, onAbandon = null, busy = false }) {
  const pot = potPreview(run);
  const lost = run.status === 'lost';
  const banked = run.banked;
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>{run.status === 'won' ? 'You beat the boss!' : lost ? 'The run is over' : 'Retired'}</h2>
      {lost ? (
        <p className={styles.lede}>{pot.coins > 0
          ? `One loss ends a climb, and the pot is lost: ${pot.coins.toLocaleString('en-US')} coins this time.`
          : 'One loss ends a climb. Nothing was in the pot yet.'}</p>
      ) : banked ? (
        <p className={styles.lede}>Banked: {banked.coins.toLocaleString('en-US')} coins{banked.booster ? ' and a Booster (open it from Collection, under your boxes)' : ''}.</p>
      ) : (
        <>
          <p className={styles.lede}>The pot: {pot.coins.toLocaleString('en-US')} coins{pot.booster ? ' and a Booster' : ''}.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} onClick={onBank} disabled={busy}>Bank the pot</button>
            {onAbandon && <button type="button" onClick={onAbandon} disabled={busy}>Give up this run</button>}
          </div>
        </>
      )}
      {(lost || banked) && <div className={styles.actions}><button type="button" className={styles.primary} onClick={onNew}>Start a new climb</button></div>}
    </div>
  );
}
