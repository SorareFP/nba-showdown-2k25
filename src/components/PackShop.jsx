// THE PACK SHOP — every pack the engine can open, which it did not used to be.
//
// ── WHY THIS WAS REBUILT ────────────────────────────────────────────────────
//
// The shop listed ten packs. The engine defines eighteen. Team packs, the
// Legendary Chase and every set-scoped pack (WNBA, Super Season, Rookie, Summer
// Standouts) existed, were priced, were tested — and had no button. The team
// pack in particular is the answer to "collections take too many boosters", so
// shipping the fix without a way to buy it left the problem in place.
//
// SHOP_PACKS is now DERIVED from PACK_TYPES rather than hand-listed, with the
// grouping and copy as the only hand-written part. A pack added to the engine
// and not to a group shows up in "More" instead of vanishing, so the two can
// not silently drift apart again.
import { useMemo, useState } from 'react';
import { PACK_TYPES, CONFERENCES, DIVISIONS } from '../game/packEngine.js';
import { TEAM_CODES } from '../game/collections.js';
import { getTeam } from '../cards/teams.js';
import { useDialogs } from '../ui/dialogs.jsx';
import styles from './PackShop.module.css';

/** Hand-written copy, keyed by pack id. Grouping is the editorial part.
 *  Exported so a test can assert it covers every pack the engine defines. */
export const PACK_COPY = {
  booster:        { group: 'Standard', desc: '5 NBA & WNBA players + 2 strats' },
  deluxe:         { group: 'Standard', desc: '5 NBA & WNBA players + 2 strats · 1 rare or better' },
  super:          { group: 'Standard', desc: '5 NBA & WNBA players + 2 strats · 1 rare+ PLAYER' },

  division:       { group: 'Targeted', desc: '5 players from one division', pick: 'division' },
  conference:     { group: 'Targeted', desc: '5 players from one conference', pick: 'conference' },
  conf_super:     { group: 'Targeted', desc: '5 conference players · 1 rare+ player', pick: 'conference' },
  team_pack:      { group: 'Targeted', desc: '5 players from ONE roster — the fast way to finish a collection', pick: 'team' },
  nba_booster:    { group: 'Targeted', desc: '5 NBA players only + 2 strats' },
  nba_super:      { group: 'Targeted', desc: '5 NBA players only · 1 rare+ player' },
  wnba_booster:   { group: 'Targeted', desc: '5 WNBA players only + 2 strats' },
  wnba_super:     { group: 'Targeted', desc: '5 WNBA players only · 1 rare+ player' },

  rare_deluxe:    { group: 'Premium', desc: '3 players, every one rare or better' },
  super_deluxe:   { group: 'Premium', desc: '3 players · 1 guaranteed super rare' },
  mega_deluxe:    { group: 'Premium', desc: '3 super rares + 1 rare strat' },
  legendary_chase:{ group: 'Premium', desc: 'The only pack that guarantees a LEGENDARY' },
  booster_box:    { group: 'Premium', desc: '36 boosters at a discount, plus a bonus Super Booster' },

  super_season:   { group: 'Other Sets', desc: '3 Super Season players' },
  rookie_pack:    { group: 'Other Sets', desc: '5 Rookie cards + 2 strats' },
  standouts:      { group: 'Other Sets', desc: '3 Summer Standouts' },
};

export const GROUPS = [
  { key: 'Standard', blurb: 'The everyday packs.' },
  { key: 'Targeted', blurb: 'Narrow the pool. The premium buys better odds on the cards you actually need.' },
  { key: 'Premium', blurb: 'Expensive, and the only route to the top bands.' },
  { key: 'Other Sets', blurb: 'Pools outside the 2026-27 base set.' },
  { key: 'More', blurb: 'Not yet grouped.' },
];

/** Every buyable pack, grouped. `once: true` packs are excluded — the starter
 *  pack is granted, not sold, and listing it would offer a purchase that the
 *  shop cannot honour a second time. */
