// Card Studio — the tool for curating one photo per player and framing it.
//
// The loop it is built around: find the next player without a photo, drop an
// image on their row, drag the photo into place, move on. Hundreds of players,
// across many sessions, so progress is always on screen and the keyboard can
// drive the list.
//
// Everything persists through the dev-server plugin in
// scripts/studio/studioServerPlugin.js. Photos are written byte-for-byte as
// dropped; the crop is metadata saved separately, so re-framing never touches
// the source file.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PlayerList from './PlayerList.jsx';
import CropEditor from './CropEditor.jsx';
import TeamEditor from './TeamEditor.jsx';
import { CARD_WIDTH, CARD_HEIGHT } from '../cards/CardTemplate.jsx';
import {
  CURRENT_SET,
  STATS_SEASON,
  FINISHED_SET,
  FINISHED_STATS_SEASON,
  cardTreatment,
  getSet,
  setLeague,
  setPaths,
  setTreatment,
} from '../cards/sets.js';
import { SUPER_SEASON_MIN_SALARY } from '../cards/badges.js';
import {
  SOURCES,
  DEFAULT_SOURCE,
  SECONDARY_SOURCES,
  TEAMS_RESOLVED,
  STATS_GENERATED,
  filterPlayers,
  stepSelection,
  visibleSources,
} from './players.js';
import { pruneCrops, resetCrop } from './crop.js';
import { pruneTeamOverrides } from './teamTheme.js';
import { fetchStudioState, uploadPhoto, saveCrops, saveTeams, isImageFile } from './api.js';
import {
  readShowReferenceSets, writeShowReferenceSets,
  readHiddenSets, writeHiddenSets,
  readRevealedSets, writeRevealedSets,
  readAutoHide, writeAutoHide,
  hiddenSetKeys,
} from './prefs.js';
import styles from './Studio.module.css';
import RequestsPanel from './RequestsPanel.jsx';

/** Long enough that a drag saves once, short enough to feel immediate. */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Whether a keypress belongs to the focused control rather than the list.
 *
 * Not simply "is it an input": the "needs photo" checkbox does nothing with
 * arrow keys, and it is the control most likely to still hold focus when the
 * user starts stepping through the players they just filtered to.
 */
function consumesArrowKeys(target) {
  const tag = target?.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return target.type !== 'checkbox';
}

/** The id the disclosure's aria-controls points at. Stable, so it can. */
const REFERENCE_GROUP_ID = 'studio-reference-sets';

