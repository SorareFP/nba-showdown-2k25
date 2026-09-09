// THE COLLECTION-ONLY TEAM EDITOR, in My Teams.
//
// ── WHY A SECOND BUILDER ────────────────────────────────────────────────────
//
// The Team Builder tab is a sandbox: two rosters, every card in the set when
// there is no collection to restrict it to, and a Start Game button. That is
// the right tool for an exhibition. It is the wrong place to build a team you
// mean to keep, because a kept team is made of cards you OWN — that is what
// collecting is for — and the sandbox only knows about ownership as a filter
// it can switch off.
//
// This editor knows nothing else. Its pool is the collection and only the
// collection; a card you burned or sold since you saved the team shows up in
// the roster flagged, and the team cannot be saved again until it goes. One
// roster, a name, a cap bar, save. It borrows the sandbox's stylesheet so the
// two read as the same thing, and shares its rules through teamRules.js so
// they cannot drift.
import { useMemo, useState } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { saveTeam, updateTeam } from '../firebase/savedTeams.js';
import { CARD_MAP } from '../game/cards.js';
import { getPlayerRarity, RARITY_CONFIG } from '../game/rarity.js';
import { CAP, MAX, MIN_TO_PLAY, capSal, ownedPlayers, DEFAULT_FILTERS, filterPool, sortPool } from '../game/teamRules.js';
import PoolFilters from './PoolFilters.jsx';
import PlayerCard from './PlayerCard.jsx';
import { useLightbox } from './CardLightbox.jsx';
import styles from './TeamBuilderTab.module.css';

export default function TeamEditor({ team, collection, onSaved, onCancel }) {
  const { user } = useAuth();
  const { open } = useLightbox();

  const owned = useMemo(() => ownedPlayers(collection), [collection]);
  const ownedByKey = useMemo(() => Object.fromEntries(owned.map(o => [o.key, o])), [owned]);

  // The roster is keyed the way a saved team is, so an existing team loads
  // straight in — including cards no longer owned, which are kept and flagged
  // rather than silently dropped. Losing a card from a team you did not touch
  // would be a surprise; being told is not.
  const [roster, setRoster] = useState(() =>
    (team?.players ?? []).map(id => CARD_MAP[id]).filter(Boolean)
  );
  const [name, setName] = useState(team?.name ?? '');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const keyOf = card => owned.find(o => o.card === card)?.key ?? card.id;
  const inRoster = card => roster.some(c => c === card || keyOf(c) === keyOf(card));
  const unowned = roster.filter(c => !ownedByKey[keyOf(c)]);

  const teams = useMemo(() => [...new Set(owned.map(o => o.card.team))].sort(), [owned]);

  // Filter and sort the CARDS, then carry each row's key and count back.
  const pool = useMemo(() => {
    const byCard = new Map(owned.map(o => [o.card, o]));
    return sortPool(filterPool(owned.map(o => o.card), filters), filters.sort).map(c => byCard.get(c));
  }, [owned, filters]);

  const sal = capSal(roster);
  const over = sal > CAP;
  const pct = Math.min(100, (sal / CAP) * 100);

  const add = card => {
    setError(null);
    if (inRoster(card)) return;
    if (roster.length >= MAX) return setError(`Team full (max ${MAX})`);
    if (sal + card.salary > CAP) return setError(`Over the salary cap ($${CAP})`);
    setRoster([...roster, card]);
  };
  const remove = card => setRoster(roster.filter(c => c !== card));

  const canSave =
    !saving && name.trim().length > 0 && roster.length > 0 && !over && unowned.length === 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const data = { name: name.trim(), players: roster.map(keyOf), salary: sal };
      if (team?.id) await updateTeam(user.uid, team.id, data);
      else await saveTeam(user.uid, data);
      onSaved?.();
    } catch (e) {
      setError(e.message);
      setSaving(false);
    }
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.teams} style={{ gridTemplateColumns: '1fr' }}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <input
              type="text"
              placeholder="Team name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={40}
              style={{ flex: 1, minWidth: 0, marginRight: 8 }}
              aria-label="Team name"
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className={styles.salInfo} style={{ color: over ? 'var(--red)' : 'var(--text-muted)' }}>
                ${sal}/{CAP} · {roster.length}/{MAX}
              </span>
              <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave} title="Save team">
                {saving ? '…' : '💾'}
              </button>
              <button className={styles.saveBtn} onClick={onCancel} title="Cancel">✕</button>
            </div>
          </div>
          <div className={styles.capBar}>
            <div className={styles.capFill} style={{ width: pct + '%', background: over ? 'var(--red)' : 'var(--orange)' }} />
          </div>

          {roster.length < MIN_TO_PLAY && (
            <div className={styles.empty}>
              {roster.length === 0
                ? 'Add players from your collection below'
                : `${MIN_TO_PLAY - roster.length} more to be able to play`}
            </div>
          )}
          {unowned.length > 0 && (
            <div className={styles.empty} style={{ color: 'var(--red)' }}>
              {unowned.length === 1
                ? `${unowned[0].name} is no longer in your collection — remove it to save`
                : `${unowned.length} players are no longer in your collection — remove them to save`}
            </div>
          )}
          {error && <div className={styles.empty} style={{ color: 'var(--red)' }}>{error}</div>}

          {/* One-line chips in an auto-fill grid: the editor's roster spans the
              full width, so the sandbox's stacked rows left most of it empty
              (the user, 2026-09-09: "That's a lot of wasted space"). */}
          <div className={styles.rosterGrid}>
            {roster.map(c => {
              const missing = !ownedByKey[keyOf(c)];
              return (
                <div key={keyOf(c)} className={styles.rosterChip} style={missing ? { opacity: 0.6 } : undefined} title={missing ? `${c.name} is not in your collection` : `${c.name} · ${c.team} · S${c.speed} P${c.power} · $${c.salary}`}>
                  <span className={styles.chipName} onClick={() => open('player', c)}>
                    {c.name}{missing ? ' ⚠' : ''}
                  </span>
                  <span className={styles.chipMeta}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</span>
                  <button className={styles.chipX} onClick={() => remove(c)} aria-label={`Remove ${c.name}`}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className={styles.poolHeader}>
        <h3>Your Collection</h3>
        <span className={styles.poolCount}>{pool.length} of {owned.length} players</span>
      </div>
      {owned.length === 0 && (
        <div className={styles.empty}>No player cards yet — open a pack first.</div>
      )}
      <PoolFilters value={filters} onChange={setFilters} teams={teams} />
      <div className={styles.pool}>
        {pool.map(({ key, card, count }) => {
          const cfg = RARITY_CONFIG[getPlayerRarity(card)];
          const picked = inRoster(card);
          return (
            <PlayerCard
              key={key}
              card={card}
              highlighted={picked}
              onClick={() => open('player', card)}
              actions={
                <div style={{ display: 'flex', gap: 6, width: '100%', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 2 }}>
                    <span style={{ color: cfg.color, fontWeight: 700 }}>{cfg.label}</span>
                    <span style={{ color: 'var(--text-muted)' }}>×{count}</span>
                  </div>
                  {picked ? (
                    <button className={styles.addB} onClick={() => remove(roster.find(c => keyOf(c) === key))}>
                      − Remove
                    </button>
                  ) : (
                    <button className={styles.addA} onClick={() => add(card)}>+ Add</button>
                  )}
                </div>
              }
            />
          );
        })}
      </div>
    </div>
  );
}
