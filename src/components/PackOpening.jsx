// OPENING A PACK — the reveal, one card at a time.
//
// ── THE LEGENDARY TIER WAS UNHANDLED IN FOUR PLACES ─────────────────────────
//
// This screen knew about four rarities and the game has five. Every lookup used
// `RARITY[x] || fallback`, so `legendary` — absent from all of them — silently
// took the fallback, and the fallback was always the COMMON one:
//
//   the reveal order   `order[rarity] || 0` sorted legendaries with the commons,
//                      so the best card in the pack was shown FIRST, spoiling
//                      the suspense the sort exists to create
//   spark count        six particles, the fewest of any tier
//   spark colour       #94A3B8 — literally the common grey
//   the CSS border     no `.front_legendary`, so it fell through to the plain
//                      `var(--border)`: no glow, no pulse, no colour
//
// A legendary is one pull in three hundred and thirty and it arrived looking
// exactly like a common, first, with no sound. Every table here is now keyed
// off RARITY_ORDER rather than a hand-written list, so a sixth tier cannot
// reintroduce this by omission — it fails loudly at the tier table instead.
//
// ── WHY THE REVEAL ORDER IS ASCENDING ───────────────────────────────────────
//
// Commons first, legendary last. A pack has one interesting card at most and
// the whole point of revealing one at a time is that you do not know which one
// it is yet; sorting downward would answer that on the first card.
//
// ── DESKTOP GETS A SECOND COLUMN, NOT A WIDER ONE ───────────────────────────
//
// The screen was a 700px column on every viewport: a 320px card centred in a
// 1400px window, with the cards you had already pulled wrapping into a strip
// underneath that pushed the stage up and down as it grew. On a wide screen it
// now splits — stage on the left at its natural size, the pulls you have made
// as a fixed rail on the right that fills downward instead of reflowing. Below
// 900px it collapses back to the single column, which is the right shape for a
// phone and always was.
import { useState, useMemo, useCallback, useEffect } from 'react';
import { CARD_MAP } from '../game/cards.js';
import { STRAT_MAP } from '../game/strats.js';
import { getPlayerRarity, getStratRarity, RARITY_CONFIG, RARITY_ORDER } from '../game/rarity.js';
import { getSet } from '../cards/sets.js';
import { BASE_SET } from '../game/cardSets.js';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import { playFlip, playReveal, playComplete, isMuted, toggleMute } from '../game/packAudio.js';
import Holo from './HoloSheen.jsx';
import { holoRegionsFor } from '../cards/faceRegions.js';
import styles from './PackOpening.module.css';

/**
 * How big a deal each tier is, 0..1, derived from the shared RARITY_ORDER.
 *
 * DERIVED, NOT DECLARED, which is the whole fix described above: a tier added
 * to rarity.js gets a position here for free, and one that is somehow missing
 * from RARITY_ORDER lands at 0 rather than pretending to be common.
 */
const TIER = Object.fromEntries(
  RARITY_ORDER.map((r, i) => [r, i / Math.max(1, RARITY_ORDER.length - 1)])
);

/** Ascending, so the rarest card in the pack is the last one turned over. */
const revealRank = rarity => RARITY_ORDER.indexOf(rarity);

/** A CSS-safe suffix for a rarity id: `super-rare` -> `super_rare`. */
const cssRarity = rarity => String(rarity).replace(/-/g, '_');

/** Particle count and burst size, scaled off the tier rather than tabulated. */
function burstFor(rarity) {
  const t = TIER[rarity] ?? 0;
  return {
    count: Math.round(6 + t * 42),
    reach: 60 + t * 190,
    size: 2 + t * 5,
    rays: t >= 0.75 ? Math.round(6 + t * 10) : 0,
  };
}

/**
 * The SET PILL beside the rarity pill: which set a pulled card belongs to.
 *
 * A Rookie or Super Season pull sounds different (packAudio.js) and should
 * read differently too — the user asked for the set next to "RARE". The base
 * set is the default and gets no pill; a strategy card has no set.
 */
export function setPillFor(card) {
  const set = card?.set;
  if (!set || set === BASE_SET) return null;
  return { id: set, label: getSet(set)?.name ?? set };
}

