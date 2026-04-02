import { useState } from 'react';
import styles from './AnalyticsPanel.module.css';

const EMPTY = {
  chartPts: 0, shotCheckPts: 0, assistSpendPts: 0, reboundBonusPts: 0,
  freeThrowPts: 0, totalShotChecks: 0, totalShotCheckHits: 0,
  assistsGenerated: 0, assistsFromCards: 0, reboundsGenerated: 0, cardsPlayed: 0,
};

function pct(n, d) {
  if (!d) return '--';
  return Math.round((n / d) * 100) + '%';
}

export default function AnalyticsPanel({ analytics }) {
  const [open, setOpen] = useState(false);
  const a = analytics?.A || EMPTY;
  const b = analytics?.B || EMPTY;

  const rows = [
    { label: 'Chart Pts',         a: a.chartPts,         b: b.chartPts },
    { label: 'Shot Check Pts',    a: a.shotCheckPts,     b: b.shotCheckPts },
    { label: 'Assist Spend Pts',  a: a.assistSpendPts,   b: b.assistSpendPts },
    { label: 'Rebound Bonus Pts', a: a.reboundBonusPts,  b: b.reboundBonusPts },
    { label: 'Free Throw Pts',    a: a.freeThrowPts,     b: b.freeThrowPts },
    { label: 'Shot Checks',       a: `${a.totalShotCheckHits}/${a.totalShotChecks} (${pct(a.totalShotCheckHits, a.totalShotChecks)})`,
                                   b: `${b.totalShotCheckHits}/${b.totalShotChecks} (${pct(b.totalShotCheckHits, b.totalShotChecks)})` },
    { label: 'Assists (Chart)',   a: a.assistsGenerated,  b: b.assistsGenerated },
    { label: 'Assists (Cards)',   a: a.assistsFromCards,  b: b.assistsFromCards },
    { label: 'Rebounds (Chart)',  a: a.reboundsGenerated, b: b.reboundsGenerated },
    { label: 'Cards Played',     a: a.cardsPlayed,       b: b.cardsPlayed },
  ];

  return (
    <div className={styles.panel}>
      <button className={styles.toggle} onClick={() => setOpen(!open)}>
        <span className={styles.icon}>{open ? '▾' : '▸'}</span>
        <span className={styles.title}>Analytics</span>
      </button>
      {open && (
        <div className={styles.body}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.labelCol}>Stat</th>
                <th className={styles.teamACol}>Team A</th>
                <th className={styles.teamBCol}>Team B</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className={i % 2 === 0 ? styles.even : styles.odd}>
                  <td className={styles.label}>{r.label}</td>
                  <td className={styles.valA}>{r.a}</td>
                  <td className={styles.valB}>{r.b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
