// THE CLIMB'S SCREENS — presentational, one per step of a run (run.js). The
// container (ClimbTab.jsx) owns the run, the store and the server calls; each
// screen here is the run plus the buttons for its next steps.
// docs/plans/2026-10-18-the-climb-design.md, docs/plans/2026-10-18-the-climb.md Task 9.
import { useEffect, useMemo, useState } from 'react';
import { ZoomImg } from '../CardLightbox.jsx';
import { getPlayerThumbUrl, getPlayerImageUrl, getStratThumbPath, getStratImagePath, fallbackTo } from '../../game/cardImages.js';
import { AI_LEVELS, payNote } from '../../game/aiLevels.js';
import { capOf } from '../../game/coinRewards.js';
import { getStrat, isPlus, plusId, baseId, PLUS } from '../../game/strats.js';
import { fatigueForMinutes } from '../../game/engine.js';
import { capSal, playerOnRoster, DEFAULT_FILTERS, filterPool, sortPool } from '../../game/teamRules.js';
import PoolFilters from '../PoolFilters.jsx';
import { CLIMB, openStops, deckLine, potPreview, rosterCards, fiveProblem, bossTeam, bossScout, MIN_DECK } from '../../game/modes/run.js';
import { logoSrc } from '../../cards/CardTemplate.jsx';
import { cardKey, getCardByKey } from '../../game/cardSets.js';
import { FLOORS, stopById, nextStops } from '../../game/modes/climbMap.js';
import { PLAYBOOKS, kitDeck, CORE, KITS } from '../../game/modes/climbKits.js';
import { PERKS, boostsOf, boostedCard, perkProblem, practicable } from '../../game/modes/climbPerks.js';
import { cardFit } from '../../game/cardFit.js';
import { fitsSystem, systemLine } from '../../game/systemFit.js';
import styles from './Climb.module.css';

