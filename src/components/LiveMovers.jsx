// THE LIVE SERIES VIEW (Collection → Live Series, 2026-10-28). The user: "a
// live series dashboard that shows how players' card details have changed
// over time … 'latest changes,' 7-21 day windows, since start of season.
// Denote what players are in the user's collection", then "a leaderboard-style
// table of all players and their details". Settled on mockups the same day:
// the player (a COLLECTED badge on yours), the salary night by night, salary
// then → now, rarity, the six numbers each with its move underneath, and the
// chart then → now as the last column ("I like A. The charts column can be the
// right-most detail, after defensive bonuses"), the width going to the player,
// the salary line and the rarity.
//
// The rows are liveMoves.js's; the nights are live-history.json, which the
// nightly job keeps (scripts/cardgen/liveHistory.js) and which is loaded only
// when this view opens.
import { useEffect, useMemo, useState } from 'react';
import { CARD_SETS } from '../game/cardSets.js';
import { LIVE_SET } from '../cards/liveSeries.js';
import { LIVE_WINDOWS, anchorIndex, moveRows, chartChanges, sortMoves, nextSort, filterMoves } from '../game/liveMoves.js';
import { RARITY_CONFIG } from '../game/rarity.js';
import { visibleTiers, formatRollRange } from '../cards/CardTemplate.jsx';
import { ownedKeysOf } from './PackOpening.jsx';
import { useLightbox } from './CardLightbox.jsx';
import { useRowCard, RowCardPop } from './RowCardPop.jsx';
import styles from './LiveMovers.module.css';

const LIVE_CARDS = CARD_SETS[LIVE_SET] ?? [];
/** Rows drawn before "Show all": each carries two small charts. */
const PAGE = 100;

const STAT_COLUMNS = [
  ['speed', 'Spd', 'Speed'], ['power', 'Pow', 'Power'], ['shotLine', 'Shot', 'Shot line'],
  ['paintBoost', 'Paint', 'Paint boost'], ['threePtBoost', '3PT', '3PT boost'], ['defBoost', 'Def', 'Defense'],
];
const SIGNED = new Set(['paintBoost', 'threePtBoost', 'defBoost']);
const shown = (k, v) => (SIGNED.has(k) && v > 0 ? `+${v}` : `${v}`);
/** A lower shot line is the better one. */
const better = (k, d) => (k === 'shotLine' ? d < 0 : d > 0);

const fmtNight = iso => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

function Move({ field, d, money = false }) {
  if (!d) return <span className={styles.move} data-move="none">·</span>;
  const dir = better(field, d) ? 'up' : 'down';
  return <span className={`${styles.move} ${styles[dir]}`} data-move={dir}>{`${d > 0 ? '▲' : '▼'}${money ? '$' : ''}${Math.abs(d)}`}</span>;
}

