import { useState } from 'react';
import { PACK_TYPES, CONFERENCES, DIVISIONS } from '../game/packEngine.js';
import styles from './PackShop.module.css';

const SHOP_PACKS = [
  { key: 'booster',      desc: '5 Players + 2 Strats' },
  { key: 'deluxe',       desc: '5 Players + 2 Strats · 1 Rare+' },
  { key: 'super',        desc: '5 Players + 2 Strats · 1 Rare+ Player' },
  { key: 'division',     desc: '5 Division Players + 2 Strats', themed: 'division' },
  { key: 'conference',   desc: '5 Conference Players + 2 Strats', themed: 'conference' },
  { key: 'conf_super',   desc: '5 Conf Players + 2 Strats · 1 Rare+ Player', themed: 'conference' },
  { key: 'rare_deluxe',  desc: '3 Rare+ Players + 1 Rare+ Strat' },
  { key: 'super_deluxe', desc: '3 Players + 1 Strat · 1 SR Player' },
  { key: 'mega_deluxe',  desc: '3 SR Players + 1 Rare Strat' },
  { key: 'booster_box',  desc: '36 Booster Packs (bulk discount)' },
];

export default function PackShop({ currency, onBuyPack }) {
  const [selectedConf, setSelectedConf] = useState('East');
  const [selectedDiv, setSelectedDiv] = useState('Atlantic');

  const buy = (packKey, themed) => {
    const opts = {};
    if (themed === 'conference') opts.conference = selectedConf;
    if (themed === 'division') opts.division = selectedDiv;
    onBuyPack(packKey, opts);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.balance}>
        <span className={styles.coinIcon}>$</span>
        <span className={styles.coinAmt}>{currency ?? 0}</span>
        <span className={styles.coinLabel}>coins</span>
      </div>

      <div className={styles.themedSelectors}>
        <label className={styles.selectorLabel}>
          Conference:
          <select value={selectedConf} onChange={e => setSelectedConf(e.target.value)} className={styles.selector}>
            {Object.keys(CONFERENCES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className={styles.selectorLabel}>
          Division:
          <select value={selectedDiv} onChange={e => setSelectedDiv(e.target.value)} className={styles.selector}>
            {Object.keys(DIVISIONS).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.grid}>
        {SHOP_PACKS.map(({ key, desc, themed }) => {
          const def = PACK_TYPES[key];
          const canAfford = (currency ?? 0) >= def.price;
          return (
            <div key={key} className={`${styles.tile} ${!canAfford ? styles.tileDisabled : ''}`}>
              <div className={styles.tileName}>{def.name}</div>
              <div className={styles.tileDesc}>{desc}</div>
              <div className={styles.tilePrice}>
                <span className={styles.coinIcon}>$</span>{def.price}
              </div>
              <button
                className={styles.buyBtn}
                disabled={!canAfford}
                onClick={() => buy(key, themed)}
              >
                {canAfford ? 'Buy' : 'Not enough coins'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
