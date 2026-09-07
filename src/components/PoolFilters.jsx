// The one filter row both team builders use. Controlled: the owner holds the
// filter object and passes it back down, so the sandbox and the collection
// editor cannot grow different controls.
import { POSITIONS, POOL_SORTS } from '../game/teamRules.js';
import styles from './TeamBuilderTab.module.css';

export default function PoolFilters({ value, onChange, teams }) {
  const set = patch => onChange({ ...value, ...patch });
  return (
    <div className={styles.filters}>
      <input
        type="text"
        placeholder="Search name or team…"
        value={value.search}
        onChange={e => set({ search: e.target.value })}
        style={{ width: 180 }}
        aria-label="Search players"
      />
      <select value={value.team} onChange={e => set({ team: e.target.value })} style={{ width: 100 }} aria-label="Team">
        <option value="">All Teams</option>
        {teams.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <select value={value.pos} onChange={e => set({ pos: e.target.value })} style={{ width: 90 }} aria-label="Position">
        <option value="">All Pos</option>
        {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
      </select>
      <select value={value.maxSal} onChange={e => set({ maxSal: Number(e.target.value) })} style={{ width: 130 }} aria-label="Max salary">
        <option value={9999}>All salaries</option>
        {[1500, 1200, 1000, 800, 600, 400, 200].map(v => (
          <option key={v} value={v}>≤ ${v}</option>
        ))}
      </select>
      <select value={value.sort} onChange={e => set({ sort: e.target.value })} style={{ width: 140 }} aria-label="Sort">
        {Object.entries(POOL_SORTS).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
      </select>
    </div>
  );
}
