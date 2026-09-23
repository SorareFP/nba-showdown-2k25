// A DEV-ONLY PACK OPENING, for looking at the reveal without an account.
//
//   http://localhost:5173/nba-showdown-2k25/?demo=pack
//   http://localhost:5173/nba-showdown-2k25/?demo=claim        a collection claimed
//   http://localhost:5173/nba-showdown-2k25/?demo=collection   the collection screens, for layout
//   http://localhost:5173/nba-showdown-2k25/?demo=play         the Play tab signed out: a real game, saved
//                                                              locally, with its recover list and board
//
// Mounted by App.jsx in place of the app, in development builds only, when
// the query string asks for it. The pack is a real booster from the engine
// with a super-rare and a legendary dealt into it, so the two fanfares can be
// seen on demand rather than once every sixty packs. Nothing is written
// anywhere: Done reloads the page.
import { useMemo } from 'react';
import PackOpening from './PackOpening.jsx';
import ClaimReveal from './ClaimReveal.jsx';
import MyCollection from './MyCollection.jsx';
import CollectionGoals from './CollectionGoals.jsx';
import PackShop from './PackShop.jsx';
import PlayTab from './PlayTab.jsx';
import { generatePack, SPECIAL_SETS_IN_PACKS } from '../game/packEngine.js';
import { CARD_SETS, BASE_SET, cardKey, getCardByKey } from '../game/cardSets.js';
import { getPlayerRarity } from '../game/rarity.js';
import { allGoalProgress } from '../game/collections.js';

/** The cards a booster can actually deal — not every registered set. */
const PACKABLE = [BASE_SET, ...SPECIAL_SETS_IN_PACKS].flatMap(id => CARD_SETS[id] ?? []);

/** Which dev demo the query string asks for: 'pack', 'claim', 'collection', 'play' or null. Never in production. */
export const demoKind = () => {
  if (!import.meta.env?.DEV || typeof window === 'undefined') return null;
  const kind = new URLSearchParams(window.location.search).get('demo');
  return ['pack', 'claim', 'collection', 'play'].includes(kind) ? kind : null;
};
export const isPackDemo = () => demoKind() !== null;

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

/** ?demo=claim — a claimed franchise with a legendary reward, and Escape/Done reloads. */
function ClaimDemo() {
  const { goalId, reward } = useMemo(() => {
    const goals = allGoalProgress(new Set(), { league: 'NBA' }).filter(g => g.reward);
    const legendary = goals.find(g => getPlayerRarity(getCardByKey(g.reward)) === 'legendary') ?? goals[0];
    return { goalId: legendary.id, reward: legendary.reward };
  }, []);
  return <ClaimReveal goalId={goalId} cardKey={reward} coins={490} onClose={() => window.location.reload()} />;
}

/**
 * ?demo=collection — My Collection, the collection goals and the Pack Shop
 * over a synthetic binder (every packable card, one copy, the base set
 * collected), for judging the layout at any width without an account.
 */
function CollectionDemo() {
  const collection = useMemo(() => Object.fromEntries(
    PACKABLE.map((c, i) => [cardKey(c), { type: 'player', count: 1 + (i % 3 === 0 ? 1 : 0), collected: c.set === BASE_SET }])
  ), []);
  const noop = () => {};
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <MyCollection collection={collection} onBurn={noop} onList={noop} onCollect={noop} />
      <CollectionGoals collection={collection} claims={{}} coins={0} onClaim={noop} onCollect={noop} busyGoal={null} busyCard={null} />
      <PackShop currency={4321} onBuyPack={noop} />
    </div>
  );
}

export default function PackOpeningDemo() {
  const cards = useMemo(demoPulls, []);
  if (demoKind() === 'claim') return <ClaimDemo />;
  if (demoKind() === 'collection') return <CollectionDemo />;
  // The real Play tab with no account: Quick Match deals a game, and it saves
  // and recovers exactly as a signed-in one does on this device.
  if (demoKind() === 'play') return <PlayTab teamA={[]} teamB={[]} active />;
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
