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
import { CARD_WIDTH, CARD_HEIGHT } from '../cards/CardTemplate.jsx';
import { SOURCES, DEFAULT_SOURCE, filterPlayers, stepSelection } from './players.js';
import { pruneCrops, resetCrop } from './crop.js';
import { fetchStudioState, uploadPhoto, saveCrops, isImageFile } from './api.js';
import styles from './Studio.module.css';

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

export default function Studio() {
  const [sourceKey, setSourceKey] = useState(DEFAULT_SOURCE);
  const [photos, setPhotos] = useState([]);
  const [teamOverrides, setTeamOverrides] = useState({});
  const [crops, setCrops] = useState({});
  const [query, setQuery] = useState('');
  const [missingOnly, setMissingOnly] = useState(false);
  const [selectedId, setSelectedId] = useState(SOURCES[DEFAULT_SOURCE].players[0]?.id ?? null);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [notice, setNotice] = useState(null);
  const [uploadingId, setUploadingId] = useState(null);
  const [droppingId, setDroppingId] = useState(null);
  // Bumped on every upload to force the <img> to re-request a path that did
  // not change.
  const [photoVersion, setPhotoVersion] = useState(0);

  // Callback refs rather than useRef: these effects must re-run if the element
  // they observe is ever replaced.
  const [previewEl, setPreviewEl] = useState(null);
  const [listEl, setListEl] = useState(null);

  // Only a user edit should trigger a save — loading the server's own crops
  // back must not immediately POST them again.
  const cropsDirty = useRef(false);
  // Where the selection last sat in the filtered list, so the keyboard can
  // carry on from there after a filter drops the selected player out.
  const anchorIndex = useRef(0);

  const players = SOURCES[sourceKey].players;
  const photoIds = useMemo(() => new Set(photos), [photos]);
  const visible = useMemo(
    () => filterPlayers(players, { query, missingOnly, photoIds }),
    [players, query, missingOnly, photoIds]
  );
  const selected = players.find(p => p.id === selectedId) ?? null;
  const scale = useFitScale(previewEl);

  // ── Load persisted state ──────────────────────────────────────────────────
  useEffect(() => {
    fetchStudioState()
      .then(state => {
        setPhotos(state.photos ?? []);
        setCrops(state.crops ?? {});
        setTeamOverrides(state.teamOverrides ?? {});
      })
      .catch(err =>
        setNotice({
          kind: 'error',
          text: `Could not reach the studio server (${err.message}). Nothing will save — is this page open through \`npm run dev\`?`,
        })
      );
  }, []);

  // ── Debounced crop persistence ────────────────────────────────────────────
  useEffect(() => {
    if (!cropsDirty.current) return undefined;
    setSaveStatus('saving');
    const timer = setTimeout(() => {
      saveCrops(pruneCrops(crops))
        .then(() => setSaveStatus('saved'))
        .catch(err => {
          setSaveStatus('error');
          setNotice({ kind: 'error', text: `Crop save failed: ${err.message}` });
        });
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [crops]);

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

  const updateCrop = useCallback((playerId, next) => {
    cropsDirty.current = true;
    setCrops(prev => ({ ...prev, [playerId]: next }));
  }, []);

  const handleDropFile = useCallback(async (playerId, file) => {
    if (!file) return;
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
      await uploadPhoto(playerId, file);
      // Re-read the server's photo list rather than assuming: this is what
      // flips the row's indicator and is the only confirmation the write
      // actually landed. Crops are deliberately NOT taken from the refresh —
      // a debounced local save may still be in flight.
      const state = await fetchStudioState();
      setPhotos(state.photos ?? []);
      setTeamOverrides(state.teamOverrides ?? {});
      setPhotoVersion(v => v + 1);
      setSelectedId(playerId);
      setNotice({ kind: 'ok', text: `Saved ${file.name} as ${playerId}.jpg` });
    } catch (err) {
      setNotice({ kind: 'error', text: `Upload failed for ${playerId}: ${err.message}` });
    } finally {
      setUploadingId(null);
    }
  }, []);

  const switchSource = key => {
    setSourceKey(key);
    setSelectedId(SOURCES[key].players[0]?.id ?? null);
    setMissingOnly(false);
  };

  return (
    <div className={styles.page}>
      <header className={styles.topBar}>
        <span className={styles.title}>Card Studio</span>

        <div className={styles.toggle} role="group" aria-label="Player set">
          {Object.values(SOURCES).map(source => (
            <button
              key={source.key}
              type="button"
              className={`${styles.toggleButton} ${
                source.key === sourceKey ? styles.toggleButtonActive : ''
              }`}
              aria-pressed={source.key === sourceKey}
              onClick={() => switchSource(source.key)}
            >
              {source.label} ({source.players.length})
            </button>
          ))}
        </div>

        <span className={styles.spacer} />
        <SaveIndicator status={saveStatus} />
      </header>

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
          />
        </aside>

        <section className={styles.stage}>
          <CropEditor
            card={selected}
            crop={crops[selectedId]}
            hasPhoto={selectedId ? photoIds.has(selectedId) : false}
            teamOverrides={teamOverrides}
            scale={scale}
            photoVersion={photoVersion}
            previewRef={setPreviewEl}
            onCropChange={next => updateCrop(selectedId, next)}
            onReset={() => updateCrop(selectedId, resetCrop())}
            onDropFile={handleDropFile}
          />
        </section>
      </div>
    </div>
  );
}

const SAVE_TEXT = {
  idle: 'crops saved on disk',
  saving: 'saving…',
  saved: 'crops saved',
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
