// A DEV-ONLY PACK OPENING, for looking at the reveal without an account.
//
//   http://localhost:5173/nba-showdown-2k25/?demo=pack
//
// Mounted by App.jsx in place of the app, in development builds only, when
// the query string asks for it. The pack is a real booster from the engine
// with a super-rare and a legendary dealt into it, so the two fanfares can be
// seen on demand rather than once every sixty packs. Nothing is written
// anywhere: Done reloads the page.
import { useMemo } from 'react';
import PackOpening from './PackOpening.jsx';
import { generatePack, SPECIAL_SETS_IN_PACKS } from '../game/packEngine.js';
import { CARD_SETS, BASE_SET, cardKey } from '../game/cardSets.js';
import { getPlayerRarity } from '../game/rarity.js';

/** The cards a booster can actually deal — not every registered set. */
const PACKABLE = [BASE_SET, ...SPECIAL_SETS_IN_PACKS].flatMap(id => CARD_SETS[id] ?? []);

export const isPackDemo = () =>
  Boolean(import.meta.env?.DEV) &&
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('demo') === 'pack';

/** A booster with one super-rare and one legendary dealt into it. */
export function demoPulls() {
  const pulls = generatePack('booster').map(p => ({ ...p, packIndex: 0, packType: 'booster' }));
  const pick = rarity => {
    const pool = PACKABLE.filter(c => getPlayerRarity(c) === rarity);
    const card = pool[Math.floor(Math.random() * pool.length)];
    return card ? { type: 'player', id: cardKey(card), packIndex: 0, packType: 'booster' } : null;
  };
  const players = pulls.filter(p => p.type === 'player');
  const extras = [pick('super-rare'), pick('legendary')].filter(Boolean);
  // Two of the pack's players make way, so the count stays a booster's.
  const trimmed = [...pulls.filter(p => p.type !== 'player'), ...players.slice(0, Math.max(0, players.length - extras.length)), ...extras];
  return trimmed;
}

export default function PackOpeningDemo() {
  const cards = useMemo(demoPulls, []);
  return (
    <div style={{ padding: '16px 20px' }}>
      <PackOpening
        cards={cards}
        coins={4321}
        packName="Booster Pack"
        onDone={() => window.location.reload()}
      />
    </div>
  );
}
