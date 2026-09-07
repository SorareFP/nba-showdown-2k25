// THE MARKET SCREEN — every card another player has put up for sale.
//
// ── WHY THIS IS NOT A SHOP ──────────────────────────────────────────────────
//
// There used to be a shop that sold any card for a fixed price out of nowhere.
// It is gone, and the reason matters: it minted. Under the supply model a
// card's pull rate falls as copies enter the world, so conjuring copies from
// coins drives that number without anybody opening a pack. Everything here is a
// copy that already exists, listed by the player who owns it.
//
// So the two things this screen must never imply are "the game is selling you
// this" and "there is one of these available". Both are handled by showing the
// SELLER and the count of open listings rather than a price tag.
//
// ── THE SUGGESTED PRICE IS A SUGGESTION ─────────────────────────────────────
//
// `getMarketPrice` survives from the old shop, demoted. It is an anchor shown
// to a seller who has no idea what to ask — not a floor, not a ceiling, and not
// what anything actually costs. What a card costs is what the cheapest open
// listing says.
import { useState, useEffect, useMemo, useCallback } from 'react';
import { getCardByKey, cardKey } from '../game/cardSets.js';
import { getPlayerRarity, RARITY_CONFIG, getMarketPrice } from '../game/rarity.js';
import Holo from './HoloSheen.jsx';
import { holoRegionsFor } from '../cards/faceRegions.js';
import { getPlayerImageUrl } from '../game/cardImages.js';
import { loadListings } from '../firebase/market.js';
import { buyListing, delistCard } from '../firebase/serverWrites.js';
import styles from './Market.module.css';

const SORTS = {
  price: { label: 'Cheapest', cmp: (a, b) => a.price - b.price },
  priceDesc: { label: 'Priciest', cmp: (a, b) => b.price - a.price },
  rarity: {
    label: 'Rarest',
    cmp: (a, b) => (b.card?.salary ?? 0) - (a.card?.salary ?? 0),
  },
  name: { label: 'A–Z', cmp: (a, b) => (a.card?.name ?? '').localeCompare(b.card?.name ?? '') },
};

export default function Market({ uid, coins, onTraded }) {
  const [listings, setListings] = useState(null);
  const [busy, setBusy] = useState(null);
  const [toast, setToast] = useState(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('price');
  const [mineOnly, setMineOnly] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setListings(await loadListings({ limit: 200 }));
    } catch (e) {
      setToast(e.message);
      setListings([]);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Resolve each listing to its card once. A listing whose card no longer
  // exists — a player who left the pool between seasons — is dropped rather
  // than rendered as a blank row.
  const rows = useMemo(() => {
    if (!listings) return null;
    return listings
      .map(l => ({ ...l, card: getCardByKey(l.cardKey) }))
      .filter(l => l.card);
  }, [listings]);

  const shown = useMemo(() => {
    if (!rows) return null;
    let list = rows;
    if (mineOnly) list = list.filter(l => l.seller === uid);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(l => l.card.name.toLowerCase().includes(s) || String(l.card.team ?? '').toLowerCase().includes(s));
    }
    return [...list].sort(SORTS[sort].cmp);
  }, [rows, mineOnly, search, sort, uid]);

  /** How many copies of this card are for sale, for the "1 of N" line. */
  const openFor = useMemo(() => {
    const n = {};
    for (const l of rows ?? []) n[l.cardKey] = (n[l.cardKey] ?? 0) + 1;
    return n;
  }, [rows]);

  const handleBuy = async listing => {
    if (busy) return;
    setBusy(listing.id);
    try {
      await buyListing(uid, listing.id);
      setToast(`Bought ${listing.card.name} for ${listing.price}`);
      onTraded?.();
    } catch (e) {
      // Every failure here is a real one a player can act on — sold out from
      // under them, their own listing, not enough coins — so none is swallowed.
      setToast(e.message);
    }
    setBusy(null);
    refresh();
  };

  const handleDelist = async listing => {
    if (busy) return;
    setBusy(listing.id);
    try {
      await delistCard(uid, listing.id);
      setToast(`${listing.card.name} taken off the market`);
      onTraded?.();
    } catch (e) {
      setToast(e.message);
    }
    setBusy(null);
    refresh();
  };

  const mineCount = (rows ?? []).filter(l => l.seller === uid).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div>
          <h3 className={styles.title}>Market</h3>
          <div className={styles.sub}>
            Cards listed by other players. Nothing here is minted — every copy already exists.
          </div>
        </div>
        <div className={styles.coins}>{coins?.toLocaleString?.() ?? coins} coins</div>
      </div>

      <div className={styles.filters}>
        <input
          className={styles.search}
          placeholder="Search a player or team…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className={styles.select} value={sort} onChange={e => setSort(e.target.value)}>
          {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button
          className={`${styles.toggle} ${mineOnly ? styles.toggleOn : ''}`}
          onClick={() => setMineOnly(v => !v)}
        >
          My listings{mineCount ? ` (${mineCount})` : ''}
        </button>
      </div>

      {toast && <div className={styles.toast} onClick={() => setToast(null)}>{toast}</div>}

      {shown === null && <div className={styles.empty}>Loading…</div>}
      {shown?.length === 0 && (
        <div className={styles.empty}>
          {mineOnly
            ? 'You have nothing listed. Sell a spare from My Collection.'
            : 'Nothing for sale yet. List a spare and you will be the first.'}
        </div>
      )}

      <div className={styles.grid}>
        {(shown ?? []).map(l => {
          const rarity = getPlayerRarity(l.card);
          const cfg = RARITY_CONFIG[rarity];
          const mine = l.seller === uid;
          const anchor = getMarketPrice(l.card);
          const open = openFor[l.cardKey] ?? 1;
          return (
            <div key={l.id} className={styles.card} style={{ borderColor: cfg.color }}>
              <Holo className={styles.art} active={holoRegionsFor(l.card).length > 0} regions={holoRegionsFor(l.card)} idle={false}>
                <img
                  src={getPlayerImageUrl(cardKey(l.card))}
                  alt=""
                  className={styles.artImg}
                  loading="lazy"
                  onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
                />
                <div className={styles.rarity} style={{ background: cfg.bg, color: cfg.color }}>
                  {cfg.label}
                </div>
              </Holo>
              <div className={styles.name}>{l.card.name}</div>
              <div className={styles.meta}>
                {l.card.team} · ${l.card.salary}
                {open > 1 && <span className={styles.open}> · {open} listed</span>}
              </div>
              <div className={styles.price}>
                {l.price.toLocaleString()} <span className={styles.priceUnit}>coins</span>
              </div>
              {/* The anchor, shown only when it disagrees enough to be worth
                  knowing. A suggestion repeated next to every price stops being
                  information and becomes furniture. */}
              {anchor && Math.abs(anchor - l.price) / anchor > 0.15 && (
                <div className={styles.anchor}>
                  typical {anchor.toLocaleString()}
                </div>
              )}
              {mine ? (
                <button
                  className={styles.delist}
                  disabled={busy === l.id}
                  onClick={() => handleDelist(l)}
                >
                  {busy === l.id ? '…' : 'Take down'}
                </button>
              ) : (
                <button
                  className={styles.buy}
                  disabled={busy === l.id || coins < l.price}
                  onClick={() => handleBuy(l)}
                  title={coins < l.price ? 'Not enough coins' : undefined}
                >
                  {busy === l.id ? '…' : coins < l.price ? 'Too expensive' : 'Buy'}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