export default function Studio() {
  const [sourceKey, setSourceKey] = useState(DEFAULT_SOURCE);
  // Is the selector's reference group open? Read from localStorage ONCE, as a
  // lazy initialiser rather than in an effect, so the first paint is already
  // the arrangement the user left — a group that flickers open and then folds
  // shut is worse than one that never folded.
  const [showReference, setShowReference] = useState(readShowReferenceSets);
  const [photos, setPhotos] = useState([]);
  // Every scope's photo ids, for the set bar's auto-hide — see the server's
  // `allPhotos`. Only the ACTIVE set's list drives the roster view.
  const [allPhotos, setAllPhotos] = useState({});
  const [hiddenSets, setHiddenSets] = useState(readHiddenSets);
  const [revealedSets, setRevealedSets] = useState(readRevealedSets);
  const [autoHide, setAutoHide] = useState(readAutoHide);
  const [showHidden, setShowHidden] = useState(false);
  // playerId -> the extension that player's photo is stored under (".jpeg",
  // ".png", ...). Only the server can know it, so it comes down with the rest
  // of the state; see photoExtMap in scripts/studio/studioServerPlugin.js. Kept
  // separate from `photos` so every "has a photo?" check stays a Set lookup on
  // ids — this map answers a different question, "which file", and only the
  // card preview asks it.
  const [photoExts, setPhotoExts] = useState({});
  const [teamOverrides, setTeamOverrides] = useState({});
  const [crops, setCrops] = useState({});
  const [query, setQuery] = useState('');
  // The Free Agent request queue (RequestsPanel), over the studio.
  const [showRequests, setShowRequests] = useState(false);
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(SOURCES[DEFAULT_SOURCE].players[0]?.id ?? null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [notice, setNotice] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [droppingId, setDroppingId] = useState(null);
  // playerId -> cache-busting token, set fresh on every successful upload so
  // the <img> re-requests a path that did not change. Per player rather than
  // one global counter: a token that moves for everybody re-downloads every
  // photo the session touches. Kept OUT of the server state so the refresh
  // that follows an upload cannot wipe it.
  const [photoVersions, setPhotoVersions] = useState({});

  // Callback refs rather than useRef: these effects must re-run if the element
  // they observe is ever replaced.
  const [previewEl, setPreviewEl] = useState(null);
  const [listEl, setListEl] = useState(null);

  // Only a user edit should trigger a save — loading the server's own crops
  // back must not immediately POST them again. Same for team overrides, and it
  // matters more there: a spurious first save would write a pruned copy of the
  // file over the file it was just read from.
  const cropsDirty = useRef(false);
  const teamsDirty = useRef(false);
  // Where the selection last sat in the filtered list, so the keyboard can
  // carry on from there after a filter drops the selected player out.
  const anchorIndex = useRef(0);

  const source = SOURCES[sourceKey];
  const players = source.players;
  // The SET every write in this session belongs to. Not the same thing as the
  // source key: `pool` is the 2026-27 set and `cards` is 2025-26, while the two
  // special sets are keyed by their own ids. Everything that touches the server
  // takes this, never the key.
  const activeSet = source.set;
  const activeSetName = getSet(activeSet)?.name ?? activeSet;
  const activeTreatment = setTreatment(activeSet);
  // The reference set is preview-only. Not a style choice: both lists derive
  // ids with the same rule and share one photo store, so an upload made while
  // the finished set is on screen writes into the 2026-27 set under a name
  // that 2025-26 player happens to share. See SOURCES in players.js.
  const editable = source.editable !== false;
  // What the selector actually renders, split into the two groups it draws.
  // Both halves come out of ONE tested function, so the group a set lands in
  // and the rule that decides whether it is offered at all cannot disagree.
  const offered = useMemo(
    () => visibleSources({ showSecondary: showReference, activeKey: sourceKey }),
    [showReference, sourceKey]
  );
  /**
   * A source is COMPLETE when every player it lists has a photo in its set's
   * folder. Asked per SOURCE rather than per set because two sources can share
   * one folder, and the question is about this list.
   */
  const completeKeys = useMemo(() => {
    const done = [];
    for (const src of Object.values(SOURCES)) {
      const have = new Set(allPhotos[src.set] ?? []);
      if (!have.size || !src.players.length) continue;
      if (src.players.every(p => have.has(p.id))) done.push(src.key);
    }
    return done;
  }, [allPhotos]);

  const hidden = useMemo(
    () => hiddenSetKeys({ hidden: hiddenSets, revealed: revealedSets, complete: completeKeys, autoHide }),
    [hiddenSets, revealedSets, completeKeys, autoHide]
  );

  // The set you are working on never disappears from under you.
  const primaryOffered = offered
    .filter(s => !s.secondary)
    .filter(s => showHidden || !hidden.has(s.key) || s.key === sourceKey);
  const secondaryOffered = offered.filter(s => s.secondary);
  const photoIds = useMemo(() => new Set(photos), [photos]);
  const visible = useMemo(
    () => filterPlayers(players, { query, missingOnly, photoIds }),
    [players, query, missingOnly, photoIds]
  );
  const selected = players.find(p => p.id === selectedId) ?? null;
  // WHAT THE CARD ON SCREEN ACTUALLY GETS, which is no longer the same as what
  // the SET declares: a Super Season card under SUPER_SEASON_MIN_SALARY prints
  // BEST SEASON and keeps its team's own palette. The chip below reads this,
  // not `activeTreatment`, because a header reading "gold-foil" over a card
  // with no gold on it is the studio lying about its own preview.
  const shownTreatment = cardTreatment(activeSet, selected?.salary, selected?.badges ?? []);
  const scale = useFitScale(previewEl);

  // ── Load persisted state, per SET ─────────────────────────────────────────
  //
  // Re-runs on every set change, and everything it loads is replaced rather
  // than merged: each set owns its own photos/, crops.json and
  // team-overrides.json under card-art/sets/{id}/, so carrying one set's crops
  // into another would show the user framing that does not exist on disk and
  // then save it there on the next keystroke.
  //
  // The dirty flags are cleared FIRST. Without that, the state this effect
  // loads counts as a user edit the moment it lands, and the debounced saver
  // writes the set it just read straight back out — harmless for crops,
  // actively destructive for team overrides, which get pruned on the way out.
  useEffect(() => {
    cropsDirty.current = false;
    teamsDirty.current = false;
    let live = true;
    fetchStudioState(activeSet)
      .then(state => {
        if (!live) return;
        setPhotos(state.photos ?? []);
      setAllPhotos(state.allPhotos ?? {});
        setAllPhotos(state.allPhotos ?? {});
        setPhotoExts(state.photoExt ?? {});
        setCrops(state.crops ?? {});
        setTeamOverrides(state.teamOverrides ?? {});
      })
      .catch(err => {
        if (!live) return;
        setNotice({
          kind: 'error',
          text: `Could not reach the studio server (${err.message}). Nothing will save — is this page open through \`npm run dev\`?`,
        });
      });
    // A set switched twice in quick succession must not let the first response
    // land after the second: the list would be one set's, the photos another's.
    return () => {
      live = false;
    };
  }, [activeSet]);

  // ── Debounced crop persistence ────────────────────────────────────────────
  useEffect(() => {
    if (!cropsDirty.current) return undefined;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      saveCrops(pruneCrops(crops), activeSet)
        .then(() => setSaveStatus('saved'))
        .catch(err => {
          setSaveStatus('error');
          setNotice({ kind: 'error', text: `Crop save failed: ${err.message}` });
        });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [crops, activeSet]);

  // ── Debounced team-override persistence ───────────────────────────────────
  //
  // Same shape and the same indicator as crops, for the same reason: colors
  // are dragged out of a picker and typed into a hex box, so the value changes
  // many times per second and only the last one is worth a write.
  //
  // pruneTeamOverrides on the way out is what makes "reset to official" stick.
  // A team whose last color was cleared has to leave the file entirely — an
  // empty `{"DEN": {}}` would still read back as a customised team.
  useEffect(() => {
    if (!teamsDirty.current) return undefined;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      saveTeams(pruneTeamOverrides(teamOverrides), activeSet)
        .then(() => setSaveStatus('saved'))
        .catch(err => {
          setSaveStatus('error');
          setNotice({ kind: 'error', text: `Team colors save failed: ${err.message}` });
        });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [teamOverrides, activeSet]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = event => {
      if (consumesArrowKeys(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      let delta = 0;
      if (event.key === 'ArrowDown' || event.key === 'j') delta = 1;
      else if (event.key === 'ArrowUp' || event.key === 'k') delta = -1;
      else return;

      event.preventDefault();
      const next = stepSelection(visible, selectedId, delta, anchorIndex.current);
      if (next) setSelectedId(next);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [visible, selectedId]);

  // Remember the selection's place while it is still in the list; once it is
  // filtered out this is the only record of where the user was.
  useEffect(() => {
    const at = visible.findIndex(p => p.id === selectedId);
    if (at !== -1) anchorIndex.current = at;
  }, [visible, selectedId]);

  // Keep the selected row on screen when the keyboard moves past the viewport.
  useEffect(() => {
    if (!listEl || !selectedId) return;
    listEl.querySelector(`[data-player-id="${selectedId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [listEl, selectedId]);

  // A file dropped anywhere but a real target would otherwise make the browser
  // navigate to it, silently throwing away the session.
  useEffect(() => {
    const swallow = event => event.preventDefault();
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  // Success notices are informational; errors stay until something replaces
  // them, because a failed upload the user did not notice is the bad case.
  useEffect(() => {
    if (notice?.kind !== 'ok') return undefined;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const updateCrop = useCallback(
    (playerId, next) => {
      // Same reason as handleDropFile: the crops file belongs to the 2026-27
      // set, and its keys are player ids the two lists share.
      if (!editable) return;
      cropsDirty.current = true;
      setCrops(prev => ({ ...prev, [playerId]: next }));
    },
    [editable]
  );

  // The whole map, not one team: TeamEditor works out the next map with the
  // pure helpers in teamTheme.js, and this only marks it as the user's doing
  // so the effect above is allowed to write it.
  const updateTeamOverrides = useCallback(next => {
    teamsDirty.current = true;
    setTeamOverrides(next);
  }, []);

  const handleDropFile = useCallback(async (playerId, file) => {
    if (!file) return;
    // The row and the preview already refuse the drag in a read-only set; this
    // is the client's last line of defence, and the server's /__studio/photo
    // route refuses it a third time. Three checks because the id spaces of the
    // sets overlap BY DESIGN — every set derives ids with the same rule — so a
    // drop that slipped through would not error, it would silently overwrite
    // another set's art for a player who happens to share the name.
    if (!editable) {
      setNotice({
        kind: 'error',
        text: `The ${activeSetName} set is finished and read-only here — nothing was saved. Switch to a set you can edit to add photos.`,
      });
      return;
    }
    if (!isImageFile(file)) {
      setNotice({
        kind: 'error',
        text: `"${file.name || 'that file'}" is not an image — nothing was saved.`,
      });
      return;
    }
    setUploadingId(playerId);
    setNotice(null);
    try {
      await uploadPhoto(playerId, file, activeSet);
      // Re-read the server's photo list rather than assuming: this is what
      // flips the row's indicator and is the only confirmation the write
      // actually landed. ONLY the photo list is taken from the refresh —
      // crops and team colors may have a debounced local save still in
      // flight, and adopting the server's older copy here would both discard
      // that edit and then persist the stale value over it.
      const state = await fetchStudioState(activeSet);
      setPhotos(state.photos ?? []);
      // Travels with the photo list for the same reason: an upload that lands
      // as {id}.jpg beside a hand-saved {id}.jpeg changes which file the
      // preview should point at, and only the server can see that.
      setPhotoExts(state.photoExt ?? {});
      // After the refresh, so the new bytes are already on disk when the
      // browser goes back for them. Date.now() rather than a counter: two
      // uploads of the same player in one session must not be able to reuse a
      // token, which is exactly the case that looked "fixed" before.
      setPhotoVersions(prev => {
        const previous = prev[playerId] ?? 0;
        const now = Date.now();
        return { ...prev, [playerId]: now > previous ? now : previous + 1 };
      });
      setSelectedId(playerId);
      setNotice({ kind: 'ok', text: `Saved ${file.name} as ${playerId}.jpg in the ${activeSetName} set` });
    } catch (err) {
      setNotice({ kind: 'error', text: `Upload failed for ${playerId}: ${err.message}` });
    } finally {
      setUploadingId(null);
    }
  }, [editable, activeSet, activeSetName]);

  const switchSource = key => {
    setSourceKey(key);
    setSelectedId(SOURCES[key].players[0]?.id ?? null);
    setMissingOnly(false);
  };

  /** Put a set away by hand, or pull it back out — the override auto-hide needs. */
  const toggleHidden = useCallback(key => {
    const isHidden = hidden.has(key);
    const nextHidden = isHidden ? hiddenSets.filter(k => k !== key) : [...hiddenSets, key];
    const nextRevealed = isHidden ? [...revealedSets, key] : revealedSets.filter(k => k !== key);
    setHiddenSets(nextHidden); writeHiddenSets(nextHidden);
    setRevealedSets(nextRevealed); writeRevealedSets(nextRevealed);
    // Never strand the curator on a set that just vanished.
    if (!isHidden && key === sourceKey) switchSource(DEFAULT_SOURCE);
  }, [hidden, hiddenSets, revealedSets, sourceKey, switchSource]);

  const toggleAutoHide = useCallback(() => {
    const next = !autoHide;
    setAutoHide(next); writeAutoHide(next);
  }, [autoHide]);

  /**
   * Opens and closes the reference group, and remembers which.
   *
   * CLOSING IT WHILE ONE OF ITS SETS IS ACTIVE ALSO LEAVES THAT SET. Without
   * that, the button is dead in exactly the state a user is most likely to
   * press it: they opened the group, looked at a finished card, and now want it
   * out of the way again — and the one set the group cannot hide is the one
   * they are looking at. Returning to the set being built is what "put this
   * away" means here, it costs nothing (the reference set is read-only, so
   * there is no edit to lose), and it keeps the collapsed state honest: closed
   * means closed.
   *
   * The preference is written from the handler rather than from an effect on
   * `showReference`, so a mount never writes — the studio only records a choice
   * the user actually made.
   */
  const toggleReference = () => {
    const next = !showReference;
    setShowReference(next);
    writeShowReferenceSets(next);
    if (!next && SOURCES[sourceKey]?.secondary) switchSource(DEFAULT_SOURCE);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <span className={styles.title}>Card Studio</span>
        <button type="button" className={styles.setBadge} onClick={() => setShowRequests(true)} title="Free Agent requests">
          Requests
        </button>

        {/* Which set this session writes to — the ACTIVE one, not a constant.
            There are four now and each owns its photos, crops and team colours
            under its own directory, so this badge naming a fixed season while
            the user worked in another set would be the same confusion that made
            it necessary in the first place (it used to read "set 2026-27" beside
            a "2025-26 pool", and the user concluded the set they were building
            could not be edited). It names the directory it is writing to. */}
        <span
          className={styles.setBadge}
          title={
            `Everything you save is written to ${setPaths(activeSet).root}/ — the ` +
            `${activeSetName} set, and nowhere else. ` +
            (activeSet === CURRENT_SET || activeSet === FINISHED_SET
              ? `Its stats come from the ${activeSet === CURRENT_SET ? STATS_SEASON : FINISHED_STATS_SEASON} ` +
                'season: a set is named for the season it will be PLAYED in and printed with the ' +
                'numbers from the season before.'
              : 'A card TYPE rather than a season — every card in it is one player, one season, ' +
                'chosen by rule. See the set button for which rule.')
          }
        >
          {editable ? 'Building' : 'Viewing'} the {activeSetName} set
        </span>

        {/* Only on a set that has one. Says what the look IS, because the whole
            point of a treatment is that the card should be recognisable across
            the table before anyone reads it — and, on a set that TIERS, which
            side of the line the card in front of you is on. Flipping through
            210 Super Season cards, that is the question this chip answers. */}
        {activeTreatment && (
          <span
            className={styles.setBadge}
            title={
              `This set carries the "${activeTreatment}" treatment, composed on top of each team's ` +
              'own colours rather than replacing them (src/cards/treatments.js). It is a static ' +
              'gradient, so it survives the PNG export, and it is only ever allowed to spend ' +
              'contrast the untreated card already had.' +
              (shownTreatment
                ? ''
                : ` This card is under $${SUPER_SEASON_MIN_SALARY}, so it prints BEST SEASON in the ` +
                  "team's accent and takes no treatment at all — see SUPER_SEASON_MIN_SALARY in " +
                  'src/cards/badges.js.')
            }
          >
            {shownTreatment ?? `no foil · under $${SUPER_SEASON_MIN_SALARY}`}
          </span>
        )}

        {/* Only when the generated team file is missing. Without it 45 players
            render on the grey no-team theme, which looks like a template bug
            rather than the missing data it is — say so, and say what fixes it. */}
        {!TEAMS_RESOLVED && (
          <span
            className={styles.setBadge}
            title="card-data/generated/player-teams-2026.json is missing — run `node scripts/cardgen/generateTeams.js`. Until then, traded players show a 2TM/3TM code and no team colors."
          >
            teams unresolved
          </span>
        )}

        {/* The stat badge is ALWAYS shown once numbers exist, and says
            "provisional" rather than anything reassuring. A card that renders a
            complete stat line reads as finished — that is what a card is for —
            and these numbers are a first pass: the shooting and impact stats
            come from the season that really happened, but the charts are still
            synthesized from season rates rather than real game logs. The badge
            is the one place that distinction is visible while looking at the
            card. */}
        <span
          className={styles.setBadge}
          title={
            STATS_GENERATED
              ? "Every number on these cards is PROVISIONAL, from card-data/generated/cards-2026-27.json. Shot Line, the Paint/3PT boosts, Def Boost and Speed/Power come from dunksandthrees' ACTUAL 2025-26 season; the charts are still synthesized from PREDICTED per-100 rates rather than real game logs. Re-run `node scripts/cardgen/generateCards.js` to regenerate."
              : 'card-data/generated/cards-2026-27.json is missing — run `node scripts/cardgen/generateCards.js`. Until then every stat renders as a placeholder dash.'
          }
        >
          {STATS_GENERATED ? 'provisional numbers' : 'no stats yet'}
        </span>

        {/* Each option leads with the SET it is, so the question "which of
            these is the set I'm building?" is answered by reading, not by
            knowing which season the stats came from. The stats season is the
            second line, one size down; the full explanation is on hover.

            TWO GROUPS, because six equal buttons stopped being a list of
            choices and became a wall. The first holds the sets actually being
            curated; the second is the finished reference set, folded away
            behind a disclosure and remembered across reloads. Deliberately NOT
            removed: it is the only list with a complete stat line for every
            player, so it is how the template gets judged against what was
            really printed. Out of the way, one click deep, is the whole ask. */}
        <div className={styles.toggle} role="group" aria-label="Which set to work on">
          {primaryOffered.map(source => (
            <span key={source.key} className={styles.toggleItem}>
              <button
                type="button"
                className={`${styles.toggleButton} ${
                  source.key === sourceKey ? styles.toggleButtonActive : ''
                } ${hidden.has(source.key) ? styles.toggleButtonHidden : ''}`}
                aria-pressed={source.key === sourceKey}
                data-source={source.key}
                title={source.hint}
                onClick={() => switchSource(source.key)}
              >
                {source.label}
                <span className={styles.toggleSub}>
                  {completeKeys.includes(source.key) ? '✓ complete' : source.sub}
                </span>
              </button>
              <button
                type="button"
                className={styles.hideSet}
                data-hidden={hidden.has(source.key) ? '' : undefined}
                aria-label={hidden.has(source.key) ? `Show ${source.label}` : `Hide ${source.label}`}
                title={
                  hidden.has(source.key)
                    ? 'Put this set back in the bar. Hiding is only a view — its photos and crops are untouched on disk.'
                    : 'Put this set away. It comes back from "Hidden" whenever a photo needs re-cropping.'
                }
                onClick={() => toggleHidden(source.key)}
              >
                {hidden.has(source.key) ? '+' : '×'}
              </button>
            </span>
          ))}
        </div>

        {/* The disclosure and the sets it governs, kept in one flex box so a
            wrapping top bar cannot break the control away from what it opens.
            Rendered only if there is something behind it — `secondary` is a
            declared field, and a build with none of it set should show no
            vestigial control. */}
        {hidden.size > 0 && (
          <div className={styles.referenceGroup}>
            <button
              type="button"
              className={`${styles.disclosure} ${showHidden ? styles.disclosureOpen : ''}`}
              aria-expanded={showHidden}
              onClick={() => setShowHidden(v => !v)}
              title={
                'Sets you have put away, plus any that auto-hid when every card got a photo. ' +
                'Nothing is lost — open this to pull one back and re-crop.'
              }
            >
              {showHidden ? 'Hide finished' : `Hidden (${hidden.size})`}
            </button>
            {showHidden && (
              <button
                type="button"
                className={styles.disclosure}
                aria-pressed={autoHide}
                onClick={toggleAutoHide}
                title="Whether a set disappears from the bar on its own once every card in it has a photo."
              >
                {autoHide ? 'Auto-hide: on' : 'Auto-hide: off'}
              </button>
            )}
          </div>
        )}

        {SECONDARY_SOURCES.length > 0 && (
          <div className={styles.referenceGroup}>
            <button
              type="button"
              className={`${styles.disclosure} ${
                showReference ? styles.disclosureOpen : ''
              }`}
              aria-expanded={showReference}
              aria-controls={REFERENCE_GROUP_ID}
              data-reference-open={showReference}
              onClick={toggleReference}
              title={
                showReference
                  ? 'Hide the finished reference set again. It stays one click away — it is ' +
                    'the only list with a complete stat line for every player, so it is how ' +
                    'the template gets compared against the cards that were actually printed.'
                  : 'Show the finished reference set — the printed cards, read-only, kept out ' +
                    'of the way because comparing against them is an occasional job. This ' +
                    'choice is remembered across reloads.'
              }
            >
              <span className={styles.disclosureCaret} aria-hidden="true">
                {showReference ? '▾' : '▸'}
              </span>
              reference
            </button>

            {/* Always in the DOM so aria-controls points at something real;
                hidden by a class rather than by not rendering. */}
            <div
              id={REFERENCE_GROUP_ID}
              className={`${styles.toggle} ${styles.toggleReference} ${
                secondaryOffered.length ? '' : styles.toggleHidden
              }`}
              role="group"
              aria-label="Reference sets"
            >
              {secondaryOffered.map(source => (
                <button
                  key={source.key}
                  type="button"
                  className={`${styles.toggleButton} ${
                    source.key === sourceKey ? styles.toggleButtonActive : ''
                  }`}
                  aria-pressed={source.key === sourceKey}
                  data-source={source.key}
                  title={source.hint}
                  onClick={() => switchSource(source.key)}
                >
                  {source.label}
                  <span className={styles.toggleSub}>{source.sub}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <span className={styles.spacer} />
        <SaveIndicator status={saveStatus} />
      </header>

      {/* Says WHY the tool has gone quiet, in one line, before the user
          discovers it by dropping a photo that does nothing. */}
      {!editable && (
        <div className={styles.readOnlyBar} role="status">
          Read-only — the {activeSetName} set is finished. It is here to preview the template with
          real stats; photos and crops save only in a set you can edit.
        </div>
      )}

      {notice && (
        <div
          className={`${styles.notice} ${
            notice.kind === 'error' ? styles.noticeError : styles.noticeOk
          }`}
          role="status"
        >
          <span>{notice.text}</span>
          <span className={styles.spacer} />
          <button type="button" className={styles.noticeDismiss} onClick={() => setNotice(null)}>
            dismiss
          </button>
        </div>
      )}

      {showRequests && <RequestsPanel onClose={() => setShowRequests(false)} />}
      <div className={styles.body}>
        <aside className={styles.sidebar}>
          <PlayerList
            players={players}
            visible={visible}
            photoIds={photoIds}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onDropFile={handleDropFile}
            droppingId={droppingId}
            onDropTargetChange={setDroppingId}
            uploadingId={uploadingId}
            query={query}
            onQueryChange={setQuery}
            missingOnly={missingOnly}
            onMissingOnlyChange={setMissingOnly}
            listRef={setListEl}
            editable={editable}
          />
        </aside>

        <section className={styles.stage}>
          <CropEditor
            card={selected}
            crop={crops[selectedId]}
            hasPhoto={selectedId ? photoIds.has(selectedId) : false}
            photoExt={selectedId ? photoExts[selectedId] : undefined}
            set={source.set}
            template={source.template}
            teamOverrides={teamOverrides}
            scale={scale}
            photoVersion={selectedId ? photoVersions[selectedId] : undefined}
            previewRef={setPreviewEl}
            onCropChange={next => updateCrop(selectedId, next)}
            onReset={() => updateCrop(selectedId, resetCrop())}
            onDropFile={handleDropFile}
            editable={editable}
          />

          {/* Not gated on `editable`. Photos and crops are per-player and the
              NBA lists share player ids, which is what made them unsafe to
              edit from the reference set. A team's colors are not: the panel
              names the franchise it is writing, and editing colours while
              judging the template against real stats is the point.

              The LEAGUE is passed for the same reason the card takes it. Nine
              abbreviations name a different franchise in each table, so
              without it this panel would offer the Raptors' colours under a
              Toronto Tempo card and write the override under the wrong key. */}
          <TeamEditor
            team={selected?.team}
            league={setLeague(activeSet)}
            overrides={teamOverrides}
            onChange={updateTeamOverrides}
          />
        </section>
      </div>
    </div>
  );
}

// One indicator for both files. It answers "is my work on disk", and the user
// does not care which of the two just wrote — naming crops here would make the
// team editor look like it saves nothing.
const SAVE_TEXT = {
  idle: 'saved on disk',
  saving: 'saving…',
  saved: 'saved',
  error: 'save failed',
};

function SaveIndicator({ status }) {
  const tone =
    status === 'saving'
      ? styles.saveSaving
      : status === 'saved'
        ? styles.saveSaved
        : status === 'error'
          ? styles.saveError
          : '';
  return (
    <span className={`${styles.save} ${tone}`} role="status" data-save-status={status}>
      <span className={styles.saveDot} />
      {SAVE_TEXT[status]}
    </span>
  );
}

/**
 * Scale that fits a whole 843x1181 card into the preview area.
 *
 * Computed rather than chosen from a menu because the card is taller than most
 * of the window once the chrome is accounted for, and the one thing this tool
 * must always show is the entire card — a photo framed against a cropped-off
 * preview is framed wrong.
 */
function useFitScale(element) {
  const [scale, setScale] = useState(0.45);

  useEffect(() => {
    if (!element) return undefined;
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      const PADDING = 28; // .preview's own padding, both sides
      const fit = Math.min(
        (width - PADDING) / CARD_WIDTH,
        (height - PADDING) / CARD_HEIGHT
      );
      const next = Math.round(Math.max(0.2, Math.min(1, fit)) * 1000) / 1000;
      // Ignore sub-pixel churn so an observed resize can't feed back into
      // itself through the card frame's size.
      setScale(prev => (Math.abs(prev - next) < 0.005 ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return scale;
}
