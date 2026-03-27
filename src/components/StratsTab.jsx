import { STRATS } from '../game/strats.js';
import { getStratImagePath } from '../game/cardImages.js';
import { useLightbox } from './CardLightbox.jsx';
import styles from './StratsTab.module.css';

const PHASE_LABELS = {
  matchup: 'Matchup Phase',
  pre_roll: 'Pre-Roll',
  scoring: 'Scoring Phase',
  post_roll: 'Post-Roll',
  reaction: 'Reaction (interrupt)',
};

export default function StratsTab() {
  const off = STRATS.filter(s => s.side === 'off');
  const def = STRATS.filter(s => s.side === 'def');

  return (
    <div>
      <div className={styles.reactionNote}>
        <strong>Reaction cards</strong> are played as interrupts — after your opponent announces an action but before it resolves.
        Announce "Reaction!" then reveal the card. Only one screen-canceling card (Go Under / Fight Over / Veer Switch) can be played per switch action.
      </div>
      <Group title="⚡ Offense" cards={off} col="var(--orange)" />
      <Group title="🛡 Defense & Reactions" cards={def} col="var(--blue)" />
    </div>
  );
}

function Group({ title, cards, col }) {
  const { open } = useLightbox();
  return (
    <section style={{ marginBottom: '1.5rem' }}>
      <h3 style={{ color: col, marginBottom: '10px', fontSize: '15px' }}>{title}</h3>
      <div className={styles.grid}>
        {cards.map(s => (
          <div key={s.id} className={styles.card} style={{ borderLeftColor: s.color, cursor: 'pointer' }}
            onClick={() => open('strat', s)}>
            {(() => { const img = getStratImagePath(s.id); return img ? (
              <img src={img} alt={s.name} className={styles.cardArt}
                onError={e => { e.target.style.display = 'none'; }} />
            ) : null; })()}
            <div className={styles.cardHeader}>
              <span className={styles.cardName}>{s.name}</span>
              {s.locked && <span className={styles.lock}>🔒</span>}
            </div>
            <div className={styles.tags}>
              <span className={`${styles.tag} ${s.side === 'off' ? styles.off : styles.def}`}>
                {s.side === 'off' ? '⚡ Off' : '🛡 Def'}
              </span>
              <span className={styles.phase}>{PHASE_LABELS[s.phase] || s.phase}</span>
              <span className={styles.copies}>×{s.copies}</span>
            </div>
            <p className={styles.desc}>{s.desc}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
