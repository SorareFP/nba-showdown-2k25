// The studio's left panel: who is in the set, who still needs a photo, and the
// drop target for each one.
//
// Purely presentational — every piece of state it shows is a prop, so the list
// logic it renders (progress, filtering) is tested in players.test.js and the
// markup it produces is tested in PlayerList.test.js without a DOM.
//
// A photo is dropped ON THE ROW rather than only on a shared drop zone. That
// removes a whole step from the loop this tool exists for: find the player,
// drop the photo, next. No select-then-drop, and no chance of landing a photo
// on whoever happened to be selected.
import { photoProgress } from './players.js';
import styles from './Studio.module.css';

export default function PlayerList({
  players,
  visible,
  photoIds,
  selectedId,
  onSelect,
  onDropFile,
  droppingId,
  onDropTargetChange,
  uploadingId,
  query,
  onQueryChange,
  missingOnly,
  onMissingOnlyChange,
  listRef,
  // False for the finished reference set, whose rows must not accept a photo —
  // its player ids collide with the set being built. Withholding the drag
  // handlers is what makes a row stop being a drop target at all: without a
  // dragover preventDefault the browser refuses the drop itself.
  editable = true,
}) {
  const progress = photoProgress(players, photoIds);
  const pct = progress.total ? Math.round((progress.withPhoto / progress.total) * 100) : 0;

  return (
    <>
      <div className={styles.listHead}>
        <div className={styles.progressRow}>
          <span className={styles.progressCount} data-testid="photo-progress">
            {progress.withPhoto} / {progress.total} photos
          </span>
          <span className={styles.progressLabel}>{progress.missing} to go</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${pct}%` }} />
        </div>

        <div className={styles.filterRow}>
          <input
            className={styles.filterInput}
            placeholder="Filter name, team, position…"
            value={query}
            onChange={e => onQueryChange(e.target.value)}
            aria-label="Filter players"
          />
          <label className={styles.checkbox} title="Show only players without a photo">
            <input
              type="checkbox"
              checked={missingOnly}
              onChange={e => onMissingOnlyChange(e.target.checked)}
            />
            needs photo
          </label>
        </div>
      </div>

      <ul className={styles.list} role="listbox" aria-label="Players" ref={listRef}>
        {visible.length === 0 && <li className={styles.rowEmpty}>no players match that filter</li>}
        {visible.map(player => {
          const hasPhoto = photoIds.has(player.id);
          return (
            <li key={player.id} role="option" aria-selected={player.id === selectedId}>
              <button
                type="button"
                data-player-id={player.id}
                data-has-photo={hasPhoto ? 'true' : 'false'}
                className={[
                  styles.row,
                  player.id === selectedId ? styles.rowSelected : '',
                  player.id === droppingId ? styles.rowDropping : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onSelect(player.id)}
                // preventDefault on dragover is what makes an element a valid
                // drop target at all — without it the browser navigates to the
                // dropped file instead. Read-only rows therefore get no
                // handlers rather than handlers that decline: the row stops
                // lighting up, and the browser's own refusal is the feedback.
                onDragOver={
                  editable
                    ? e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'copy';
                      }
                    : undefined
                }
                onDragEnter={
                  editable
                    ? e => {
                        e.preventDefault();
                        onDropTargetChange(player.id);
                      }
                    : undefined
                }
                onDragLeave={editable ? () => onDropTargetChange(null) : undefined}
                onDrop={
                  editable
                    ? e => {
                        e.preventDefault();
                        onDropTargetChange(null);
                        onDropFile(player.id, e.dataTransfer.files?.[0]);
                      }
                    : undefined
                }
              >
                <span
                  className={`${styles.dot} ${hasPhoto ? styles.dotFilled : ''}`}
                  aria-hidden="true"
                />
                <span className={styles.rowName}>{player.name}</span>
                <span className={uploadingId === player.id ? styles.rowBusy : styles.rowMeta}>
                  {uploadingId === player.id ? 'saving…' : `${player.team ?? '—'} ${player.pos ?? ''}`}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className={styles.listFoot}>
        <span>
          showing {visible.length} of {players.length}
        </span>
        <span data-testid="list-foot-hint">
          {editable ? 'drop an image on a row' : 'read-only — preview only'}
        </span>
      </div>
    </>
  );
}
