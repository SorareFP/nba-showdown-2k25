// THE COLLECTION TRACKER — every goal, how close it is, and the claim button.
//
// ── WHAT THIS SCREEN IS FOR ─────────────────────────────────────────────────
//
// A collection is only a goal if you can see it. The ladder, the difficulty
// bands and the claim flow all shipped before this screen existed, which meant
// a player could complete the Bucks roster and never learn that they had. So
// the job here is to make progress legible and the last step obvious.
//
// ── WHY MISSING CARDS ARE THE CENTRE OF IT ──────────────────────────────────
//
// "11 / 12" is the least useful true thing this screen could say. Expanding a
// goal lists exactly which cards are missing, each with a Buy button at its
// market price, because the answer to "what do I do next" should be one click
// from the question. That is also the market's natural home: buying a random
// card from a browse screen is a shopping trip, buying the one card between you
// and a reward is a decision.
import { useState, useMemo } from 'react';
import { allGoalProgress, GOALS_BY_ID, COINS_ONLY_GOALS, collectedKeys } from '../game/collections.js';
import { GOAL_DIFFICULTY, rewardBandFor } from '../game/collectionDifficulty.js';
import { getCardByKey } from '../game/cardSets.js';
import { RARITY_CONFIG, getPlayerRarity } from '../game/rarity.js';
import { getPlayerImageUrl } from '../game/cardImages.js';
import { getTeam } from '../cards/teams.js';
// teams.js stores bare root-relative logo paths ('/logos/MIL.png') and the app
// is served under a base path, so every logo has to go through logoSrc — the
// same helper the card renderer uses, rather than a second copy of the rule.
import { logoSrc, LEAGUE_LOGOS } from '../cards/CardTemplate.jsx';
import styles from './CollectionGoals.module.css';

const LEAGUES = [
  { key: 'NBA', label: 'NBA' },
  { key: 'WNBA', label: 'WNBA' },
];

const TIERS = [
  { kind: 'team', label: 'Franchises', blurb: 'Collect every card on a roster.' },
  { kind: 'conference', label: 'Conferences', blurb: 'Every roster in one conference.' },
  { kind: 'set', label: 'The Full Set', blurb: 'Every card in the league.' },
];

/** A goal's own team code, for logos — team goals only. */
function teamCodeOf(goal) {
  return goal.kind === 'team' ? goal.label : null;
}

function fmt(n) {
  return n.toLocaleString('en-US');
}

/**
 * How hard this goal is, in words.
 *
 * The raw expected-packs number is the honest measure but a bad label: nobody
 * reads "202.4" as harder than "68.1" at a glance, and the tail makes the
 * numbers look arbitrary. The BAND is already the difficulty, so it is what
 * gets shown — a player who wants the number can read the pack estimate beside
 * it.
 */
function difficultyOf(goalId) {
  const band = rewardBandFor(goalId);
  const packs = GOAL_DIFFICULTY[goalId];
  return { band: band?.band ?? null, packs: packs ? Math.round(packs) : null };
}

/**
 * One card in a goal's roster, owned or not.
 *
 * ── SHOWING WHAT YOU HAVE, NOT ONLY WHAT YOU LACK ───────────────────────────
 *
 * This listed the MISSING cards only, and that turned out to read as an error:
 * a Clippers roster with no Kawhi Leonard on it looks like a roster that forgot
 * Kawhi Leonard, when in fact he had been collected and filtered out. A
 * collection screen that hides your collection is answering the wrong question.
 *
 * So the whole roster is drawn, missing first — the actionable ones stay at the
 * top where the Buy buttons are useful — and the owned ones follow, dimmed and
 * ticked. The count of copies is shown because it is the thing that decides
 * whether a spare can be burned.
 */
/**
 * One card of a goal's roster. Three states: COLLECTED (in the binder, counts),
 * OWNED BUT NOT COLLECTED (a spare — the Collect button lives here, where the
 * shop's Buy button used to), and MISSING.
 */
function RosterCard({ cardKey: key, owned, collected, busy, onCollect }) {
  const card = getCardByKey(key);
  // A key with no card is a pool change, not a bug: the goal's requirement list
  // is rebuilt from the current sets, so this can only happen mid-deploy.
  if (!card) return null;
  const rarity = getPlayerRarity(card);
  const cfg = RARITY_CONFIG[rarity];
  const spare = owned > 0 && !collected;
  return (
    <li
      className={`${styles.missing} ${collected ? styles.owned : ''}`}
      style={{ borderColor: collected ? 'transparent' : cfg.color }}
    >
      <img
        className={styles.missingArt}
        src={getPlayerImageUrl(key)}
        alt=""
        loading="lazy"
        onError={e => { e.currentTarget.style.visibility = 'hidden'; }}
      />
      <div className={styles.missingText}>
        <span className={styles.missingName}>{card.name}</span>
        <span className={styles.missingMeta} style={{ color: collected ? 'var(--green)' : spare ? 'var(--orange)' : cfg.color }}>
          {collected
            ? `✓ collected${owned > 1 ? ` ×${owned}` : ''}`
            : spare ? `owned ×${owned} · not collected` : cfg.label}
        </span>
      </div>
      {spare && (
        <button
          className={styles.buy}
          disabled={busy}
          title="Put a copy in your collection — it can no longer be sold or burned"
          onClick={() => onCollect(key)}
        >
          {busy ? '…' : 'Collect'}
        </button>
      )}
    </li>
  );
}

