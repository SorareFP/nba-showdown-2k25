// The crop editor: the live card preview and the controls that frame its photo.
//
// The preview IS the editor — you drag the actual photo where you want it,
// inside the real card, rather than nudging a proxy widget beside it. That is
// the whole reason the studio renders the same CardTemplate the export does.
//
// All crop arithmetic lives in crop.js so it can be tested; this file only
// turns pointer events into calls on it.
import { useEffect, useRef, useState } from 'react';
import CardTemplate, { CARD_WIDTH, CARD_HEIGHT } from '../cards/CardTemplate.jsx';
import {
  normalizeCrop,
  panCrop,
  setZoom,
  zoomByWheel,
  isDefaultCrop,
  clampCropToImage,
  PHOTO_WINDOW,
  ZOOM_MIN,
  ZOOM_MAX,
} from './crop.js';
import styles from './Studio.module.css';

export default function CropEditor({
  card,
  crop,
  hasPhoto,
  teamOverrides,
  scale,
  photoVersion,
  previewRef,
  onCropChange,
  onReset,
  onDropFile,
}) {
  const surfaceRef = useRef(null);
  // The crop as of pointerdown, plus the pointer's origin. Panning from the
  // origin with the TOTAL delta (rather than applying each step) keeps
  // crop.js's rounding from accumulating over a long drag.
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dropping, setDropping] = useState(false);
  // The source image's natural size, once it has loaded, tagged with WHICH
  // photo it describes. Tagged rather than cleared by an effect because a
  // cached image can fire load before a passive effect flushes, and a stale
  // size bounding the new photo's pan is exactly the bug this is here to avoid.
  // Until it arrives, crop.js falls back to its generous hard limit.
  const [loaded, setLoaded] = useState(null);
  const photoKey = `${card?.id ?? ''}:${photoVersion ?? ''}:${hasPhoto ? 1 : 0}`;
  const photoSize = loaded?.key === photoKey ? loaded.size : null;

  const value = normalizeCrop(crop);
  const commit = next => onCropChange(clampCropToImage(next, photoSize));

  // Latest props for the native wheel listener below, which is registered once.
  const latest = useRef();
  latest.current = { crop: value, commit };

  // React's onWheel is passive, so preventDefault() inside it is ignored and
  // the page scrolls while you try to zoom. A native non-passive listener is
  // the only way to stop that.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return undefined;
    const onWheel = event => {
      event.preventDefault();
      latest.current.commit(zoomByWheel(latest.current.crop, event.deltaY));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [card?.id]);

  if (!card) {
    return (
      <>
        <div className={styles.preview} ref={previewRef}>
          <div className={styles.emptyStage}>no player selected</div>
        </div>
        <div className={styles.controls}>
          <span className={styles.controlName}>—</span>
        </div>
      </>
    );
  }

  const handlePointerDown = event => {
    if (event.button !== 0) return;
    // Capture keeps the drag alive when the cursor leaves the photo window,
    // which it constantly does. It is not essential though — a browser that
    // refuses the capture should still pan, so never let it abort the drag.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      /* no capture available; move events still arrive while over the surface */
    }
    dragRef.current = { x: event.clientX, y: event.clientY, crop: value };
    setDragging(true);
  };

  const handlePointerMove = event => {
    const start = dragRef.current;
    if (!start) return;
    commit(
      panCrop(start.crop, {
        dx: event.clientX - start.x,
        dy: event.clientY - start.y,
        scale,
      })
    );
  };

  const endDrag = event => {
    if (!dragRef.current) return;
    dragRef.current = null;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      /* nothing was captured */
    }
  };

  return (
    <>
      <div
        ref={previewRef}
        className={`${styles.preview} ${dropping ? styles.previewDropping : ''}`}
        onDragOver={event => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDragEnter={() => setDropping(true)}
        onDragLeave={event => {
          // Only clear when the pointer actually leaves the preview, not when
          // it crosses onto a child element.
          if (!event.currentTarget.contains(event.relatedTarget)) setDropping(false);
        }}
        onDrop={event => {
          event.preventDefault();
          setDropping(false);
          onDropFile(card.id, event.dataTransfer.files?.[0]);
        }}
      >
        <div
          className={styles.cardFrame}
          style={{ width: CARD_WIDTH * scale, height: CARD_HEIGHT * scale }}
        >
          <div className={styles.cardScaler} style={{ transform: `scale(${scale})` }}>
            {/* photoVersion goes INTO the photo's URL (see resolvePhotoUrl) —
                remounting the card was not enough to defeat the browser's
                image cache, because the reused bytes are not in the React
                tree. */}
            <CardTemplate
              card={card}
              crop={value}
              hasPhoto={hasPhoto}
              teamOverrides={teamOverrides}
              photoVersion={photoVersion}
              onPhotoLoad={size => setLoaded({ key: photoKey, size })}
            />
          </div>

          <div
            ref={surfaceRef}
            className={[
              styles.dragSurface,
              dragging ? styles.dragSurfaceActive : '',
              hasPhoto ? '' : styles.dragSurfaceDisabled,
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: PHOTO_WINDOW.left * scale,
              top: PHOTO_WINDOW.top * scale,
              width: PHOTO_WINDOW.width * scale,
              height: PHOTO_WINDOW.height * scale,
            }}
            title={hasPhoto ? 'Drag to pan · scroll to zoom' : 'Drop an image here'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
      </div>

      <div className={styles.controls}>
        <span className={styles.controlName}>
          {card.name}
          <br />
          <span className={styles.controlSub}>
            {card.team ?? '—'} · {hasPhoto ? 'curated photo' : 'no photo yet'}
          </span>
        </span>

        <div className={styles.zoomGroup}>
          <span className={styles.zoomLabel}>zoom</span>
          <input
            className={styles.zoomSlider}
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.01}
            value={value.zoom}
            onChange={event => commit(setZoom(value, Number(event.target.value)))}
            aria-label="Photo zoom"
          />
          <span className={styles.readout}>{value.zoom.toFixed(2)}x</span>
        </div>

        <span className={styles.readout}>
          x {value.x.toFixed(1)}% y {value.y.toFixed(1)}%
        </span>

        <button
          type="button"
          className={styles.resetButton}
          onClick={onReset}
          disabled={isDefaultCrop(value)}
        >
          Reset crop
        </button>

        <span className={styles.hint}>
          drag the photo to pan · scroll to zoom
          <br />
          <span className={styles.kbd}>↑</span> <span className={styles.kbd}>↓</span> or{' '}
          <span className={styles.kbd}>j</span> <span className={styles.kbd}>k</span> to change
          player
        </span>
      </div>
    </>
  );
}
