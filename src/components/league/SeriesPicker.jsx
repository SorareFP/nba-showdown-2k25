// THE PLAYOFF SERIES, PICKED PER ROUND. The user, 2026-09-11: series length
// "picked per round at setup". One row per playoff round, the first round
// first; bracket.js plays whatever it is handed. Used by Season and Dynasty
// setup alike.
import { playoffCount } from '../../game/modes/schedule.js';
import { SERIES_LENGTHS, playoffRoundName } from '../../game/modes/bracket.js';
import s from './SeriesPicker.module.css';

/** The series list for a league of `size`: one entry per playoff round, one game where none was picked. */
export function seriesFor(size, value = null) {
  const rounds = Math.max(1, Math.round(Math.log2(playoffCount(size))));
  return Array.from({ length: rounds }, (_, i) => (SERIES_LENGTHS.includes(value?.[i]) ? value[i] : 1));
}

export default function SeriesPicker({ size, value, onChange, label = 'Playoff series' }) {
  const series = seriesFor(size, value);
  const set = (i, n) => onChange(series.map((v, j) => (j === i ? n : v)));
  return (
    <div className={s.field}>
      <span className={s.label}>{label}</span>
      {series.map((bo, i) => (
        <div key={i} className={s.row}>
          <span className={s.round}>{playoffRoundName(i + 1, series.length)}</span>
          {SERIES_LENGTHS.map(n => (
            <button key={n} type="button" className={`${s.pill} ${bo === n ? s.on : ''}`} onClick={() => set(i, n)}>
              {n === 1 ? 'One game' : `Best of ${n}`}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