const dollars = n => `$${Math.round(n).toLocaleString('en-US')}`;
const PLAYBOOK_NAME = { speed: 'Speed', paint: 'Paint', defense: 'Defense' };
const PLAYBOOK_LINE = {
  speed: 'Threes off movement, drives, the faster player.',
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
function PlayerTile({ cardKey, card, children, selected = false, onClick = null, extra = null, big = false, inSystem = false }) {
  return (
    <div className={`${styles.tile} ${selected ? styles.selected : ''} ${big ? styles.offer : ''} ${inSystem ? styles.fits : ''}`} data-in-system={inSystem ? 'true' : undefined}>
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
      {inSystem && <div className={styles.fitLine}>✓ In System</div>}
      {onClick && <button type="button" className={styles.tileBtn} onClick={onClick}>{children}</button>}
    </div>
  );
}

// Who a reward card is for (cardFit.js; the user, 2026-10-19: "it could glow a
// little and say 'matches (player)'"): the first two names, then a count.
const fitNames = ps => {
  const names = ps.map(p => p.name);
  return names.length > 2 ? `${names.slice(0, 2).join(', ')} and ${names.length - 2} more` : names.join(' and ');
};

/** A strategy card tile with its text; `fit` (cardFit) marks who on your team it is for. */
function StratTile({ id, children = null, onClick = null, disabled = false, note = null, big = false, fit = null }) {
  const s = getStrat(id);
  if (!s) return null;
  return (
    <div className={`${styles.tile} ${styles.stratTile} ${big ? styles.offer : ''} ${fit?.ok ? styles.fits : ''}`} data-rarity={s.rarity} data-fits={fit ? String(fit.ok) : undefined}>
      <ZoomImg strat={id} className={styles.face} src={getStratThumbPath(id)} onError={fallbackTo(getStratImagePath(id))} alt={s.name} loading="lazy" />
      <div className={styles.tileName}>{s.name}</div>
      {fit && (fit.ok
        ? <div className={styles.fitLine}>✓ Matches {fitNames(fit.matches)}</div>
        : <div className={styles.fitMiss}>{fit.matches.length ? `Not enough yet: only ${fitNames(fit.matches)}` : 'No player of yours fits it yet'}</div>)}
      <div className={styles.tileMeta}>{s.rarity}</div>
      <p className={styles.stratText}>{s.desc}</p>
      {note && <p className={styles.note}>{note}</p>}
      {onClick && <button type="button" className={styles.tileBtn} onClick={onClick} disabled={disabled}>{children}</button>}
    </div>
  );
}

// The number a perk moves, as the player stands now (his boosts included).
const PERK_STAT_NAME = { power: 'Power', shotLine: 'Shot Line', threePtBoost: '3PT Bonus' };
const perkNow = (card, stat, boost) => `${PERK_STAT_NAME[stat]} ${(card?.[stat] ?? 0) + (boost?.[stat] ?? 0)}`;

/**
 * A PERK ON OFFER (2026-10-19): what it does, who or what takes it, and Take.
 * A player perk lists the players it can still move (PERK_CAP), with the
 * number as it stands; Film Study lists the cards with a "+".
 */
function PerkTile({ run, id, onPick, busy }) {
  const def = PERKS[id];
  const { cards } = rosterCards(run);
  const boosts = boostsOf(run);
  const ids = cards.map(c => c.id);
  const options = def.target === 'card'
    ? practicable(run.deck).map(cid => ({ value: cid, label: getStrat(cid)?.name ?? cid }))
    : cards.filter(c => !perkProblem(run, id, c.id, ids)).map(c => ({ value: c.id, label: `${c.name} · ${perkNow(c, def.stat, boosts[c.id])}` }));
  const [target, setTarget] = useState(options[0]?.value ?? '');
  return (
    <div className={`${styles.tile} ${styles.offer} ${styles.perk}`} data-perk={id}>
      <div className={styles.perkIcon} aria-hidden="true">{def.icon}</div>
      <div className={styles.tileName}>{def.name}</div>
      <p className={styles.stratText}>{def.text}</p>
      <select className={styles.perkSelect} value={target} onChange={e => setTarget(e.target.value)} aria-label={def.target === 'card' ? 'Which card' : 'Which player'}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <button type="button" className={styles.tileBtn} disabled={busy || !target} onClick={() => onPick(id, target)}>Take</button>
    </div>
  );
}

/**
 * SCOUTING THE BOSS (2026-10-19): who you are building to beat — the boss
 * game's own roster and deck (bossScout), its five best by salary, its
 * playbook and the rare cards it holds — on the map from floor 1.
 */
function ScoutReport({ run }) {
  const scout = useMemo(() => { try { return bossScout(run); } catch { return null; } }, [run.seed, run.rung]); // eslint-disable-line
  if (!scout) return null;
  const o = scout.opponent;
  return (
    <details className={styles.scout} data-scout="true" open>
      <summary className={styles.h3}>Scouting the boss <span className={styles.muted}>{o.classic ? 'classic ' : ''}{o.city} {o.name}</span></summary>
      <p className={styles.deckLine}>
        {dollars(scout.cap)} of players{scout.playbook ? ` · plays ${PLAYBOOK_NAME[scout.playbook]}` : ''} · a {scout.deckSize}-card deck
      </p>
      <ul className={styles.roster}>
        {scout.players.slice(0, 5).map(c => (
          <li key={cardKey(c)}><span>{c.name}</span><span className={styles.muted}>S{c.speed} P{c.power} · line {c.shotLine}</span></li>
        ))}
      </ul>
      {scout.rares.length > 0 && (
        <p className={styles.deckLine}>Its rares: {scout.rares.map(id => getStrat(baseId(id))?.name).join(', ')}</p>
      )}
    </details>
  );
}

/** The run's perks, for the map's side panel. */
function PerkList({ run }) {
  const perks = run.perks ?? [];
  if (!perks.length) return null;
  const { cards } = rosterCards(run);
  return (
    <>
      <h3 className={styles.h3}>Perks</h3>
      <ul className={styles.roster} data-perks="true">
        {perks.map((p, i) => {
          const def = PERKS[p.id];
          const who = def?.target === 'card' ? getStrat(p.target)?.name : cards.find(c => c.id === p.target)?.name;
          return <li key={`${p.id}-${i}`}><span>{def?.icon} {def?.name ?? p.id}</span><span className={styles.muted}>{who ?? ''}</span></li>;
        })}
      </ul>
    </>
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

// ── The Climb bar ─────────────────────────────────────────────────────────────

const STAT_LINE = { power: 'Power', shotLine: 'Shot Line', threePtBoost: '3PT Bonus', speed: 'Speed', paintBoost: 'Paint Bonus' };
const signed = n => (n > 0 ? `+${n}` : `${n}`);

/** Every card in the run's deck as its own face: a practiced copy shows its "+" face. */
export function deckFaces(run) {
  return Object.entries(run.deck ?? {})
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ id, n, name: getStrat(baseId(id))?.name ?? id, plus: isPlus(id) }))
    .sort((a, b) => a.name.localeCompare(b.name) || Number(a.plus) - Number(b.plus));
}