/** The whole roster, missing first, capped so a set-sized goal stays readable. */
function rosterFor(goal, counts, limit = 60) {
  const keys = GOALS_BY_ID[goal.id]?.requires ?? [];
  const missing = keys.filter(k => !counts[k]);
  const owned = keys.filter(k => counts[k]);
  const ordered = [...missing, ...owned];
  return { shown: ordered.slice(0, limit), hidden: Math.max(0, ordered.length - limit), counts };
}

function GoalRow({ goal, counts, collected, claimed, coins, busy, busyCard, onClaim, onCollect, expanded, onToggle }) {
  const pct = goal.total ? Math.round((goal.owned / goal.total) * 100) : 0;
  const roster = expanded ? rosterFor(goal, counts) : { shown: [], hidden: 0, counts };
  const { band, packs } = difficultyOf(goal.id);
  const cfg = band ? RARITY_CONFIG[band] : null;
  const team = teamCodeOf(GOALS_BY_ID[goal.id]);
  const theme = team ? getTeam(team, { league: goal.league }) : null;
  // A conference and a set have no crest of their own. Slicing the label gave
  // "Eas", "Wes" and "Com", which reads like a truncation bug rather than a
  // mark — so the set tier wears its league's logo and a conference wears its
  // initial.
  const crest = theme?.logo
    ? { img: logoSrc(theme.logo) }
    : goal.kind === 'set'
      ? { img: logoSrc(LEAGUE_LOGOS[goal.league] ?? LEAGUE_LOGOS.NBA) }
      : { text: goal.kind === 'conference' ? goal.label[0] : goal.label.slice(0, 3) };
  const reward = goal.reward ? getCardByKey(goal.reward) : null;
  const payout = goal.rewardCoins;

  return (
    <div className={`${styles.goal} ${goal.complete ? styles.done : ''}`}>
      <button className={styles.head} onClick={onToggle} aria-expanded={expanded}>
        <span
          className={styles.crest}
          style={{ background: theme?.primary ?? 'var(--card-bg)', borderColor: theme?.secondary ?? 'transparent' }}
        >
          {crest.img
            ? <img src={crest.img} alt="" onError={e => { e.currentTarget.style.display = 'none'; }} />
            : <span className={`${styles.crestText} ${goal.kind === 'conference' ? styles.crestInitial : ''}`}>{crest.text}</span>}
        </span>

        <span className={styles.headText}>
          <span className={styles.name}>
            {theme?.city ? `${theme.city} ${theme.name}` : goal.label}
          </span>
          <span className={styles.sub}>
            {goal.owned} / {goal.total} cards
            {payout > 0 && <> · <b>{fmt(payout)}</b> coins</>}
            {packs != null && <> · ~{fmt(packs)} packs</>}
          </span>
        </span>

        {cfg && !COINS_ONLY_GOALS.has(goal.id) && (
          // WITHOUT A REWARD CARD THIS IS A DIFFICULTY LABEL, NOT A PROMISE.
          // The WNBA tiers are ranked and banded like the NBA ones but no cards
          // have been minted for them yet, and a solid "LEGENDARY" chip beside a
          // goal that pays only coins reads as an advertisement for a card that
          // does not exist. Ghosted, and it says which it is on hover.
          <span
            className={`${styles.band} ${goal.reward ? '' : styles.bandGhost}`}
            style={{ background: cfg.bg, color: cfg.color }}
            title={goal.reward ? `Reward tier: ${cfg.label}` : `Difficulty: ${cfg.label} — no reward card yet`}
          >
            {cfg.label}
          </span>
        )}

        <span className={styles.barWrap}>
          <span
            className={styles.bar}
            style={{ width: `${pct}%`, background: goal.complete ? 'var(--green)' : (theme?.primary ?? 'var(--orange)') }}
          />
        </span>
        <span className={styles.pct}>{pct}%</span>
        <span className={styles.chev} aria-hidden>{expanded ? '▾' : '▸'}</span>
      </button>

      <div className={styles.actions}>
        {claimed ? (
          <span className={styles.claimed}>
            ✓ Claimed{claimed.coins ? ` · +${fmt(claimed.coins)} coins` : ''}
          </span>
        ) : goal.complete ? (
          <button className={styles.claim} disabled={busy} onClick={() => onClaim(goal.id)}>
            {busy ? 'Claiming…' : 'Claim reward'}
          </button>
        ) : (
          <span className={styles.togo}>{goal.missingCount} to go</span>
        )}
        {reward ? (
          <span className={styles.rewardChip} title={`Reward: ${reward.name} ${reward.seasonLabel ?? ''}`}>
            🏆 {reward.name}
          </span>
        ) : payout > 0 ? (
          // SAYING SO BEATS SHOWING NOTHING. A blank space here reads as a
          // reward that failed to load; three WNBA franchises pay coins by
          // design — Toronto and Golden State are expansion sides with no
          // history to cut a card from, and Portland's original Fire lasted
          // three seasons — and the rest are simply waiting on art.
          <span
            className={styles.coinsChip}
            title={
              COINS_ONLY_GOALS.has(goal.id)
                ? 'This franchise has no history to cut a reward card from — it pays coins'
                : 'This goal pays coins; its reward card is not minted yet'
            }
          >
            🪙 {fmt(payout)} coins
          </span>
        ) : null}
      </div>

      {expanded && roster.shown.length > 0 && (
        <ul className={styles.missingList}>
          {roster.shown.map(key => (
            <RosterCard
              key={key}
              cardKey={key}
              owned={roster.counts[key] ?? 0}
              collected={collected.has(key)}
              busy={busyCard === key}
              onCollect={onCollect}
            />
          ))}
          {roster.hidden > 0 && (
            <li className={styles.more}>+{fmt(roster.hidden)} more not listed</li>
          )}
        </ul>
      )}
    </div>
  );
}

