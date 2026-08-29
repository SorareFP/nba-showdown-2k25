// Card Studio shell.
//
// Deliberately thin at this stage: pick a player, see the real CardTemplate
// render. The photo drop zone, crop editor and team color editor land in later
// tasks and hang off the same `state` object this already loads.
//
// It reads from the shipped 306-card set (src/game/cards.js) rather than the
// 2025-26 pool on purpose: those cards have complete chart / Speed / Power /
// salary / shot-line data, which is the only way to see whether the template
// actually renders every field. The new pool has names and teams and nothing
// else yet, so it would exercise only the placeholder paths.
import { useEffect, useMemo, useState } from 'react';
import CardTemplate, { CARD_WIDTH, CARD_HEIGHT } from '../cards/CardTemplate.jsx';
import { CARDS } from '../game/cards.js';

const EMPTY_STATE = { photos: [], crops: {}, teamOverrides: {} };

const SCALES = [0.4, 0.5, 0.6, 0.75, 1];

export default function Studio() {
  const [state, setState] = useState(EMPTY_STATE);
  const [stateError, setStateError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(CARDS[0]?.id ?? null);
  const [scale, setScale] = useState(0.6);

  useEffect(() => {
    fetch('/__studio/state')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setState)
      .catch(err => setStateError(err.message));
  }, []);

  const players = useMemo(
    () => [...CARDS].sort((a, b) => a.name.localeCompare(b.name)),
    []
  );

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players;
    return players.filter(
      c => c.name.toLowerCase().includes(q) || (c.team ?? '').toLowerCase().includes(q)
    );
  }, [players, query]);

  const card = CARDS.find(c => c.id === selectedId) ?? null;
  const hasPhoto = card ? state.photos.includes(card.id) : false;

  return (
    <div style={S.page}>
      <aside style={S.panel}>
        <h1 style={S.title}>Card Studio</h1>
        <div style={S.meta}>
          {stateError
            ? `state unavailable: ${stateError}`
            : `${state.photos.length} photos · ${Object.keys(state.crops).length} crops · ${
                Object.keys(state.teamOverrides).length
              } team overrides`}
        </div>

        <input
          style={S.input}
          placeholder="Filter by name or team…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />

        <select
          style={S.select}
          size={22}
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value)}
        >
          {matches.map(c => (
            <option key={c.id} value={c.id}>
              {state.photos.includes(c.id) ? '● ' : '○ '}
              {c.name} — {c.team}
            </option>
          ))}
        </select>
        <div style={S.meta}>
          {matches.length} of {players.length} players
        </div>

        <label style={S.meta}>
          preview scale{' '}
          <select value={scale} onChange={e => setScale(Number(e.target.value))}>
            {SCALES.map(s => (
              <option key={s} value={s}>
                {Math.round(s * 100)}%
              </option>
            ))}
          </select>
        </label>

        {card && (
          <div style={S.factsBox}>
            <Fact label="id" value={card.id} />
            <Fact label="team" value={card.team} />
            <Fact label="shot line" value={card.shotLine ?? '—'} />
            <Fact label="chart tiers" value={card.chart?.length ?? 0} />
            <Fact label="photo" value={hasPhoto ? 'curated' : 'none'} />
          </div>
        )}
      </aside>

      <main style={S.stage}>
        {card ? (
          <div
            style={{
              width: CARD_WIDTH * scale,
              height: CARD_HEIGHT * scale,
            }}
          >
            {/* The card itself stays at its true 843x1181 — only the wrapper is
                scaled, so the preview is the same pixels the export writes. */}
            <div style={{ transform: `scale(${scale})`, transformOrigin: 'top left' }}>
              <CardTemplate
                card={card}
                crop={state.crops[card.id]}
                hasPhoto={hasPhoto}
                teamOverrides={state.teamOverrides}
              />
            </div>
          </div>
        ) : (
          <div style={S.meta}>no player selected</div>
        )}
      </main>
    </div>
  );
}

function Fact({ label, value }) {
  return (
    <div style={S.fact}>
      <span style={{ opacity: 0.6 }}>{label}</span>
      <span>{String(value)}</span>
    </div>
  );
}

const S = {
  page: { display: 'flex', gap: 24, height: '100%', padding: 20, overflow: 'auto' },
  panel: { width: 320, flex: 'none', display: 'flex', flexDirection: 'column', gap: 10 },
  title: { fontSize: 20, fontWeight: 700, letterSpacing: 0.5 },
  meta: { fontSize: 12, opacity: 0.75 },
  input: { width: '100%' },
  select: { width: '100%', padding: 4, fontSize: 12, lineHeight: 1.6 },
  factsBox: {
    marginTop: 4,
    padding: 10,
    borderRadius: 8,
    background: 'rgba(255,255,255,0.06)',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    fontSize: 12,
  },
  fact: { display: 'flex', justifyContent: 'space-between', gap: 12 },
  stage: { flex: 1, display: 'flex', justifyContent: 'center', paddingTop: 4 },
};
