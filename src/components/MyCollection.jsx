// MY COLLECTION — everything the player owns, across every set.
//
// ── WHY THIS LISTS ALL SETS ─────────────────────────────────────────────────
//
// It used to build its list from CARDS, the base set alone, which meant a WNBA
// card, a Super Season card or a just-claimed team reward was owned, counted by
// the tracker, playable in a deck — and invisible here. Anything ownable has to
// be listed, so the list comes from ALL_CARDS keyed by cardKey, the same key
// the collection itself is stored under.
//
// ── PROTECTION IS DERIVED, NOT TOGGLED ──────────────────────────────────────
//
// There used to be a padlock button here. The user's rule replaced it: "the
// lock from burning should be a mechanism that happens automatically by
// collecting a card... if you have 10 copies of a card, and you collected one,
// you can burn the other 9."
//
// Since 2026-09-05 the collecting is the player's act — "they should have to
// go into the collections tab and hit collect" — so nothing locks itself at
// the pack any more. A card is COLLECTED once its owner presses Collect here
// (or in a goal's roster); that copy is protected and counts toward goals, and
// every other copy is a spare that can be burned or sold. An uncollected card
// is all spares. Team rewards are minted as EARNED copies: collected from the
// start and never burnable at any count. The guarantee itself lives in
// burnCard and collectCard on the server, because a hidden button is a
// suggestion and not a rule.
import { useState, useMemo } from 'react';
import { ALL_CARDS, cardKey, BASE_SET } from '../game/cardSets.js';
import { STRATS } from '../game/strats.js';
import {
  getPlayerRarity, getStratRarity, RARITY_CONFIG, RARITY_ORDER,
  BURN_VALUES, STRAT_BURN_VALUES, getMarketPrice,
} from '../game/rarity.js';
import { ALL_CARDS as CARDS_FOR_PRICE } from '../game/cardSets.js';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import Holo from './HoloSheen.jsx';
import styles from './MyCollection.module.css';

const RARITIES = ['all', ...RARITY_ORDER];
const TYPES = ['all', 'player', 'strat'];

/** Set id -> the label shown in the filter, in ladder order. */
const SET_LABELS = {
  [BASE_SET]: '2026-27 Base',
  'super-season': 'Super Season',
  rookie: 'Rookie',
  'summer-standouts': 'Summer Standouts',
  dissonance: 'Dissonance',
  'team-rewards': 'Team Rewards',
  wnba: 'WNBA',
  'wnba-super-season': 'WNBA Super Season',
  'wnba-rookie': 'WNBA Rookie',
  'wnba-team-rewards': 'WNBA Team Rewards',
};

