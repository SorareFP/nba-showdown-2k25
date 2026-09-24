// THE PHOTO HUNT, LIVE, IN THE STUDIO (2026-09-24).
//
// The published Photo Hunt page is a snapshot: it is right the moment it is
// built and drifts with every photo dropped in here (the user: "it still looks
// goofed"). This is the same list read from the studio's own state — every
// card owed a photo in every set you can edit, by the rule the page reads too
// (photoNeeds.js), with the same image search and uniform era (photoSearch.js).
// Drop an image on a row and it is saved into that card's set on the spot;
// Open jumps to the card in its set for cropping.
import { useMemo, useState } from 'react';
import { photoState, needsPhoto } from './photoNeeds.js';
import { huntTarget, stratSearchUrl } from './photoSearch.js';
import { uploadPhoto, isImageFile } from './api.js';
import { DORMANT_KEYS } from '../game/cardSets.js';
import s from './PhotoHuntPanel.module.css';

/**
 * The owed cards, grouped by source: every editable, primary source in
 * SOURCES order, each card once per set (two sources can share a folder).
 */
export function huntRows(sources, { allPhotos = {}, allPlaceholders = {}, dormantKeys = DORMANT_KEYS } = {}) {
  const seen = new Set();
  const groups = [];
  for (const src of Object.values(sources)) {
    if (src.secondary || src.editable === false || !src.players?.length) continue;
    const photoIds = new Set(allPhotos[src.set] ?? []);
    const placeholders = new Set(allPlaceholders[src.set] ?? []);
    const rows = [];
    for (const p of src.players) {
      const key = `${src.set}:${p.id}`;
      if (seen.has(key)) continue;
      const state = photoState(src.set, p.id, { photoIds, placeholders, dormantKeys });
      if (!needsPhoto(state)) continue;
      seen.add(key);
      if (src.template === 'strat') {
        rows.push({ id: p.id, name: p.name, when: p.team, where: p.pos, era: p.rarity ?? '', url: stratSearchUrl(p), state });
      } else {
        const t = huntTarget(src.set, p);
        rows.push({ id: p.id, name: p.name, when: t.label, where: t.code, era: t.era, url: t.url, state });
      }
    }
    if (rows.length) groups.push({ key: src.key, set: src.set, label: src.label ?? src.key, rows });
  }
  return groups;
}

export default function PhotoHuntPanel({ sources, allPhotos, allPlaceholders, onOpen, onUploaded, onClose }) {
  const groups = useMemo(() => huntRows(sources, { allPhotos, allPlaceholders }), [sources, allPhotos, allPlaceholders]);
  const total = groups.reduce((n, g) => n + g.rows.length, 0);
  const [dropping, setDropping] = useState(null);
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);

  const drop = async (set, id, file) => {
    setDropping(null);
    if (!file) return;
    if (!isImageFile(file)) { setNote({ kind: 'error', text: `${file.name} is not an image.` }); return; }
    setBusy(`${set}:${id}`);
    try {
      await uploadPhoto(id, file, set);
      setNote({ kind: 'ok', text: `Saved ${file.name} as ${id} in ${set}.` });
      await onUploaded?.(set, id);
    } catch (err) {
      setNote({ kind: 'error', text: `Upload failed for ${id}: ${err.message}` });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.box} role="dialog" aria-label="Photo Hunt">
        <header className={s.head}>
          <h2 className={s.title}>Photo Hunt</h2>
          <span className={s.muted} data-testid="hunt-total">{total} card{total === 1 ? '' : 's'} still owed a photo · live</span>
          <span className={s.spacer} />
          <nav className={s.toc}>
            {groups.map(g => <a key={g.key} href={`#hunt-${g.key}`}>{g.label.replace(/ · .*$/, '')} {g.rows.length}</a>)}
          </nav>
          <button type="button" className={s.ghost} onClick={onClose}>Close</button>
        </header>
        <p className={s.muted}>
          Search opens Google Images tuned to the season and uniform. Drop an image on a row to save it into that card's set;
          Open takes you to the card to crop it. Placeholder art counts as owed; dormant Throwbacks do not.
        </p>
        {note && <p className={note.kind === 'error' ? s.err : s.ok}>{note.text}</p>}
        {total === 0 && <p className={s.empty}>Every card you can edit has its photo.</p>}
        {groups.map(g => (
          <section key={g.key} id={`hunt-${g.key}`} className={s.group}>
            <h3 className={s.groupTitle}>{g.label.replace(/ · .*$/, '')} <span className={s.count}>{g.rows.length}</span></h3>
            <ul className={s.list}>
              {g.rows.map(r => {
                const k = `${g.set}:${r.id}`;
                return (
                  <li key={r.id}
                    className={`${s.row} ${dropping === k ? s.rowDrop : ''}`}
                    data-hunt-row={k}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
                    onDragEnter={e => { e.preventDefault(); setDropping(k); }}
                    onDragLeave={() => setDropping(d => (d === k ? null : d))}
                    onDrop={e => { e.preventDefault(); drop(g.set, r.id, e.dataTransfer.files?.[0]); }}
                  >
                    <span className={s.name}>{r.name}</span>
                    <span className={s.when}>{r.when}</span>
                    <span className={s.where}><b>{r.where}</b> {r.era}</span>
                    <span className={s.tag}>{busy === k ? 'saving…' : r.state === 'placeholder' ? 'placeholder art' : ''}</span>
                    <a className={s.search} href={r.url} target="_blank" rel="noopener noreferrer">🔎 Search</a>
                    <button type="button" className={s.ghost} onClick={() => onOpen(g.key, r.id)}>Open</button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