export default function PackOpening({ cards, coins = null, onDone, onSaveRest = null }) {
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [dismissed, setDismissed] = useState([]);
  const [transitioning, setTransitioning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quiet, setQuiet] = useState(isMuted);

  // INSPECTING A PULLED CARD. Hovering a card in the rail shows it on the
  // stage at full size; clicking pins it so it stays put while the pointer
  // moves on. While a card is being inspected the stage click does not advance
  // the pack — it takes you back to it. Escape does the same. Nothing about
  // the pack's own state (current, flipped, dismissed) is touched by any of
  // this, so inspecting can never lose a card or skip one.
  const [inspect, setInspect] = useState(null);
  const [pinned, setPinned] = useState(false);
  const stopInspecting = useCallback(() => { setInspect(null); setPinned(false); }, []);

  const allEnriched = useMemo(() => {
    const list = cards.map((c, i) => {
      if (c.type === 'player') {
        const card = CARD_MAP[c.id];
        const rarity = card ? getPlayerRarity(card) : 'common';
        return {
          ...c, idx: i, card, rarity,
          name: card?.name || c.id,
          sub: card ? `${card.team} · $${card.salary}` : '',
          imgUrl: getPlayerImageUrl(c.id),
        };
      }
      const strat = STRAT_MAP[c.id];
      const rarity = strat ? getStratRarity(strat) : 'common';
      return {
        ...c, idx: i, card: strat, rarity,
        name: strat?.name || c.id,
        sub: strat ? `${strat.phase} · ${strat.side}` : '',
        imgUrl: getStratImagePath(c.id),
      };
    });
    // Strats first, then players by ascending rarity — the pack builds. In a
    // box that order holds WITHIN each pack, and the packs come in box order:
    // thirty-six boosters, then the bonus.
    return list.sort((a, b) => {
      const pa = a.packIndex ?? 0;
      const pb = b.packIndex ?? 0;
      if (pa !== pb) return pa - pb;
      if (a.type !== b.type) return a.type === 'strat' ? -1 : 1;
      return revealRank(a.rarity) - revealRank(b.rarity);
    });
  }, [cards]);

  // THE PACKS. A single pack is one group; a box is thirty-seven. The reveal
  // only ever looks at the current group, so everything below that used to
  // read the whole list reads `enriched` exactly as before and gets a pack.
  const groups = useMemo(() => {
    const byPack = new Map();
    for (const c of allEnriched) {
      const k = c.packIndex ?? 0;
      if (!byPack.has(k)) byPack.set(k, []);
      byPack.get(k).push(c);
    }
    return [...byPack.entries()].sort((a, b) => a[0] - b[0]).map(([, list]) => list);
  }, [allEnriched]);
  const [packNo, setPackNo] = useState(0);
  const enriched = groups[packNo] ?? [];
  const isBox = groups.length > 1;
  const lastPack = packNo >= groups.length - 1;

  const totalCards = enriched.length;
  const allDone = totalCards > 0 && dismissed.length === totalCards; // this pack
  const boxDone = allDone && lastPack;
  const currentCard = enriched[current];

  // The best thing in the pack, for the header. Known up front — it is not a
  // spoiler, because it does not say WHICH card, only that one is in there.
  const best = useMemo(
    () => enriched.reduce(
      (top, c) => (revealRank(c.rarity) > revealRank(top) ? c.rarity : top),
      RARITY_ORDER[0]
    ),
    [enriched]
  );

  useEffect(() => {
    if (allDone) playComplete();
  }, [allDone]);

  const handleClick = useCallback(() => {
    if (inspect != null) { stopInspecting(); return; }
    if (allDone || transitioning) return;
    if (!flipped) {
      setFlipped(true);
      playFlip();
      // The chime lands as the card lands, not as it starts turning.
      const rarity = currentCard?.rarity;
      // The set picks the instrument; the rarity picks the row. A strat is its
      // own quiet kind.
      const set = currentCard?.type === 'strat' ? 'strats' : currentCard?.card?.set ?? null;
      setTimeout(() => playReveal(rarity, set), 280);
      // 👑 LEBROOOOON JAMES — the one sampled sound, because it is a joke and a
      // joke cannot be synthesized. Guarded: a missing file must not stop a pull.
      if (currentCard && (currentCard.id === 'LeBron_James' || currentCard.id === '08_09_LeBron_James')) {
        try { new Audio('/nba-showdown-2k25/lebron.mp3').play().catch(() => {}); } catch { /* no sound */ }
      }
    } else {
      setTransitioning(true);
      setFlipped(false);
      setTimeout(() => {
        setDismissed(prev => [...prev, current]);
        setCurrent(prev => prev + 1);
        setTransitioning(false);
      }, 350);
    }
  }, [allDone, transitioning, flipped, current, currentCard, inspect, stopInspecting]);

  // Space and Enter do what a tap does. The stage is the primary control on
  // this screen and reaching it by keyboard should not require a mouse.
  const handleKey = useCallback(e => {
    if (e.key === 'Escape' && inspect != null) { stopInspecting(); return; }
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    handleClick();
  }, [handleClick, inspect, stopInspecting]);

  const handleSkipAll = () => {
    setDismissed(enriched.map((_, i) => i));
    setCurrent(totalCards);
    setFlipped(false);
    setTransitioning(false);
  };

  const handleDone = async () => {
    if (saving) return;
    setSaving(true);
    await onDone();
  };

  // Next pack in the box: the same screen, fresh state, the pack after this.
  const handleNextPack = () => {
    stopInspecting();
    setDismissed([]);
    setCurrent(0);
    setFlipped(false);
    setTransitioning(false);
    setPackNo(n => n + 1);
  };

  // Put the rest of the box down. The cards are already the player's — the
  // server recorded them before this screen opened — so what is saved is the
  // REVEAL: the raw pulls of every pack after this one, exactly as received,
  // for the Collection tab to hand back to this component later.
  const handleSaveRest = async () => {
    if (saving || !onSaveRest) return;
    setSaving(true);
    const thisPack = enriched[0]?.packIndex ?? 0;
    const rest = cards.filter(c => (c.packIndex ?? 0) > thisPack);
    await onSaveRest(rest);
  };

  const remaining = enriched.filter((_, i) => i > current && !dismissed.includes(i));
  const inspected = inspect != null ? enriched[inspect] : null;
  const peekCount = Math.min(remaining.length, 4);
  const revealedRarity = flipped && currentCard ? currentCard.rarity : null;
  const stageTier = revealedRarity ? cssRarity(revealedRarity) : 'none';

  return (
    <div className={`${styles.wrap} ${flipped ? styles[`lit_${stageTier}`] : ''}`}>
      <div className={styles.header}>
        <div>
          <h2 className={styles.title}>Pack Opening</h2>
          <div className={styles.bestHint}>
            Best in pack:{' '}
            <span style={{ color: RARITY_CONFIG[best]?.color }}>{RARITY_CONFIG[best]?.label}</span>
          </div>
        </div>
        <div className={styles.headRight}>
          {/* The balance, because this screen takes over the whole tab and the
              debit has already happened — a player should be able to see it. */}
          {coins != null && (
            <div className={styles.counter} title="Your balance">${coins.toLocaleString()}</div>
          )}
          <button
            className={styles.soundBtn}
            onClick={() => setQuiet(toggleMute())}
            aria-pressed={!quiet}
            title={quiet ? 'Sound off' : 'Sound on'}
          >
            {quiet ? '🔇' : '🔊'}
          </button>
          <div className={styles.counter}>
            {isBox && <span>Pack {packNo + 1}/{groups.length} · </span>}
            {dismissed.length}/{totalCards}
          </div>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.stageCol}>
          {inspected && (
            <div
              className={`${styles.stageArea} ${styles.inspectArea} ${inspected.type === 'strat' ? styles.stratStage : ''}`}
              onClick={handleClick}
              onKeyDown={handleKey}
              role="button"
              tabIndex={0}
              aria-label="Back to the pack"
            >
              <div className={`${styles.aura} ${styles[`aura_${cssRarity(inspected.rarity)}`]}`} />
              <Holo
                className={`${styles.inspectCard} ${styles[`front_${cssRarity(inspected.rarity)}`]}`}
                active={inspected.rarity === 'legendary'}
                regions={holoRegionsFor(inspected.card)}
              >
                <img
                  src={inspected.imgUrl}
                  alt={inspected.name}
                  className={styles.faceImg}
                  onError={e => { e.target.style.display = 'none'; }}
                />
                <div className={styles.faceFallback}>{inspected.name}</div>
              </Holo>
            </div>
          )}

          {!inspected && !allDone && (
            <div
              className={`${styles.stageArea} ${currentCard?.type === 'strat' ? styles.stratStage : ''}`}
              onClick={handleClick}
              onKeyDown={handleKey}
              role="button"
              tabIndex={0}
              aria-label={flipped ? 'Continue to the next card' : 'Reveal this card'}
            >
              {revealedRarity && <div className={`${styles.aura} ${styles[`aura_${stageTier}`]}`} />}

              {[...Array(peekCount)].map((_, pi) => (
                <div
                  key={`peek-${pi}`}
                  className={styles.peekCard}
                  style={{
                    transform: `translateX(${(pi + 1) * 7}px) translateY(${(pi + 1) * 5}px) scale(${1 - (pi + 1) * 0.02})`,
                    zIndex: 10 - pi - 1,
                  }}
                >
                  <div className={styles.cardBackFace}>
                    <img src="/nba-showdown-2k25/card-back.png" alt="" className={styles.cardBackImg} />
                  </div>
                </div>
              ))}

              {currentCard && (
                <div
                  key={currentCard.idx}
                  className={`${styles.mainCard} ${flipped ? styles.mainFlipped : ''}`}
                  style={{ zIndex: 10 }}
                >
                  <div className={styles.mainInner}>
                    <div className={styles.mainBack}>
                      <img src="/nba-showdown-2k25/card-back.png" alt="Card back" className={styles.cardBackImg} />
                      <div className={styles.backHint}>Tap to reveal</div>
                    </div>
                    <Holo
                      className={`${styles.mainFront} ${styles[`front_${cssRarity(currentCard.rarity)}`]}`}
                      active={flipped && currentCard.rarity === 'legendary'}
                      regions={holoRegionsFor(currentCard.card)}
                    >
                      <img
                        src={currentCard.imgUrl}
                        alt={currentCard.name}
                        className={styles.faceImg}
                        onError={e => { e.target.style.display = 'none'; }}
                      />
                      <div className={styles.faceFallback}>{currentCard.name}</div>
                    </Holo>
                  </div>
                  {flipped && <SparkEffect rarity={currentCard.rarity} />}
                </div>
              )}
            </div>
          )}

          {!inspected && allDone && (
            <div className={styles.finale}>
              <div className={styles.finaleMark}>✓</div>
              <div className={styles.finaleTitle}>{isBox && !lastPack ? `Pack ${packNo + 1} of ${groups.length} complete` : 'Pack complete'}</div>
              <div className={styles.finaleSub}>
                {isBox && !lastPack
                  ? `${groups.length - packNo - 1} pack${groups.length - packNo - 1 === 1 ? '' : 's'} still to open`
                  : `${totalCards} cards pulled`}
              </div>
            </div>
          )}

          {inspected ? (
            <div className={styles.nameplate}>
              <div className={styles.platePills}>
                <div
                  className={styles.plateRarity}
                  style={{ color: RARITY_CONFIG[inspected.rarity]?.color, background: RARITY_CONFIG[inspected.rarity]?.bg }}
                >
                  {RARITY_CONFIG[inspected.rarity]?.label}
                </div>
                {setPillFor(inspected.card) && (
                  <div className={`${styles.plateRarity} ${styles.plateSet}`}>{setPillFor(inspected.card).label}</div>
                )}
              </div>
              <div className={styles.plateName}>{inspected.name}</div>
              <div className={styles.plateSub}>
                {inspected.sub}{inspected.sub ? ' · ' : ''}{pinned ? 'tap the card to go back' : 'viewing'}
              </div>
            </div>
          ) : !allDone && currentCard && (
            <div className={styles.nameplate}>
              <div className={styles.platePills}>
                <div
                  className={styles.plateRarity}
                  style={{
                    color: flipped ? RARITY_CONFIG[currentCard.rarity]?.color : 'var(--text-dim)',
                    background: flipped ? RARITY_CONFIG[currentCard.rarity]?.bg : 'transparent',
                  }}
                >
                  {flipped ? RARITY_CONFIG[currentCard.rarity]?.label : '???'}
                </div>
                {flipped && setPillFor(currentCard.card) && (
                  <div className={`${styles.plateRarity} ${styles.plateSet}`}>{setPillFor(currentCard.card).label}</div>
                )}
              </div>
              <div className={styles.plateName}>{flipped ? currentCard.name : 'Tap the card'}</div>
              <div className={styles.plateSub}>{flipped ? currentCard.sub : `${remaining.length + 1} left in the pack`}</div>
            </div>
          )}

          <div className={styles.actions}>
            {!allDone && (
              <button className={styles.skipBtn} onClick={handleSkipAll}>
                {isBox ? `Skip this pack (${totalCards - dismissed.length} left)` : `Skip all (${totalCards - dismissed.length} left)`}
              </button>
            )}
            {allDone && !boxDone && (
              <>
                <button className={styles.doneBtn} onClick={handleNextPack} disabled={saving}>
                  Open next pack →
                </button>
                {onSaveRest && (
                  <button className={styles.skipBtn} onClick={handleSaveRest} disabled={saving}>
                    {saving ? 'Saving…' : 'Save the rest for later'}
                  </button>
                )}
              </>
            )}
            {boxDone && (
              <button className={styles.doneBtn} onClick={handleDone} disabled={saving}>
                {saving ? '…' : 'Done'}
              </button>
            )}
          </div>
        </div>

        {/* THE RAIL. On desktop this is a fixed column that fills downward; on a
            phone it becomes the wrapping strip it always was. Either way it is
            the same list, so there is one place that renders a pulled card. */}
        <div className={styles.rail}>
          <div className={styles.railHead}>Pulled</div>
          <div className={styles.railList}>
            {dismissed.length === 0 && <div className={styles.railEmpty}>Nothing yet.</div>}
            {dismissed.map(di => {
              const c = enriched[di];
              const cfg = RARITY_CONFIG[c.rarity];
              return (
                <div
                  key={di}
                  className={`${styles.railItem} ${inspect === di ? styles.railItemActive : ''}`}
                  style={{ borderColor: cfg.color }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={pinned && inspect === di}
                  aria-label={`View ${c.name}`}
                  onMouseEnter={() => { if (!pinned) setInspect(di); }}
                  onMouseLeave={() => { if (!pinned) setInspect(null); }}
                  onClick={() => {
                    if (pinned && inspect === di) stopInspecting();
                    else { setInspect(di); setPinned(true); }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.click(); }
                  }}
                >
                  <img
                    src={c.imgUrl}
                    alt=""
                    className={styles.railImg}
                    onError={e => { e.target.style.visibility = 'hidden'; }}
                  />
                  <div className={styles.railText}>
                    <div className={styles.railName}>{c.name}</div>
                    <div className={styles.railTag} style={{ color: cfg.color }}>{cfg.label}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The particle burst.
 *
 * Count, reach, size and the ray fan all come from `burstFor`, which reads the
 * tier off RARITY_ORDER — so a common gets six small close particles and a
 * legendary gets forty-eight large ones thrown twice as far plus a ray fan,
 * with every tier between landing on the curve rather than on a guess.
 */
function SparkEffect({ rarity }) {
  const { count, reach, size, rays } = burstFor(rarity);
  const color = RARITY_CONFIG[rarity]?.color ?? RARITY_CONFIG.common.color;

  // Built once per mount: the randomness is the point, but it must not be
  // re-rolled on every parent render mid-animation.
  const bits = useMemo(() => (
    [...Array(count)].map(() => {
      const angle = Math.random() * Math.PI * 2;
      const dist = reach * (0.5 + Math.random() * 0.5);
      return {
        tx: Math.cos(angle) * dist,
        ty: Math.sin(angle) * dist,
        size: size * (0.6 + Math.random() * 0.8),
        delay: Math.random() * 0.18,
      };
    })
  ), [count, reach, size]);

  return (
    <div className={styles.sparks}>
      {rays > 0 && [...Array(rays)].map((_, i) => (
        <span
          key={`ray-${i}`}
          className={styles.ray}
          style={{
            '--angle': `${(360 / rays) * i}deg`,
            '--color': color,
            '--delay': `${i * 0.012}s`,
          }}
        />
      ))}
      {bits.map((b, i) => (
        <span
          key={i}
          className={styles.spark}
          style={{
            '--tx': `${b.tx}px`,
            '--ty': `${b.ty}px`,
            '--size': `${b.size}px`,
            '--color': color,
            '--delay': `${b.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

export { TIER, burstFor, revealRank };
