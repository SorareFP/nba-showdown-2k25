// THE TEAM YOU BRING — one picker for every screen that asks for it: a solo
// season, a shared season, a tournament. Three sources (the Team Builder's
// current team, a saved team, a random legal one) and a strategy deck.
//
// It reports `{ roster, deck, deckName }` upward whenever the choice changes;
// the team's NAME stays with the parent, because each screen words that field
// differently. Rosters are cards here; the league layer turns them into keys.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { randomizeTeam, MIN_TO_PLAY, MAX, capSal, ownedRoster } from '../../game/teamRules.js';
import { loadTeams } from '../../firebase/savedTeams.js';
import { loadDecks } from '../../firebase/savedDecks.js';
import { CARD_MAP } from '../../game/cards.js';
import styles from '../SeasonTab.module.css';

export default function RosterPicker({ teamA = [], collection = {}, uid, onChange, deckHint = null }) {
  const [source, setSource] = useState(teamA.length >= MIN_TO_PLAY ? 'builder' : 'random');
  const [savedId, setSavedId] = useState('');
  const [saved, setSaved] = useState([]);
  const [decks, setDecks] = useState([]);
  const [deckId, setDeckId] = useState('default');
  const [rolled, setRolled] = useState(null);

  useEffect(() => {
    if (!uid) return;
    loadTeams(uid).then(setSaved).catch(() => setSaved([]));
    loadDecks(uid).then(setDecks).catch(() => setDecks([]));
  }, [uid]);

  const ownedOnly = Object.keys(collection ?? {}).length > 0;
  const reroll = useCallback(() => setRolled(randomizeTeam([], ownedOnly, collection)), [ownedOnly, collection]);
  useEffect(() => { if (source === 'random' && !rolled) reroll(); }, [source, rolled, reroll]);

  const roster = useMemo(() => {
    if (source === 'builder') return teamA.slice(0, MAX);
    if (source === 'saved') {
      const team = saved.find(t => t.id === savedId);
      if (!team) return [];
      // Only the cards still owned — the same filter the Team Builder applies.
      const { roster: ids } = ownedRoster(team.players, collection);
      return ids.map(id => CARD_MAP[id]).filter(Boolean).slice(0, MAX);
    }
    return (rolled ?? []).slice(0, MAX);
  }, [source, teamA, saved, savedId, collection, rolled]);

  const chosen = useMemo(() => decks.find(d => d.id === deckId) ?? null, [decks, deckId]);

  // The parent's callback is usually an inline function; going through a ref
  // keeps a new identity from re-firing the report on every render.
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  useEffect(() => {
    onChangeRef.current?.({ roster, deck: chosen?.cards ?? null, deckName: chosen?.name ?? null });
  }, [roster, chosen]);

  return (
    <>
      <div className={styles.field}>
        <span className={styles.label}>Your roster</span>
        <div className={styles.choices}>
          <Choice
            on={source === 'builder'} onClick={() => setSource('builder')}
            disabled={teamA.length < MIN_TO_PLAY}
            title="Team Builder"
            sub={teamA.length ? `${teamA.length} cards · $${capSal(teamA).toLocaleString()}` : 'Nothing built yet'}
          />
          <Choice
            on={source === 'saved'} onClick={() => setSource('saved')}
            disabled={!saved.length}
            title="Saved team"
            sub={saved.length ? `${saved.length} saved` : (uid ? 'None saved' : 'Sign in to save teams')}
          />
          <Choice
            on={source === 'random'} onClick={() => setSource('random')}
            title="Random legal team"
            sub={ownedOnly ? 'Drawn from your collection' : 'Drawn from the whole pool'}
          />
        </div>
        {source === 'saved' && (
          <select className={styles.input} value={savedId} onChange={e => setSavedId(e.target.value)}>
            <option value="">Choose a team…</option>
            {saved.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
        {source === 'random' && (
          <button type="button" className={styles.ghost} onClick={reroll}>🎲 Roll another</button>
        )}
        <div className={styles.rosterPeek}>
          {roster.length
            ? `${roster.length} cards · $${capSal(roster).toLocaleString()} — ${roster.map(c => c.name).join(', ')}`
            : 'No roster yet.'}
        </div>
      </div>

      {decks.length > 0 && (
        <label className={styles.field}>
          <span className={styles.label}>Strategy deck</span>
          <select className={styles.input} value={deckId} onChange={e => setDeckId(e.target.value)}>
            <option value="default">The default fifty</option>
            {decks.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          {deckHint && <span className={styles.hint}>{deckHint}</span>}
        </label>
      )}
    </>
  );
}

export function Choice({ on, onClick, title, sub, disabled = false }) {
  return (
    <button
      type="button"
      className={`${styles.choice} ${on ? styles.choiceOn : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className={styles.choiceTitle}>{title}</span>
      <span className={styles.choiceSub}>{sub}</span>
    </button>
  );
}

export { MIN_TO_PLAY };