export default function MyCollection({ collection, onBurn, onList, onCollect }) {
  const [typeFilter, setTypeFilter] = useState('all');
  const [rarityFilter, setRarityFilter] = useState('all');
  const [setFilter, setSetFilter] = useState('ALL');
  const [teamFilter, setTeamFilter] = useState('ALL');
  const [search, setSearch] = useState('');
  const [confirmBurn, setConfirmBurn] = useState(null);
  // Which card is being priced, and at what. Selling needs a NUMBER from the
  // player, so unlike burning it cannot be a two-tap confirm.
  const [selling, setSelling] = useState(null);
  const [askPrice, setAskPrice] = useState('');

  const allCards = useMemo(() => {
    const players = ALL_CARDS.map(c => ({
      key: cardKey(c),
      name: c.name,
      type: 'player',
      set: c.set,
      team: c.team,
      rarity: getPlayerRarity(c),
      salary: c.salary,
      // The old fixed-price shop's number, demoted to an anchor a seller can
      // start from. Null means the set is not tradable at all.
      suggested: getMarketPrice(c),
      sub: `${c.team} · S${c.speed} P${c.power} · $${c.salary}`,
      imgUrl: getPlayerImageUrl(cardKey(c)),
    }));
    const strats = STRATS.map(s => ({
      key: s.id,
      name: s.name,
      type: 'strat',
      set: 'strats',
      team: null,
      rarity: getStratRarity(s),
      salary: null,
      // Strategy cards are a fixed 51-card deck nobody is chasing; there is no
      // market for them and offering one would be noise.
      suggested: null,
      sub: `${s.phase} · ${s.side}`,
      imgUrl: getStratImagePath(s.id),
    }));
    return [...players, ...strats];
  }, []);

  // Only the teams and sets the player actually owns something from — a filter
  // full of options that all return nothing is worse than no filter.
  const { teams, sets } = useMemo(() => {
    const owned = allCards.filter(c => (collection[c.key]?.count ?? 0) > 0);
    return {
      teams: ['ALL', ...new Set(owned.map(c => c.team).filter(Boolean))].sort(),
      sets: ['ALL', ...Object.keys(SET_LABELS).filter(id => owned.some(c => c.set === id))],
    };
  }, [allCards, collection]);

  const filtered = useMemo(() => {
    let list = allCards.filter(c => (collection[c.key]?.count ?? 0) > 0);
    if (typeFilter !== 'all') list = list.filter(c => c.type === typeFilter);
    if (rarityFilter !== 'all') list = list.filter(c => c.rarity === rarityFilter);
    if (setFilter !== 'ALL') list = list.filter(c => c.set === setFilter);
    if (teamFilter !== 'ALL') list = list.filter(c => c.team === teamFilter);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(c => c.name.toLowerCase().includes(s));
    }
    const rank = r => RARITY_ORDER.length - RARITY_ORDER.indexOf(r);
    return [...list].sort((a, b) =>
      (a.type === b.type ? 0 : a.type === 'player' ? -1 : 1) ||
      rank(a.rarity) - rank(b.rarity) ||
      a.name.localeCompare(b.name)
    );
  }, [allCards, typeFilter, rarityFilter, setFilter, teamFilter, search, collection]);

  const totalOwned = useMemo(
    () => Object.values(collection).reduce((n, e) => n + (e?.count ?? 0), 0),
    [collection]
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.statsBar}>
        <span>{filtered.length} shown · {totalOwned} cards owned</span>
      </div>

      <div className={styles.filters}>
        <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)} className={styles.filter}>
          {TYPES.map(t => (
            <option key={t} value={t}>
              {t === 'all' ? 'All Types' : t === 'player' ? 'Players' : 'Strats'}
            </option>
          ))}
        </select>
        <select value={rarityFilter} onChange={e => setRarityFilter(e.target.value)} className={styles.filter}>
          {RARITIES.map(r => (
            <option key={r} value={r}>{r === 'all' ? 'All Rarities' : RARITY_CONFIG[r]?.label ?? r}</option>
          ))}
        </select>
        <select value={setFilter} onChange={e => setSetFilter(e.target.value)} className={styles.filter}>
          {sets.map(id => <option key={id} value={id}>{id === 'ALL' ? 'All Sets' : SET_LABELS[id]}</option>)}
        </select>
        <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)} className={styles.filter}>
          {teams.map(t => <option key={t} value={t}>{t === 'ALL' ? 'All Teams' : t}</option>)}
        </select>
        <input
          className={styles.search}
          placeholder="Search..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      <div className={styles.grid}>
        {filtered.map(c => {
          const entry = collection[c.key] ?? {};
          const owned = entry.count ?? 0;
          // The collected copy is the protected one; everything else is a spare.
          // An uncollected card is ALL spares — and offers Collect.
          const collected = entry.collected === true || entry.earned === true;
          const spares = Math.max(0, owned - (collected ? 1 : 0));
          const canCollect = Boolean(onCollect) && c.type === 'player' && owned > 0 && !collected;
          const cfg = RARITY_CONFIG[c.rarity];
          const burnVal = c.type === 'strat'
            ? (STRAT_BURN_VALUES[c.rarity] ?? 1)
            : (BURN_VALUES[c.rarity] ?? 0);
          return (
            <div key={c.key} className={styles.card} style={{ borderColor: cfg.color }}>
              <Holo className={styles.cardArt} active={c.rarity === 'legendary'}>
                <img
                  src={c.imgUrl}
                  alt={c.name}
                  className={styles.cardArtImg}
                  loading="lazy"
                  onError={e => { e.currentTarget.parentElement.style.display = 'none'; }}
                />
              </Holo>
              <div className={styles.rarityBadge} style={{ background: cfg.bg, color: cfg.color }}>
                {cfg.label}
              </div>
              <div className={styles.cardName}>{c.name}</div>
              <div className={styles.cardSub}>{c.sub}</div>
              {c.set !== BASE_SET && c.type === 'player' && (
                <div className={styles.setTag}>{SET_LABELS[c.set] ?? c.set}</div>
              )}
              <div className={styles.countBadge}>x{owned}</div>


              {entry.earned && <div className={styles.earnedTag}>Earned</div>}

              {canCollect && (
                <button
                  className={styles.collectBtn}
                  title="Put one copy in your collection — it then counts toward your goals and can no longer be sold or burned"
                  onClick={() => onCollect(c.key)}
                >
                  Collect
                </button>
              )}

              {spares === 0 ? (
                <div className={styles.lockedNote}>
                  {entry.earned ? 'Reward' : 'Collected'}
                </div>
              ) : confirmBurn === c.key ? (
                <div className={styles.burnConfirm}>
                  <span className={styles.burnAmt}>+{burnVal} coins?</span>
                  <button
                    className={styles.burnYes}
                    onClick={() => { onBurn(c.key, burnVal); setConfirmBurn(null); }}
                  >Yes</button>
                  <button className={styles.burnNo} onClick={() => setConfirmBurn(null)}>No</button>
                </div>
              ) : selling === c.key ? (
                <div className={styles.sellRow}>
                  <input
                    className={styles.sellInput}
                    type="number"
                    min="1"
                    autoFocus
                    value={askPrice}
                    placeholder={String(c.suggested ?? '')}
                    onChange={e => setAskPrice(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') setSelling(null);
                      if (e.key === 'Enter') {
                        const p = Number(askPrice || c.suggested);
                        if (Number.isInteger(p) && p > 0) {
                          onList?.(c.key, p);
                          setSelling(null);
                        }
                      }
                    }}
                  />
                  <button
                    className={styles.sellYes}
                    onClick={() => {
                      const p = Number(askPrice || c.suggested);
                      if (!Number.isInteger(p) || p <= 0) return;
                      onList?.(c.key, p);
                      setSelling(null);
                    }}
                  >List</button>
                  <button className={styles.burnNo} onClick={() => setSelling(null)}>✕</button>
                </div>
              ) : (
                <div className={styles.spareActions}>
                  <button className={styles.burnBtn} onClick={() => setConfirmBurn(c.key)}>
                    Burn (+{burnVal})
                  </button>
                  {/* Selling needs somewhere for the copy to GO, which a strat
                      deck and an un-tradable set do not have. */}
                  {onList && c.suggested && (
                    <button
                      className={styles.sellBtn}
                      onClick={() => { setSelling(c.key); setAskPrice(String(c.suggested)); }}
                    >
                      Sell
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <div className={styles.empty}>No cards match your filters.</div>
      )}
    </div>
  );
}
