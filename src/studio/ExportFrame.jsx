// The batch export's render surface: exactly one CardTemplate, full size, no
// studio chrome. scripts/studio/export.js drives a headless browser through
// this page one card at a time and screenshots the card element.
//
// ── THE SET COMES FROM THE URL, AND THAT IS THE LANDMINE DEFUSED ────────────
//
// CardTemplate takes a required `set` prop and hidesEmptyRows(set), the season
// line, the badge and the treatment all key off it. An exporter that assumed
// CURRENT_SET would render every special set's cards in base-set clothes — the
// exact bug resolvePhotoUrl once had — so the set is carried in the URL and
// passed through untouched, and the card list is the SAME `SOURCES` the studio
// shows, awards and badges already joined.
import { useEffect, useState } from 'react';
import CardTemplate from '../cards/CardTemplate.jsx';
import CardBack from '../cards/CardBack.jsx';
import StratTemplate from '../cards/StratTemplate.jsx';
import { SOURCES } from './players.js';
import { fetchStudioState, teamsUrl } from './api.js';

export default function ExportFrame() {
  const params = new URLSearchParams(location.search);
  const set = params.get('set');
  const id = params.get('id');
  const [state, setState] = useState(null);
  const [photoDone, setPhotoDone] = useState(false);

  // SOURCES keys the base set as `pool` and the reference as `cards`, while
  // the URL (and CardTemplate) speak SET IDS — so resolve by each source's
  // declared `set` when the key itself doesn't match. Keying directly was the
  // bug that silently skipped all 354 base cards on the first full export.
  const source = SOURCES[set] ?? Object.values(SOURCES).find(s => s.set === set) ?? null;
  const card = source?.players.find(c => c.id === id) ?? null;

  useEffect(() => {
    if (!card) return;
    (async () => {
      const [studio, teams] = await Promise.all([
        fetchStudioState(set),
        fetch(teamsUrl(set)).then(r => (r.ok ? r.json() : {})).catch(() => ({})),
      ]);
      setState({
        hasPhoto: (studio.photos ?? []).includes(id),
        photoExt: (studio.photoExt ?? {})[id],
        crop: (studio.crops ?? {})[id],
        teamOverrides: teams ?? {},
      });
    })();
  }, [set, id]);

  // ?back=1 — THE CARD BACK, not a card. It exports through this same page so
  // it lands at exactly the 843x1181 the faces do; a back rasterised any other
  // way would not sit flush behind them in the pack stack. It needs no studio
  // state and no photo, so it is ready the moment it mounts.
  if (params.get('back')) {
    // ?league=wnba — the same back with the two-tone ball and the league's own
    // name. One page rather than two, so the two backs cannot drift apart.
    const league = (params.get('league') ?? 'NBA').toUpperCase();
    return (
      <div id="export-root" data-export-ready="1">
        <CardBack league={league} title={league === 'WNBA' ? 'WNBA SHOWDOWN' : 'NBA SHOWDOWN'} />
      </div>
    );
  }

  if (!set || !id) return <div id="export-error">missing ?set= or ?id=</div>;
  if (!card) return <div id="export-error">no card {id} in set {set}</div>;
  if (!state) return <div id="export-loading">loading…</div>;

  // Ready when the photo has painted — or immediately when there is none, so
  // a photo-less card exports its NO PHOTO frame instead of hanging the run.
  const ready = state.hasPhoto ? photoDone : true;
  return (
    <div id="export-root" data-export-ready={ready ? '1' : '0'}>
      {/* Strategy cards render through their own template — same prop names,
          so the exporter needs no other special case. */}
      {source?.template === 'strat' ? (
        <StratTemplate
          card={card}
          set={set}
          crop={state.crop}
          hasPhoto={state.hasPhoto}
          photoExt={state.photoExt}
          onPhotoLoad={() => setPhotoDone(true)}
        />
      ) : (
        <CardTemplate
          card={card}
          set={set}
          crop={state.crop}
          hasPhoto={state.hasPhoto}
          photoExt={state.photoExt}
          teamOverrides={state.teamOverrides}
          onPhotoLoad={() => setPhotoDone(true)}
        />
      )}
    </div>
  );
}
