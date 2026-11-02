// THE TRADE SCREEN (2026-11-02) — docs/plans/2026-11-02-friend-trades-design.md.
// A friend's spares and yours, a slip of up to five cards a side, and the rule's
// meter beside them. The user: "Start with cards from his collection." This is
// the only place a friend's spares show: "They should sees spares when looking
// at what cards they can trade for."
import { useEffect, useMemo, useRef, useState } from 'react';
import { friendSpares, sendTrade } from '../firebase/friends.js';
import { canonicalKey, getCardByKey } from '../game/cardSets.js';
import { getPlayerImageUrl, getPlayerThumbUrl, fallbackTo } from '../game/cardImages.js';
import { getPlayerRarity, notionalPrice, RARITY_CONFIG } from '../game/rarity.js';
import { pickTradeCard, tradeProblem, tradeValue, TRADE_MAX_CARDS, TRADE_MIN_SHARE } from '../game/marketRules.js';
import { DEFAULT_FILTERS, filterPool, sortPool } from '../game/teamRules.js';
import { useDialogs } from '../ui/dialogs.jsx';
import { useFillHeight } from '../ui/useFillHeight.js';
import { ZoomImg } from './CardLightbox.jsx';
import PoolFilters from './PoolFilters.jsx';
import s from './TradeScreen.module.css';

const NOBODY_NEEDS = new Set();
const fmt = n => n.toLocaleString('en-US');

/** Spares as rows, filtered and sorted, with the cards somebody needs first. Strategy cards have no row. */
export function spareRows(spares, needKeys, filters) {
  const held = spares.flatMap(({ cardKey: key, count }) => {
    const card = getCardByKey(key);
    return card ? [{ ...card, tradeKey: key, spares: count }] : [];
  });
  const rows = sortPool(filterPool(held, filters), filters.sort)
    .map(card => ({ card, key: card.tradeKey, count: card.spares, need: needKeys.has(canonicalKey(card.tradeKey)) }));
  return [...rows.filter(r => r.need), ...rows.filter(r => !r.need)];
}

/** The cards of a list its owner still has spares of: an offer's cards can have gone since it was sent. */
export function stillHeld(keys, spares) {
  const left = new Map(spares.map(x => [x.cardKey, x.count]));
  return keys.filter(key => {
    const n = left.get(key) ?? 0;
    left.set(key, n - 1);
    return n > 0;
  });
}

/** What the slip says under the meter. The share rounds down, so a refused offer never reads as 60%. */
export function tradeVerdict(give, get, friendName) {
  if (!give.length && !get.length) return { tone: 'idle', text: `Pick from ${friendName}'s spares, then from yours.` };
  if (!give.length) return { tone: 'idle', text: 'Now pick from your spares.' };
  if (!get.length) return { tone: 'idle', text: `Now pick from ${friendName}'s spares.` };
  const [a, b] = [tradeValue(give), tradeValue(get)];
  const share = Math.floor((Math.min(a, b) * 100) / Math.max(a, b));
  const problem = tradeProblem(give, get);
  if (!problem) return { tone: 'ok', text: `${share}%: a fair trade.` };
  const line = Math.round(TRADE_MIN_SHARE * 100);
  return { tone: 'no', text: share < line ? `${share}%: too uneven. The lower side needs ${line}%.` : problem };
}

function CardArt({ cardKey: key, className }) {
  return (
    <ZoomImg
      player={key}
      className={className}
      src={getPlayerThumbUrl(key)}
      onError={fallbackTo(getPlayerImageUrl(key))}
      alt={getCardByKey(key)?.name ?? key}
      loading="lazy"
    />
  );
}

function Tile({ row, list, mark, onPick }) {
  const { card, key, count, need } = row;
  const held = list.filter(k => k === key).length;
  const rarity = getPlayerRarity(card);
  const canAdd = held < count && list.length < TRADE_MAX_CARDS;
  const action = canAdd ? (held ? 'Add another' : 'Add') : held ? 'Take out' : 'Full';
  return (
    <div className={s.tile} data-trade-card={key} data-on={held > 0 || undefined}>
      {count > 1 && <span className={s.count}>×{count}</span>}
      <CardArt cardKey={key} className={s.art} />
      <div className={s.tileName} title={card.name}>{card.name}</div>
      <div className={s.tileValue} style={{ color: RARITY_CONFIG[rarity]?.color }}>{RARITY_CONFIG[rarity]?.label} · {fmt(notionalPrice(card) ?? 0)}</div>
      {need && <span className={s.need}>{mark}</span>}
      <button className={s.pick} disabled={!canAdd && !held} onClick={() => onPick(key, count)}>{action}</button>
    </div>
  );
}

function Slots({ title, side, keys, onTake }) {
  return (
    <div className={s.slotGroup}>
      <h2 className={s.slotTitle}>{title} <span>{keys.length} of {TRADE_MAX_CARDS}</span></h2>
      <div className={s.slots}>
        {Array.from({ length: TRADE_MAX_CARDS }, (_, i) => (keys[i] ? (
          <div key={i} className={s.slot} data-slot={side} data-key={keys[i]}>
            <CardArt cardKey={keys[i]} className={s.slotArt} />
            <button className={s.take} aria-label={`Take out ${getCardByKey(keys[i])?.name ?? 'this card'}`} onClick={() => onTake(i)}>×</button>
          </div>
        ) : <div key={i} className={s.emptySlot} />))}
      </div>
    </div>
  );
}

