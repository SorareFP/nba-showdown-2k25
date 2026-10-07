// CLAIMING A COLLECTION — the reward revealed, with the fanfare it earns.
//
// The user (2026-09-23): "spruce up the graphics for pack openings and
// collections finishing." A claim used to be a toast. Now it is a reveal on
// its own stage: the collection's name over a card back, a tap turns the
// reward card over, and it lands with the flash, the stamp ("Collection
// complete"), the confetti and the sound a pull of that band gets — at least
// a super-rare's, because finishing a collection is always news, and a
// legendary's when the reward is one. A collection that pays coins only
// gets the coins the same way, without the card.
//
// Everything about the CLAIM itself has already happened on the server
// before this mounts (CollectionTab.handleClaim); this only shows it.
import { useCallback, useEffect, useState } from 'react';
import { GOALS_BY_ID } from '../game/collections.js';
import { getCardByKey } from '../game/cardSets.js';
import { getPlayerRarity, RARITY_CONFIG } from '../game/rarity.js';
import { getPlayerImageUrl } from '../game/cardImages.js';
import { getTeam } from '../cards/teams.js';
import { logoSrc } from '../cards/CardTemplate.jsx';
import { playFlip, playReveal, playFanfare } from '../game/packAudio.js';
import Holo from './HoloSheen.jsx';
import { holoRegionsFor } from '../cards/faceRegions.js';
import { Fanfare } from './PackOpening.jsx';
import styles from './ClaimReveal.module.css';

const cssRarity = rarity => String(rarity).replace(/-/g, '_');

/** The collection's own name — the franchise's full name where it has one. */
export function goalTitle(goalId) {
  const goal = GOALS_BY_ID[goalId];
  if (!goal) return 'Collection';
  const team = goal.kind === 'team' ? getTeam(goal.label, { league: goal.league }) : null;
  return team?.city ? `${team.city} ${team.name}` : goal.label;
}

/**
 * WHAT A CLAIM HANDS THE REVEAL, from either route's answer (2026-10-07).
 *
 * The user: "When someone finishes a collection, I want the card reward to
 * have as much fanfare as the coin reward." It was built to — but the server's
 * claimGoal answered `{ reward, coins }` and the screen read `res.card`, which
 * only the direct route (localhost) sends. So every live claim reached the
 * reveal with no card, and played the coins-only reveal: the big gold number,
 * the flash and the stamp, and the reward card never turned over at all.
 * Either name is read now, and the server sends both.
 */
export function claimRevealFrom(goalId, res) {
  return { goalId, cardKey: res?.card ?? res?.reward ?? null, coins: res?.coins ?? 0 };
}

/** The fanfare's band: the reward's, and never less than a super-rare's. */
export const fanfareTierFor = rarity => (rarity === 'legendary' ? 'legendary' : 'super-rare');

export default function ClaimReveal({ goalId, cardKey = null, coins = 0, onClose }) {
  const [flipped, setFlipped] = useState(false);
  const card = cardKey ? getCardByKey(cardKey) : null;
  const rarity = card ? getPlayerRarity(card) : null;
  const goal = GOALS_BY_ID[goalId];
  const team = goal?.kind === 'team' ? getTeam(goal.label, { league: goal.league }) : null;
  const title = goalTitle(goalId);
  const tier = fanfareTierFor(rarity);

  const reveal = useCallback(() => {
    if (flipped) return;
    setFlipped(true);
    playFlip();
    setTimeout(() => { playReveal(rarity ?? 'super-rare', card?.set ?? null); playFanfare(tier); }, 280);
  }, [flipped, rarity, card, tier]);

  // No card to turn over: the coins are the reveal, so it plays on arrival.
  useEffect(() => {
    if (!card) {
      const t = setTimeout(() => { setFlipped(true); playFanfare('super-rare'); }, 150);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [card]);

  useEffect(() => {
    const onKey = e => {
      if (e.key === 'Escape') onClose?.();
      if ((e.key === 'Enter' || e.key === ' ') && !flipped) { e.preventDefault(); reveal(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipped, reveal, onClose]);

  return (
    <div className={`${styles.backdrop} ${flipped ? styles[`lit_${cssRarity(tier)}`] : ''}`} role="dialog" aria-modal="true" aria-label={`${title} — collection complete`}>
      <div className={styles.head}>
        {team?.logo && <img className={styles.crest} src={logoSrc(team.logo)} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <div className={styles.kicker}>Collection complete</div>
        <div className={styles.title}>{title}</div>
      </div>

      {card ? (
        <div
          className={`${styles.stage} ${flipped ? styles.flipped : ''}`}
          role="button"
          tabIndex={0}
          aria-label={flipped ? 'Your reward' : 'Reveal your reward'}
          onClick={reveal}
        >
          <div className={styles.inner}>
            <div className={styles.back}>
              <img src="/nba-showdown-2k25/card-back.png" alt="" className={styles.backImg} />
              <div className={styles.hint}>Tap to reveal your reward</div>
            </div>
            <Holo
              className={`${styles.front} ${styles[`front_${cssRarity(rarity)}`] ?? ''}`}
              active={flipped && holoRegionsFor(card).length > 0}
              regions={holoRegionsFor(card)}
              sweep={flipped}
            >
              <img src={getPlayerImageUrl(card.id, card.set)} alt={card.name} className={styles.face} onError={e => { e.currentTarget.style.display = 'none'; }} />
              <div className={styles.fallback}>{card.name}</div>
            </Holo>
          </div>
          {flipped && <Fanfare rarity={tier} stamp="Collection complete" />}
        </div>
      ) : (
        <div className={`${styles.coinsStage} ${flipped ? styles.coinsIn : ''}`}>
          <div className={styles.coinsBig}>🪙 +{Number(coins).toLocaleString('en-US')}</div>
          {flipped && <Fanfare rarity="super-rare" stamp="Collection complete" />}
        </div>
      )}

      <div className={styles.plate}>
        {card && flipped && (
          <>
            <div className={styles.pill} style={{ color: RARITY_CONFIG[rarity]?.color, background: RARITY_CONFIG[rarity]?.bg }}>
              {RARITY_CONFIG[rarity]?.label}
            </div>
            <div className={styles.name}>{card.name}{card.seasonLabel ? ` · ${card.seasonLabel}` : ''}</div>
            {/* The coins that come with a card get their moment too, after it. */}
            {coins > 0 && <div className={styles.coinsLine} data-claim-coins={coins}>+ 🪙 {Number(coins).toLocaleString('en-US')} coins</div>}
          </>
        )}
        {card && !flipped && <div className={styles.sub}>Your reward card is in there.</div>}
        {!card && <div className={styles.sub}>This collection pays coins.</div>}
      </div>

      <button className={styles.done} onClick={onClose} disabled={card ? !flipped : false}>
        {flipped ? 'Done' : 'Reveal first'}
      </button>
    </div>
  );
}