export function shopPacks() {
  return Object.entries(PACK_TYPES)
    .filter(([, def]) => !def.once)
    .map(([key, def]) => ({ key, def, ...(PACK_COPY[key] ?? { group: 'More', desc: '' }) }));
}

export default function PackShop({ currency, onBuyPack }) {
  const [conf, setConf] = useState('East');
  const [div, setDiv] = useState('Atlantic');
  const [team, setTeam] = useState(TEAM_CODES[0]);

  const packs = useMemo(shopPacks, []);
  const coins = currency ?? 0;
  const { ask } = useDialogs();

  // A CONFIRM BEFORE THE COINS MOVE (the user, 2026-09-08): the buy is a
  // server call that debits on the spot, so a slip of the finger was a
  // pack. Free packs skip it.
  const buy = async pack => {
    const opts = {};
    if (pack.pick === 'conference') opts.conference = conf;
    if (pack.pick === 'division') opts.division = div;
    if (pack.pick === 'team') opts.team = team;
    if (pack.def.price > 0) {
      const detail = pack.pick === 'conference' ? ` (${conf})` : pack.pick === 'division' ? ` (${div})` : pack.pick === 'team' ? ` (${getTeam(team)?.name ?? team})` : '';
      const yes = await ask({
        title: `Buy ${pack.def.name}${detail}?`,
        body: `${pack.def.price.toLocaleString()} coins. You have ${coins.toLocaleString()}.`,
        confirmLabel: `Buy for ${pack.def.price.toLocaleString()}`,
      });
      if (!yes) return;
    }
    onBuyPack(pack.key, opts);
  };

  const picker = pack => {
    if (pack.pick === 'conference') {
      return (
        <select className={styles.selector} value={conf} onChange={e => setConf(e.target.value)}>
          {Object.keys(CONFERENCES).map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      );
    }
    if (pack.pick === 'division') {
      return (
        <select className={styles.selector} value={div} onChange={e => setDiv(e.target.value)}>
          {Object.keys(DIVISIONS).map(d => <option key={d} value={d}>{d}</option>)}
        </select>
      );
    }
    if (pack.pick === 'team') {
      return (
        <select className={styles.selector} value={team} onChange={e => setTeam(e.target.value)}>
          {TEAM_CODES.map(t => {
            const info = getTeam(t, { league: 'NBA' });
            return <option key={t} value={t}>{info?.city ? `${info.city} ${info.name}` : t}</option>;
          })}
        </select>
      );
    }
    return null;
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.balance}>
        <span className={styles.coinIcon}>$</span>
        <span className={styles.coinAmt}>{coins.toLocaleString()}</span>
        <span className={styles.coinLabel}>coins</span>
      </div>

      {GROUPS.map(group => {
        const rows = packs.filter(p => p.group === group.key);
        if (rows.length === 0) return null;
        return (
          <section key={group.key} className={styles.group}>
            <h3 className={styles.groupHead}>
              {group.key}
              <span className={styles.groupBlurb}>{group.blurb}</span>
            </h3>
            <div className={styles.grid}>
              {rows.map(pack => {
                const canAfford = coins >= pack.def.price;
                return (
                  <div
                    key={pack.key}
                    className={`${styles.tile} ${canAfford ? '' : styles.tileDisabled} ${pack.key === 'legendary_chase' ? styles.tileApex : ''}`}
                  >
                    <div className={styles.tileName}>{pack.def.name}</div>
                    <div className={styles.tileDesc}>{pack.desc}</div>
                    {picker(pack)}
                    <div className={styles.tilePrice}>
                      <span className={styles.coinIcon}>$</span>{pack.def.price.toLocaleString()}
                    </div>
                    <button className={styles.buyBtn} disabled={!canAfford} onClick={() => buy(pack)}>
                      {canAfford ? 'Buy' : `Need ${(pack.def.price - coins).toLocaleString()} more`}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
