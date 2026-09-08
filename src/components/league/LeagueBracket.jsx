// A TOURNAMENT'S BRACKET, named by its entrants. The season's playoff view in
// SeasonTab draws from season teams; this one draws from league entrants,
// which is the only difference.
import { humanFor } from '../../firebase/leagues.js';
import styles from '../SeasonTab.module.css';

const ROUND_NAMES = { 1: 'Final', 2: 'Semifinals', 3: 'Quarterfinals', 4: 'First Round', 5: 'Round of 32' };
export function roundName(round, rounds) {
  return ROUND_NAMES[rounds - round + 1] ?? `Round ${round}`;
}

export default function LeagueBracket({ league, uid }) {
  const bracket = league.bracket;
  if (!bracket) return null;
  const rounds = Array.from({ length: bracket.rounds }, (_, i) => i + 1);
  const mine = `h:${uid}`;
  return (
    <section className={styles.panel}>
      <h3 className={styles.panelTitle}>Bracket</h3>
      <div className={styles.bracket}>
        {rounds.map(r => (
          <div key={r} className={styles.bracketCol}>
            <div className={styles.bracketHead}>{roundName(r, bracket.rounds)}</div>
            {bracket.matches.filter(m => m.round === r).map(m => (
              <div key={m.id} className={styles.bracketMatch}>
                <Side name={humanFor(league, m.a)?.name} won={Boolean(m.winner) && m.winner === m.a} me={m.a === mine} score={m.result?.homeScore} forfeit={m.result?.forfeit} />
                <Side name={humanFor(league, m.b)?.name} won={Boolean(m.winner) && m.winner === m.b} me={m.b === mine} score={m.result?.awayScore} forfeit={m.result?.forfeit} />
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function Side({ name, won, me, score, forfeit }) {
  return (
    <div className={`${styles.bracketSide} ${won ? styles.bracketWon : ''}`}>
      <span className={styles.chipName} style={me ? { textDecoration: 'underline', textDecorationColor: 'var(--orange)' } : undefined}>
        {name ?? 'TBD'}
      </span>
      <span className={styles.muted}>{Number.isFinite(score) ? `${score}${forfeit ? ' (ff)' : ''}` : ''}</span>
    </div>
  );
}