function DeckView({ run }) {
  const faces = deckFaces(run);
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Your deck <span className={styles.muted}>· {faces.reduce((t, f) => t + f.n, 0)} cards</span></h2>
      {run.playbook ? <DeckLine run={run} /> : <p className={styles.muted}>Your deck is chosen at Training Camp.</p>}
      <div className={styles.grid}>
        {faces.map(f => {
          const s = getStrat(baseId(f.id));
          return (
            <div key={f.id} data-deck-card={f.id} className={`${styles.tile} ${styles.stratTile}`} data-rarity={s?.rarity}>
              <ZoomImg strat={f.id} className={styles.face} src={getStratThumbPath(f.id)} onError={fallbackTo(getStratImagePath(f.id))} alt={s?.name} loading="lazy" />
              <div className={styles.tileName}>{s?.name}{f.plus ? '+' : ''}</div>
              <div className={styles.tileMeta}>{[f.n > 1 ? `×${f.n}` : null, s?.climbOnly ? 'Climb only' : s?.rarity].filter(Boolean).join(' · ')}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeamView({ run }) {
  const { cards } = rosterCards(run);
  const boosts = boostsOf(run);
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>Your team <span className={styles.muted}>· {cards.length} players · {dollars(capSal(cards))} of {dollars(run.cap ?? CLIMB.startCap)}</span></h2>
      {CLIMB.system && run.playbook && <p className={styles.deckLine}>{systemLine(run.playbook)}</p>}
      <PerkList run={run} />
      <div className={styles.grid}>
        {cards.map(c => {
          const k = cardKey(c);
          const b = boosts[c.id] ?? {};
          const min = run.fatigue?.[c.id] ?? 0;
          const pen = fatigueForMinutes(min);
          const lines = [
            min ? `${min} min${pen < 0 ? ` (${pen})` : ''}` : 'fresh',
            ...Object.entries(b).filter(([, n]) => n).map(([stat, n]) => `${STAT_LINE[stat] ?? stat} ${signed(n)}`),
          ];
          return (
            <PlayerTile key={k} cardKey={k} card={c} inSystem={CLIMB.system && fitsSystem(run.playbook, boostedCard(c, b))}
              extra={<> · <span className={pen < 0 ? styles.tired : undefined}>{lines.join(' · ')}</span></>} />
          );
        })}
      </div>
    </div>
  );
}

const HUD_VIEWS = [
  { id: 'map', label: '🗺 Map' },
  { id: 'deck', label: '🃏 Deck' },
  { id: 'team', label: '👥 Team' },
];

/**
 * THE CLIMB BAR (the user, 2026-10-20: "You need to be able to look at your
 * current map, deck, and player cards at all times in The Climb, no matter
 * the screen"). Slay the Spire's top bar: Map, Deck and Team on every Climb
 * screen and on the Play board during a run's game, each opening over the
 * screen it was asked from and closing back to it (✕ or Escape). It shows,
 * never acts: the map is the read-only one.
 */
export function ClimbHud({ run }) {
  const [view, setView] = useState(null);
  useEffect(() => {
    if (!view) return undefined;
    const onKey = e => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);
  if (!run?.map) return null;
  const deckCount = Object.values(run.deck ?? {}).reduce((t, n) => t + (n > 0 ? n : 0), 0);
  const teamCount = rosterCards(run).cards.length;
  const count = { map: null, deck: run.playbook ? deckCount : null, team: teamCount };
  const close = () => setView(null);
  return (
    <>
      <nav className={styles.hud} aria-label="Your run" data-climb-hud="true">
        {HUD_VIEWS.map(v => (
          <button key={v.id} type="button" data-hud={v.id} className={view === v.id ? styles.on : ''} aria-pressed={view === v.id} onClick={() => setView(view === v.id ? null : v.id)}>
            {v.label}{count[v.id] != null ? ` · ${count[v.id]}` : ''}
          </button>
        ))}
      </nav>
      {view && (
        <div className={styles.hudOverlay} role="dialog" aria-modal="true" aria-label={HUD_VIEWS.find(v => v.id === view)?.label} data-hud-view={view}>
          <div className={styles.hudTop}>
            {HUD_VIEWS.map(v => (
              <button key={v.id} type="button" className={view === v.id ? styles.on : ''} aria-pressed={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
            ))}
            <button type="button" className={styles.hudClose} data-hud-close="true" onClick={close} aria-label="Close">✕ Close</button>
          </div>
          {view === 'map' && <ClimbMap run={run} onBack={close} backLabel="✕ Close the map" />}
          {view === 'deck' && <DeckView run={run} />}
          {view === 'team' && <TeamView run={run} />}
        </div>
      )}
    </>
  );
}

// ── Start ────────────────────────────────────────────────────────────────────

/** Pick a rung and five of your players under the starting cap. */
// `saved`: your saved teams; the Climb fives among them (made in My Teams,
// or with "Save these five" here) fill the five in one tap (the user,
// 2026-10-19). One that no longer works says why.
export function ClimbStart({ owned = [], saved = [], onStart, onSaveFive = null, busy = false }) {
  const [rung, setRung] = useState('prince');
  const [picked, setPicked] = useState([]);
  // THE TEAM BUILDER'S FILTER ROW (the user, 2026-10-20: "We need the same
  // sorting for building a climb 5 as we have for team builder"): search,
  // team, position, salary and sort, the one PoolFilters both builders use.
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const ownedKeys = useMemo(() => new Set(owned.map(o => o.key)), [owned]);
  const teams = useMemo(() => [...new Set(owned.map(o => o.card.team))].sort(), [owned]);
  const fives = saved.filter(t => t.climb);
  const list = useMemo(() => [...owned].sort((a, b) => (b.card.salary ?? 0) - (a.card.salary ?? 0) || a.card.name.localeCompare(b.card.name)), [owned]);
  const cards = picked.map(k => list.find(o => o.key === k)?.card).filter(Boolean);
  const total = capSal(cards);
  // What is left must still buy the rest of the five: a player fits when
  // they and the cheapest others for the open spots fit under the cap.
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
  // Your five stay on top in the order you picked them; the filters narrow
  // and order everyone else.
  const chosen = picked.map(k => list.find(o => o.key === k)).filter(Boolean);
  const shown = useMemo(() => {
    const byCard = new Map(list.map(o => [o.card, o]));
    return sortPool(filterPool(list.map(o => o.card), filters), filters.sort).map(c => byCard.get(c));
  }, [list, filters]);
  const rest = shown.filter(o => !picked.includes(o.key));
  const open = rest.filter(fits);
  const hidden = rest.length - open.length;
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
      {list.length > 0 && <PoolFilters value={filters} onChange={setFilters} teams={teams} />}
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
      <p className={styles.lede}>
        Every deck carries the seven switching basics ({Object.entries(CORE).map(([id, n]) => `${getStrat(id)?.name}${n > 1 ? ` ×${n}` : ''}`).join(', ')}) and the nine cards of the playbook you choose, a crunch card among them.
      </p>
      {/* The playbooks as their cards (2026-10-19, "use the whole screen"): a
          face opens the whole card (ZoomImg stops the click), anywhere else
          on the panel chooses it. */}
      <div className={styles.playbooks}>
        {PLAYBOOKS.map(pb => {
          const on = playbook === pb;
          const choose = () => { setPlaybook(pb); setCuts([]); };
          return (
            <div key={pb} data-playbook={pb} className={`${styles.playbook} ${on ? styles.on : ''}`} onClick={choose}>
              <button type="button" className={styles.playbookHead} aria-pressed={on} onClick={e => { e.stopPropagation(); choose(); }}>
                <strong>{PLAYBOOK_NAME[pb]}</strong>
                {run.camp?.fits === pb && <span className={styles.badge}>fits your team</span>}
                <span className={styles.muted}>{PLAYBOOK_LINE[pb]}</span>
                {CLIMB.system && (
                  <span className={styles.systemLine} data-system={pb}>
                    {systemLine(pb)} · {rosterCards(run).cards.filter(c => fitsSystem(pb, c)).length} of your five
                  </span>
                )}
              </button>
              <div className={styles.kitFaces}>
                {Object.entries(KITS[pb]).map(([id, n]) => (
                  <div key={id} className={styles.kitFace}>
                    <ZoomImg strat={id} className={styles.face} src={getStratThumbPath(id)} onError={fallbackTo(getStratImagePath(id))} alt={getStrat(id)?.name} loading="lazy" />
                    {n > 1 && <span className={styles.copies}>×{n}</span>}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
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

// The map is the screen (the user, 2026-10-19: "make the actual climb the main
// part here, visually"): it fills the main column and the window's height, and
// every position is a percentage of it, so the lines (a 300 x 100 viewBox
// stretched over the same box) and the stops always meet.
const ROWS = FLOORS + 1;
const yPct = floor => (ROWS - floor + 0.5) / ROWS * 100;
const xPct = lane => (lane + 0.5) / 3 * 100;

/** Every stop a run standing at `fromId` (null: before floor 1) can still reach. */
function reachableFrom(map, fromId) {
  const seen = new Set();
  const todo = nextStops(map, fromId);
  while (todo.length) {
    const s = todo.pop();
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    todo.push(...nextStops(map, s.id));
  }
  return seen;
}

/**
 * The act: seven floors and the boss, the open stops tappable; your team, the
 * pot and the way out beside it. Stops you can no longer reach fade.
 *
 * `onBack` makes it A LOOK FROM THE REST DAY (the user, 2026-10-19: "a way to
 * return to the map and see what's coming up on the path"): nothing tappable,
 * you marked at the Rest Day, the stops after it outlined, and one way back.
 */
// `backLabel`: the read-only map is also the Climb bar's (ClimbHud, 2026-10-20),
// from any screen; during a run game the stop being played is "here".
export function ClimbMap({ run, onGo = () => {}, onRetire = () => {}, onFreeRest = () => {}, onAbandon = null, busy = false, onBack = null, backLabel = '← Back to the Rest Day' }) {
  const peek = Boolean(onBack);
  const here = peek && run.status === 'rest' ? run.restAt : peek && run.status === 'game' ? (run.game?.stopId ?? run.at) : run.at;
  const open = new Set(peek ? [] : openStops(run).map(s => s.id));
  const ahead = peek ? new Set(nextStops(run.map, here).map(s => s.id)) : open;
  const reachable = useMemo(() => reachableFrom(run.map, here), [run.map, here]);
  const path = new Set([...run.cleared, run.at, here].filter(Boolean));
  const stops = [...run.map.floors.flat(), run.map.boss];
  const links = run.map.floors.flat().flatMap(s => s.next.map(id => [s, stopById(run.map, id)]));
  const boss = useMemo(() => bossTeam(run), [run.seed, run.rung]);
  const { cards } = rosterCards(run);
  const boosts = boostsOf(run);
  const mult = capOf(run.rung);
  const capAt = s => s.kind === 'boss' ? CLIMB.bossCap * mult
    : s.kind === 'rest' ? null
      : (CLIMB.floorCap(s.floor) + (s.kind === 'rivalry' ? CLIMB.rivalryExtra : 0)) * mult;
  const rung = AI_LEVELS.find(l => l.id === run.rung)?.label ?? run.rung;
  const floor = here ? stopById(run.map, here)?.floor ?? 0 : 0;
  return (
    <div className={styles.screen}>
    <h2 className={styles.title}>The Climb <span className={styles.muted}>· {rung} · {peek && run.status === 'rest' ? `Rest Day on floor ${floor}` : peek && run.status === 'game' ? `playing floor ${floor}` : floor ? `floor ${floor} cleared` : 'floor 1 ahead'}</span></h2>
    {peek && (
      <div className={styles.actions}>
        <button type="button" className={styles.primary} data-map-back="true" onClick={onBack}>{backLabel}</button>
        <span className={styles.muted}>The outlined stops come next.</span>
      </div>
    )}
    <div className={styles.mapScreen}>
      <div className={styles.mapPanel}>
      <div className={styles.mapWrap}>
        {Array.from({ length: FLOORS }, (_, i) => i + 1).map(f => (
          <span key={f} className={`${styles.floorNo} ${f === floor + 1 ? styles.floorNext : ''}`} style={{ top: `${yPct(f)}%` }} aria-hidden="true">{f}</span>
        ))}
        <svg className={styles.links} viewBox="0 0 300 100" preserveAspectRatio="none" aria-hidden="true">
          {links.map(([a, b]) => (
            <line key={`${a.id}-${b.id}`} x1={xPct(a.lane) * 3} y1={yPct(a.floor)} x2={xPct(b.lane) * 3} y2={yPct(b.floor)}
              className={path.has(a.id) && path.has(b.id) ? styles.linkLit : a.id === (here ?? null) && ahead.has(b.id) ? styles.linkAhead : styles.link} />
          ))}
        </svg>
        {stops.map(s => {
          const isOpen = open.has(s.id);
          const done = run.cleared.includes(s.id) || run.at === s.id;
          const isHere = s.id === here;
          const isAhead = peek && ahead.has(s.id);
          const far = !path.has(s.id) && !reachable.has(s.id);
          const cap = capAt(s);
          const isBoss = s.kind === 'boss';
          const logo = isBoss && boss.logo ? logoSrc(boss.logo) : null;
          return (
            <button
              key={s.id}
              type="button"
              data-stop={s.id}
              data-open={isOpen ? 'true' : 'false'}
              data-ahead={isAhead ? 'true' : undefined}
              data-here={isHere ? 'true' : undefined}
              data-far={far ? 'true' : undefined}
              className={`${styles.stop} ${styles[s.kind]} ${isOpen ? styles.open : ''} ${done ? styles.done : ''} ${isHere ? styles.here : ''} ${isAhead ? styles.ahead : ''} ${far ? styles.far : ''}`}
              style={{ left: `${xPct(s.lane)}%`, top: `${yPct(s.floor)}%` }}
              disabled={!isOpen || busy}
              onClick={() => onGo(s.id)}
              title={`${isBoss ? `Boss: the classic ${boss.city} ${boss.name}` : KIND[s.kind].name}${cap ? ` · coach's cap ${dollars(cap)}` : ''}`}
            >
              {logo && !done
                ? <img className={styles.bossLogo} src={logo} alt="" />
                : <span className={styles.stopIcon}>{done ? '✓' : KIND[s.kind].icon}</span>}
              <span className={styles.stopText}>
                <span className={styles.stopName}>{isBoss ? `Boss · ${boss.name}` : KIND[s.kind].name}</span>
                {cap && <span className={styles.stopCap}>{dollars(cap)}</span>}
              </span>
            </button>
          );
        })}
      </div>
      </div>
      <aside className={styles.side}>
        <div className={styles.stat}><span>Pot</span><strong><PotLine run={run} /></strong></div>
        <div className={styles.stat}><span>Cap</span><strong>{dollars(capSal(cards))} of {dollars(run.cap)}</strong></div>
        <DeckLine run={run} />
        <PerkList run={run} />
        <ScoutReport run={run} />
        <h3 className={styles.h3}>Your team</h3>
        {CLIMB.system && run.playbook && <p className={styles.deckLine}>{systemLine(run.playbook)}</p>}
        <ul className={styles.roster}>
          {cards.map(c => {
            const min = run.fatigue?.[c.id] ?? 0;
            const pen = fatigueForMinutes(min);
            const inSystem = CLIMB.system && fitsSystem(run.playbook, boostedCard(c, boosts[c.id]));
            return (
              <li key={c.id} data-in-system={inSystem ? 'true' : undefined}>
                <span>{c.name}{inSystem && <span className={styles.systemDot} title="In System"> ✓</span>}</span>
                <span className={pen < 0 ? styles.tired : styles.muted}>{min ? `${min} min${pen < 0 ? ` (${pen})` : ''}` : 'fresh'}</span>
              </li>
            );
          })}
        </ul>
        {!peek && (
          <div className={styles.sideActions}>
            {run.freeRest > 0 && <button type="button" onClick={onFreeRest} disabled={busy}>Take the free Rest Day</button>}
            <button type="button" className={styles.danger} onClick={onRetire} disabled={busy}>Retire and bank the pot</button>
            {onAbandon && <button type="button" onClick={onAbandon} disabled={busy}>Give up this run</button>}
          </div>
        )}
      </aside>
    </div>
    </div>
  );
}

// ── Rewards ──────────────────────────────────────────────────────────────────

/**
 * Pick a strategy card (or two), maybe a player, or skip. The offers are the
 * screen (the user, 2026-10-19: "let's use the whole screen here"): big cards
 * across the middle, sized to the window, as StS shows a card reward.
 */
export function RewardPicker({ run, onPickStrat, onPickPlayer, onPickPerk = () => {}, onSkip, busy = false }) {
  const o = run.offers ?? { strats: [], players: [], picks: 0 };
  const perks = o.perks ?? [];
  // Your team as a game would deal it (perks on): what each card is checked against.
  const team = (() => { const b = boostsOf(run); return rosterCards(run).cards.map(c => boostedCard(c, b[c.id])); })();
  const room = run.cap - capSal(rosterCards(run).cards);
  return (
    <div className={`${styles.screen} ${styles.offerScreen}`}>
      <h2 className={styles.title}>A win. Choose your reward.</h2>
      <DeckLine run={run} />
      {o.strats.length > 0 && o.picks > 0 && (
        <>
          <h3 className={styles.h3}>Strategy cards <span className={styles.muted}>take {o.picks}, or skip</span></h3>
          <div className={styles.offers}>
            {o.strats.map(id => <StratTile key={id} id={id} big fit={cardFit(id, team)} onClick={() => onPickStrat(id)} disabled={busy}>Take</StratTile>)}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => onSkip('strats')} disabled={busy}>Skip the cards</button></div>
        </>
      )}
      {o.players.length > 0 && (
        <>
          <h3 className={styles.h3}>A player <span className={styles.muted}>{dollars(room)} of room · for this run only</span></h3>
          <div className={styles.offers} data-player-offer="true">
            {o.players.map(k => {
              const card = rosterCards({ roster: [k] }).cards[0];
              // What signing them leaves (2026-10-19): the three come at three prices.
              return <PlayerTile key={k} cardKey={k} card={card} big inSystem={CLIMB.system && fitsSystem(run.playbook, card)} extra={<> · leaves {dollars(room - (card?.salary ?? 0))}</>} onClick={busy ? null : () => onPickPlayer(k)}>Sign</PlayerTile>;
            })}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => onSkip('players')} disabled={busy}>Skip the players</button></div>
        </>
      )}
      {perks.length > 0 && (
        <>
          <h3 className={styles.h3}>A perk <span className={styles.muted}>for the rest of the run · a Rivalry's prize</span></h3>
          <div className={styles.offers} data-perk-offer="true">
            {perks.map(id => <PerkTile key={id} run={run} id={id} onPick={onPickPerk} busy={busy} />)}
          </div>
          <div className={styles.actions}><button type="button" onClick={() => onSkip('perks')} disabled={busy}>Skip the perk</button></div>
        </>
      )}
      {[o.players.length > 0, o.strats.length > 0 && o.picks > 0, perks.length > 0].filter(Boolean).length > 1 && (
        <div className={styles.actions}><button type="button" onClick={() => onSkip()} disabled={busy}>Skip everything</button></div>
      )}
    </div>
  );
}

// ── Rest Day ─────────────────────────────────────────────────────────────────

/**
 * THE DECK AS PRACTICE SEES IT: one tile a card, how many copies and how many
 * already practiced, whether it has a "+" at all, and which face to show —
 * the "+" face when `showPlus` is on and there is one (the user, 2026-10-19:
 * "a checkbox that toggles the photos to show their 'practiced' versions").
 */
export function practiceTiles(run, showPlus) {
  const by = new Map();
  for (const [id, n] of Object.entries(run.deck ?? {})) {
    if (!(n > 0)) continue;
    const base = baseId(id);
    const t = by.get(base) ?? { id: base, count: 0, plusCount: 0 };
    t.count += n;
    if (isPlus(id)) t.plusCount += n;
    by.set(base, t);
  }
  return [...by.values()]
    .map(t => {
      const upgradeable = Boolean(PLUS[t.id]);
      return { ...t, upgradeable, canPractice: upgradeable && t.count > t.plusCount, faceId: showPlus && upgradeable ? plusId(t.id) : t.id };
    })
    .sort((a, b) => (getStrat(a.id)?.name ?? a.id).localeCompare(getStrat(b.id)?.name ?? b.id));
}

/** Rest everyone, or practice: upgrade one copy (the user, 2026-10-19: not "smith"). */
// `onViewMap`: a look at the map (the user, 2026-10-19). From a Rest Day stop
// it opens the map read-only and comes back here; the free Rest Day was taken
// from the map, so for it this is simply the way back (nothing is spent yet).
export function RestDay({ run, onRest, onPractice, onCut = null, busy = false, free = false, onViewMap = null }) {
  const [showPlus, setShowPlus] = useState(false);
  const { cards } = rosterCards(run);
  const tired = cards.filter(c => (run.fatigue?.[c.id] ?? 0) > 0);
  const tiles = practiceTiles(run, showPlus);
  const deckCount = Object.values(run.deck ?? {}).reduce((t, n) => t + n, 0);
  return (
    <div className={styles.screen}>
      <h2 className={styles.title}>{free ? 'A day off' : 'Rest Day'}</h2>
      <p className={styles.lede}>One of three: rest the whole team, practise one copy of a card into its "+", or cut one card from your deck for good.</p>
      {onViewMap && (
        <div className={styles.actions}>
          <button type="button" data-view-map="true" onClick={onViewMap} disabled={busy}>{free ? '← Back to the map' : '🗺 See the map and what comes next'}</button>
        </div>
      )}
      <section className={styles.restCard}>
        <h3 className={styles.h3}>Rest</h3>
        <p className={styles.muted}>{tired.length ? `${tired.map(c => `${c.name} (${run.fatigue[c.id]} min)`).join(', ')} come back fresh.` : 'Everyone is fresh already.'}</p>
        <div className={styles.actions}><button type="button" className={styles.primary} onClick={onRest} disabled={busy}>Rest</button></div>
      </section>
      <section className={styles.restCard}>
        <div className={styles.practiceHead}>
          <h3 className={styles.h3}>Practice or cut <span className={styles.muted}>upgrade one copy, or take one out for good (a deck keeps at least {MIN_DECK})</span></h3>
          <label className={styles.toggle}>
            <input type="checkbox" checked={showPlus} onChange={e => setShowPlus(e.target.checked)} />
            Show practiced versions
          </label>
        </div>
        <div className={styles.grid}>
          {tiles.map(t => {
            const s = getStrat(t.faceId);
            return (
              <div key={t.id} data-practice-tile={t.id} className={`${styles.tile} ${styles.stratTile} ${showPlus && !t.upgradeable ? styles.dim : ''}`} data-rarity={s?.rarity}>
                <ZoomImg strat={t.faceId} className={styles.face} src={getStratThumbPath(t.faceId)} onError={fallbackTo(getStratImagePath(t.faceId))} alt={s?.name} loading="lazy" />
                <div className={styles.tileName}>{s?.name}</div>
                <div className={styles.tileMeta}>
                  {[t.count > 1 ? `×${t.count}` : null, t.plusCount ? `${t.plusCount} practiced` : null, t.upgradeable ? null : 'no upgrade yet'].filter(Boolean).join(' · ') || ' '}
                </div>
                {t.canPractice && (
                  <button type="button" data-practice={t.id} className={styles.tileBtn} onClick={() => onPractice(t.id)} disabled={busy}>Practice</button>
                )}
                {onCut && (
                  <button type="button" data-cut={t.id} className={`${styles.tileBtn} ${styles.cutBtn}`} disabled={busy || deckCount <= MIN_DECK}
                    onClick={() => onCut(t.plusCount && t.plusCount === t.count ? plusId(t.id) : t.id)}
                    title={deckCount <= MIN_DECK ? `A deck keeps at least ${MIN_DECK} cards` : `Cut one ${t.count > t.plusCount ? 'plain ' : ''}copy for good`}>
                    Cut
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </section>
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
    <div className={`${styles.screen} ${styles.offerScreen} ${styles.endScreen}`}>
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
