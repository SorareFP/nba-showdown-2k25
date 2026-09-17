// A LEAGUE'S LOBBY — the join code on the table, who is in, and the host's
// two buttons. The same screen for a tournament and a shared season; what
// differs is the line under the code (a prize pool, or how many AI teams
// will fill the rest) and when Start lights up (canStart, in modes/league.js).
import { useState } from 'react';
import { canStart, LEAGUE_STATUS } from '../../firebase/leagues.js';
import { tournamentPayouts } from '../../game/modes/prizes.js';
import { LENGTHS, gamesPerTeam, playoffCount } from '../../game/modes/schedule.js';
import { START_MODES } from '../../game/modes/dynasty.js';
import { levelById } from '../../game/aiLevels.js';
import styles from '../SeasonTab.module.css';
import lg from './League.module.css';

export default function LeagueLobby({ league, uid, busy = false, onStart, onCancel, onLeave, onBack, onDelete = null }) {
  const [copied, setCopied] = useState(false);
  const isHost = league.hostUid === uid;
  const why = canStart(league);
  const tour = league.kind === 'tournament';
  // A dynasty with friends: a fantasy start drafts every roster, so nobody brings one.
  const dyn = league.kind === 'dynasty';
  const drafted = dyn && league.settings.startMode !== 'own';
  const { size, fee, length } = league.settings;
  const pay = tour ? tournamentPayouts(size, fee) : null;
  const aiTeams = tour ? 0 : Math.max(0, size - league.entrants.length);

  const copy = async () => {
    try { await navigator.clipboard.writeText(league.joinCode); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no clipboard */ }
  };

  return (
    <>
      <header className={styles.head}>
        <div>
          <h2 className={styles.title}>{league.name}</h2>
          <p className={styles.sub}>
            {tour
              ? `${size}-team tournament · entry ${fee ? `${fee} coins` : 'free'} · single elimination`
              : dyn
                ? `${START_MODES[league.settings.startMode]?.label ?? 'Dynasty'} · ${size} teams · ${LENGTHS[length]?.label ?? length} seasons · ${league.settings.aging ? 'players age' : 'ten years'} · ${levelById(league.settings.aiLevel ?? 'prince').label}`
                : `${LENGTHS[length]?.label ?? length} season · ${size} teams · ${gamesPerTeam(size, length)} games each · top ${playoffCount(size)} make the playoffs`}
          </p>
        </div>
        <div className={styles.headActions}>
          <button className={styles.ghost} onClick={onBack}>Back</button>
        </div>
      </header>

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Join code</h3>
        <div className={lg.codeRow}>
          <span className={lg.code}>{league.joinCode}</span>
          <button className={styles.ghost} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        </div>
        <div className={styles.muted}>
          {tour
            ? 'Send it to the people you want in. Each of them pays the entry when they join.'
            : dyn
              ? `Send it to the friends you want in. Each of you coaches a team${drafted ? ' drafted in the fantasy draft' : ' of ten you bring'}; AI teams take the other seats.`
              : 'Send it to the friends you want in the league. AI teams fill whatever seats are left when you start.'}
        </div>
        {league.status !== LEAGUE_STATUS.lobby && (
          <div className={styles.note}>This lobby is closed.</div>
        )}
      </section>

      <section className={styles.panel}>
        <h3 className={styles.panelTitle}>Entrants · {league.entrants.length} of {size}</h3>
        <div className={lg.entrants}>
          {league.entrants.map(e => (
            <div key={e.id} className={lg.entrant}>
              <span className={styles.chipName}>{e.name}</span>
              <span className={styles.muted}>
                {drafted ? (e.deckName ?? 'default deck') : `${e.roster?.length ?? 0} cards${e.deckName ? ` · ${e.deckName}` : ''}`}
              </span>
              {e.uid === league.hostUid && <span className={lg.tag}>host</span>}
              {e.uid === uid && <span className={lg.tagYou}>you</span>}
            </div>
          ))}
          {aiTeams > 0 && (
            <div className={`${lg.entrant} ${lg.entrantGhost}`}>
              <span className={styles.chipName}>{aiTeams} AI team{aiTeams === 1 ? '' : 's'}</span>
              <span className={styles.muted}>{dyn ? 'drafted when the dynasty starts' : 'built when the season starts'}</span>
            </div>
          )}
        </div>
      </section>

      {tour && (
        <div className={styles.prize}>
          <strong>Prize pool · {pay.pool} coins</strong>
          <span>🏆 champion {pay.champion} · every match won {pay.perWin}</span>
          <span className={styles.muted}>Paid the moment each game is decided. Cancelled before the start, every entry comes back.</span>
        </div>
      )}

      <div className={styles.rowActions}>
        {isHost ? (
          <>
            <button className={styles.primary} disabled={busy || Boolean(why)} onClick={onStart} title={why ?? ''}>
              {busy ? 'Working…' : why ?? (tour ? 'Deal the bracket' : dyn ? 'Start the dynasty' : 'Start the season')}
            </button>
            <button className={styles.ghost} disabled={busy} onClick={onCancel}>Cancel {tour ? 'tournament' : dyn ? 'dynasty' : 'league'}</button>
            {onDelete && <button className={styles.ghost} disabled={busy} onClick={onDelete}>Delete dynasty</button>}
          </>
        ) : (
          <>
            <span className={styles.muted}>Waiting for the host to start.</span>
            <button className={styles.ghost} disabled={busy} onClick={onLeave}>Leave{fee ? ` (refunds ${fee})` : ''}</button>
          </>
        )}
      </div>
    </>
  );
}