function Meter({ label, value, top }) {
  return (
    <div className={s.meter}>
      <div className={s.meterLine}><span>{label}</span><b>{fmt(value)}</b></div>
      <div className={s.track}><div className={s.fill} style={{ width: `${top ? (value / top) * 100 : 0}%` }} /></div>
    </div>
  );
}

/** The screen once the spares are in. `onSend(give, get)` sends; `sending` holds the button. */
export function TradeBoard({ friend, spares, needKeys = NOBODY_NEEDS, counter = null, sending = false, onClose, onSend }) {
  const [tab, setTab] = useState('theirs');
  const [get, setGet] = useState(() => stillHeld(counter?.get ?? [], spares.theirs));
  const [give, setGive] = useState(() => stillHeld(counter?.give ?? [], spares.mine));
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const gridRef = useRef(null);
  useFillHeight(gridRef, { min: 420 });

  const theirNeeds = useMemo(() => new Set((friend.needs ?? []).map(n => canonicalKey(n.cardKey))), [friend.needs]);
  const onTheirs = tab === 'theirs';
  const source = onTheirs ? spares.theirs : spares.mine;
  const rows = useMemo(() => spareRows(source, onTheirs ? needKeys : theirNeeds, filters), [source, onTheirs, needKeys, theirNeeds, filters]);
  const teams = useMemo(() => [...new Set(spareRows(source, NOBODY_NEEDS, DEFAULT_FILTERS).map(r => r.card.team))].sort(), [source]);

  const list = onTheirs ? get : give;
  const setList = onTheirs ? setGet : setGive;
  const takeAt = (setter, at) => setter(old => old.filter((_, i) => i !== at));

  const verdict = tradeVerdict(give, get, friend.name);
  const [getValue, giveValue] = [tradeValue(get), tradeValue(give)];
  const top = Math.max(getValue, giveValue);
  const opensOn = spares.opensAt ? new Date(spares.opensAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : null;
  const empty = source.length === 0
    ? (onTheirs ? `${friend.name} has no spare cards right now.` : 'You have no spare cards to offer right now.')
    : 'No spare matches those filters.';

  return (
    <div className={s.page}>
      <div className={s.bar}>
        <button className={s.back} onClick={onClose}>← Friends</button>
        <h1 className={s.heading}>Trade with {friend.name}</h1>
      </div>
      <div className={s.layout}>
        <main className={s.browse}>
          <div className={s.tabs}>
            <button className={s.tab} data-on={onTheirs || undefined} onClick={() => setTab('theirs')}>{friend.name}'s spares</button>
            <button className={s.tab} data-on={!onTheirs || undefined} onClick={() => setTab('mine')}>Your spares</button>
          </div>
          <PoolFilters value={filters} onChange={setFilters} teams={teams} />
          <div className={s.grid} ref={gridRef}>
            {rows.length === 0 && <p className={s.empty}>{empty}</p>}
            {rows.map(row => (
              <Tile
                key={row.key}
                row={row}
                list={list}
                mark={onTheirs ? 'YOU NEED' : 'THEY NEED'}
                onPick={(key, count) => setList(old => pickTradeCard(old, key, count))}
              />
            ))}
          </div>
        </main>
        <aside className={s.slip}>
          {counter && <div className={s.banner}>Countering {friend.name}'s offer. Change anything, then send it back.</div>}
          <Slots title="You get" side="get" keys={get} onTake={at => takeAt(setGet, at)} />
          <Slots title="You give" side="give" keys={give} onTake={at => takeAt(setGive, at)} />
          <Meter label="You get" value={getValue} top={top} />
          <Meter label="You give" value={giveValue} top={top} />
          {opensOn
            ? <p className={s.verdict} data-tone="idle">You and {friend.name} can trade from {opensOn}. Friends trade after their first week.</p>
            : <p className={s.verdict} data-tone={verdict.tone}>{verdict.text}</p>}
          <button className={s.send} data-send disabled={verdict.tone !== 'ok' || Boolean(opensOn) || sending} onClick={() => onSend(give, get)}>
            {counter ? 'Send counter' : 'Send offer'}
          </button>
        </aside>
      </div>
    </div>
  );
}

/**
 * Loads both players' spares, then the board. `counter`, when answering an
 * offer, is that offer from this player's side: `{ id, give, get }`.
 */
export default function TradeScreen({ friend, needKeys, counter = null, onClose, onSent, load = friendSpares, send = sendTrade }) {
  const { toast } = useDialogs();
  const [spares, setSpares] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let live = true;
    window.scrollTo?.({ top: 0 });
    load({ friendUid: friend.uid }).then(
      r => { if (live) setSpares(r); },
      e => { if (live) setError(e?.message ?? String(e)); },
    );
    return () => { live = false; };
  }, [friend.uid, load]);

  const submit = async (give, get) => {
    setSending(true);
    try {
      await send({ friendUid: friend.uid, give, get, ...(counter ? { counterOf: counter.id } : {}) });
      toast(counter ? 'Counter sent' : 'Offer sent', { tone: 'success' });
      onSent?.();
    } catch (e) {
      toast(e?.message ?? String(e), { tone: 'error' });
      setSending(false);
    }
  };

  if (!spares) {
    return (
      <div className={s.page}>
        <div className={s.bar}><button className={s.back} onClick={onClose}>← Friends</button></div>
        <p className={s.empty}>{error ?? 'Loading the spares…'}</p>
      </div>
    );
  }
  return <TradeBoard friend={friend} spares={spares} needKeys={needKeys} counter={counter} sending={sending} onClose={onClose} onSend={submit} />;
}