function SalaryLine({ values }) {
  const w = 100;
  const h = 40;
  if (values.length < 2) return <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2={w} y1={h / 2} y2={h / 2} className={styles.sparkFlat} vectorEffect="non-scaling-stroke" /></svg>;
  const lo = Math.min(...values);
  const span = (Math.max(...values) - lo) || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 4 - ((v - lo) / span) * (h - 8)).toFixed(1)}`).join(' ');
  const up = values.at(-1) >= values[0];
  return (
    <svg className={styles.spark} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} className={up ? styles.sparkUp : styles.sparkDown} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function RarityChip({ rarity }) {
  const cfg = RARITY_CONFIG[rarity] ?? RARITY_CONFIG.common;
  return <span className={styles.chip} style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>;
}

function MiniChart({ tiers, which, changes = null }) {
  return (
    <table className={`${styles.mini} ${which === 'then' ? styles.miniThen : ''}`} data-chart={which}>
      <thead><tr><th aria-label="Roll" /><th>P</th><th>R</th><th>A</th></tr></thead>
      <tbody>
        {tiers.map((t, i) => {
          const ch = changes?.[i];
          return (
            <tr key={i}>
              <td className={`${styles.range} ${ch?.moved ? styles.rangeMoved : ''}`}>{formatRollRange(t)}</td>
              {['pts', 'reb', 'ast'].map(k => (
                <td key={k} className={ch?.cells[k] ? styles[`cell_${ch.cells[k]}`] : undefined} data-cell={ch?.cells[k] ?? undefined}>{t[k]}</td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChartPair({ then, now }) {
  const thenTiers = visibleTiers(then, LIVE_SET);
  const nowTiers = visibleTiers(now, LIVE_SET);
  return (
    <>
      <MiniChart tiers={thenTiers} which="then" />
      <span className={styles.arrow} aria-hidden="true">→</span>
      <MiniChart tiers={nowTiers} which="now" changes={chartChanges(thenTiers, nowTiers)} />
    </>
  );
}

/** A sortable header: the player by name, the rest by their move. */
function SortHead({ col, label, title, sort, onSort, className = '' }) {
  const on = sort.key === col;
  const mark = !on ? '' : sort.dir === 'down' ? ' ▴' : ' ▾';
  return (
    <th className={className} aria-sort={on ? (sort.dir === 'down' ? 'ascending' : 'descending') : undefined}>
      <button type="button" className={styles.sortBtn} title={title} onClick={() => onSort(nextSort(sort, col))}>{label}{mark}</button>
    </th>
  );
}

export default function LiveMovers({ collection = {}, cards = LIVE_CARDS, history: given = undefined, initialOnlyMine = false }) {
  // undefined: still loading; null: there is none (or it failed to load).
  const [history, setHistory] = useState(given);
  useEffect(() => {
    if (given !== undefined) { setHistory(given); return undefined; }
    let on = true;
    import('../../card-data/generated/live-history.json')
      .then(m => { if (on) setHistory(m.default ?? m); })
      .catch(() => { if (on) setHistory(null); });
    return () => { on = false; };
  }, [given]);

  const [windowKey, setWindowKey] = useState('7');
  const [sort, setSort] = useState({ key: 'salary', dir: 'abs' });
  const [query, setQuery] = useState('');
  const [onlyMine, setOnlyMine] = useState(initialOnlyMine);
  const [showAll, setShowAll] = useState(false);
  const owned = useMemo(() => ownedKeysOf(collection), [collection]);
  const lb = useLightbox();
  const rowCard = useRowCard();

  const rows = useMemo(
    () => (history === undefined ? [] : sortMoves(filterMoves(moveRows(history, cards, windowKey), { query, onlyMine, owned }), sort)),
    [history, cards, windowKey, query, onlyMine, owned, sort],
  );
  const nights = history?.nights ?? [];
  const since = nights.length ? nights[anchorIndex(nights, windowKey)] : null;
  const drawn = showAll ? rows : rows.slice(0, PAGE);
  const openCard = card => { rowCard.leave(); lb?.open?.('player', card); };

  return (
    <div className={styles.wrap}>
      <div className={styles.bar}>
        <div className={styles.windows} role="group" aria-label="Compare with">
          {LIVE_WINDOWS.map(w => (
            <button key={w.key} type="button" className={`${styles.win} ${w.key === windowKey ? styles.winOn : ''}`}
              aria-pressed={w.key === windowKey} onClick={() => setWindowKey(w.key)}>{w.label}</button>
          ))}
        </div>
        <div className={styles.asOf}>
          {since && nights.length > 1 && <>Compared with {fmtNight(since)} · </>}
          {nights.length > 0 && <>as of {fmtNight(nights.at(-1))} · </>}
          {history !== undefined && <>{rows.length} {rows.length === 1 ? 'player' : 'players'}</>}
        </div>
        <div className={styles.tools}>
          <label className={styles.mine}>
            <input type="checkbox" checked={onlyMine} onChange={e => setOnlyMine(e.target.checked)} /> Only my cards
          </label>
          <input className={styles.search} type="search" placeholder="Search a player or team" value={query} onChange={e => setQuery(e.target.value)} />
        </div>
      </div>

      {history === undefined ? (
        <p className={styles.note}>Loading the nights…</p>
      ) : rows.length === 0 ? (
        <p className={styles.note}>{onlyMine && !query ? 'You have no Live cards yet. They come in boosters and the Live Series Pack.' : 'No player matches that.'}</p>
      ) : (
        <div className={styles.scroller}>
          <table className={styles.table}>
            <thead>
              <tr>
                <SortHead col="name" label="Player" sort={sort} onSort={setSort} className={styles.colPlayer} />
                <th className={styles.colLine}>Salary, night by night</th>
                <SortHead col="salary" label="Salary" title="Sort by the salary move" sort={sort} onSort={setSort} className={`${styles.colSalary} ${styles.num}`} />
                <SortHead col="rarity" label="Rarity" sort={sort} onSort={setSort} className={styles.colRarity} />
                {STAT_COLUMNS.map(([k, label, title]) => (
                  <SortHead key={k} col={k} label={label} title={`Sort by the ${title} move`} sort={sort} onSort={setSort} className={`${styles.colStat} ${styles.num}`} />
                ))}
                <th className={styles.colCharts}>Chart, then → now</th>
              </tr>
            </thead>
            <tbody>
              {drawn.map(r => {
                const mine = owned.has(r.key);
                const moved = r.then.salary !== r.now.salary;
                return (
                  <tr key={r.id} data-live-row={r.id} data-collected={mine || undefined}>
                    <td className={styles.player}>
                      <button type="button" className={styles.name}
                        onMouseEnter={e => rowCard.enter(r.card, e)} onMouseLeave={rowCard.leave} onClick={() => openCard(r.card)}>
                        {r.card.name}
                      </button>
                      {mine && <span className={styles.collected}>COLLECTED</span>}
                      <div className={styles.meta}>{r.card.team} · {r.card.pos} · {r.now.games} {r.now.games === 1 ? 'game' : 'games'}</div>
                    </td>
                    <td className={styles.lineCell}><SalaryLine values={r.line} /></td>
                    <td className={styles.num}>
                      {moved && <div className={styles.then}>${r.then.salary} →</div>}
                      <b className={styles.big}>${r.now.salary}</b>
                      <Move field="salary" d={r.delta.salary} money />
                    </td>
                    <td className={styles.rarity}>
                      {r.rarityThen !== r.rarityNow && <><RarityChip rarity={r.rarityThen} /><span className={styles.arrow} aria-hidden="true">→</span></>}
                      <RarityChip rarity={r.rarityNow} />
                    </td>
                    {STAT_COLUMNS.map(([k]) => (
                      <td key={k} className={styles.num}>
                        <b className={styles.big}>{shown(k, r.now[k])}</b>
                        <Move field={k} d={r.delta[k]} />
                      </td>
                    ))}
                    <td className={styles.charts}><ChartPair then={r.then.chart} now={r.now.chart} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!showAll && rows.length > PAGE && (
            <button type="button" className={styles.more} onClick={() => setShowAll(true)}>Show all {rows.length}</button>
          )}
        </div>
      )}
      <p className={styles.legend}>
        In today&apos;s chart a green number pays more on that roll than it did, a red one less; a blue roll range is a row that moved. Hover a name to see the card, click it to open it.
      </p>
      {rowCard.hover && <RowCardPop player={rowCard.hover.p} rect={rowCard.hover.rect} side="right" />}
    </div>
  );
}