export default function CollectionGoals({ collection, claims, coins, onClaim, onCollect, busyGoal, busyCard }) {
  const [league, setLeague] = useState('NBA');
  const [expanded, setExpanded] = useState(null);
  const [hideDone, setHideDone] = useState(false);

  // COLLECTED cards, not owned ones — see collectedKeys. A spare in the box
  // shows in the roster as "owned · not collected" with a Collect button.
  const ownedKeys = useMemo(() => collectedKeys(collection), [collection]);
  // How MANY of each, not just whether — the roster list shows copies, because
  // the copy count is what decides whether a spare can be burned.
  const counts = useMemo(
    () => Object.fromEntries(
      Object.entries(collection).map(([k, e]) => [k, e?.count ?? 0]).filter(([, n]) => n > 0)
    ),
    [collection]
  );
  const rows = useMemo(() => allGoalProgress(ownedKeys, { league }), [ownedKeys, league]);

  const claimable = rows.filter(r => r.complete && !claims[r.id]).length;
  const completeCount = rows.filter(r => r.complete).length;

  return (
    <div className={styles.wrap}>
      <div className={styles.topBar}>
        <div className={styles.leagues}>
          {LEAGUES.map(l => (
            <button
              key={l.key}
              className={`${styles.league} ${league === l.key ? styles.leagueOn : ''}`}
              onClick={() => { setLeague(l.key); setExpanded(null); }}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className={styles.summary}>
          <b>{completeCount}</b> complete
          {claimable > 0 && <span className={styles.badge}>{claimable} to claim</span>}
        </div>
        <label className={styles.hideDone}>
          <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
          Hide claimed
        </label>
      </div>

      {TIERS.map(tier => {
        const tierRows = rows
          .filter(r => r.kind === tier.kind)
          .filter(r => !hideDone || !claims[r.id]);
        if (tierRows.length === 0) return null;
        return (
          <section key={tier.kind} className={styles.tier}>
            <h3 className={styles.tierHead}>
              {tier.label}
              <span className={styles.tierBlurb}>{tier.blurb}</span>
            </h3>
            <div className={styles.goals}>
              {tierRows.map(goal => (
                <GoalRow
                  key={goal.id}
                  goal={goal}
                  counts={counts}
                  claimed={claims[goal.id]}
                  coins={coins}
                  busy={busyGoal === goal.id || busyCard != null}
                  onClaim={onClaim}
                  onCollect={onCollect}
                  collected={ownedKeys}
                  busyCard={busyCard}
                  expanded={expanded === goal.id}
                  onToggle={() => setExpanded(expanded === goal.id ? null : goal.id)}
                />
              ))}
            </div>
          </section>
        );
      })}

      {league === 'WNBA' && (
        <p className={styles.note}>
          The WNBA has no conference tier — fifteen teams have no even split, and inventing a
          7-8 division would mean calling something real that isn't.
        </p>
      )}
    </div>
  );
}
