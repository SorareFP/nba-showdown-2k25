// PICKING THE TEAM YOU SUPPORT — once, and for good.
//
// The user, 2026-09-07: "I just want players to be able to pick their favorite
// team, either NBA or WNBA, and get two-to-three commons plus an uncommon from
// that team. Then maybe a small packing boost in the future based on that
// setting (which cannot be changed in the future)."
//
// ── WHY THIS IS A MODAL AND WHY IT CONFIRMS ─────────────────────────────────
//
// It is the only permanent choice in the game. Everything else a player picks
// — teams, decks, which cards to burn — can be undone; this one is written in
// a transaction that refuses a second write, on the server, on purpose (the
// bias it buys would be worth farming otherwise). So it gets a screen of its
// own rather than a dropdown in a settings row, and a second click that says
// the name out loud before it goes.
//
// ── THE LIST COMES FROM THE POOL, NOT FROM A LIST OF TEAMS ──────────────────
//
// `favoriteTeamOptions()` is every franchise with at least three cards in the
// starter's pool — the same function the server validates against, so the two
// can never disagree about what is choosable. A franchise too thin to fill a
// starter core is not offered rather than offered and then quietly short.
import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { favoriteTeamOptions, parseFavoriteTeam } from '../game/packEngine.js';
import { getTeam } from '../cards/teams.js';
import { logoSrc } from '../cards/CardTemplate.jsx';
import styles from './FavoriteTeamPicker.module.css';

/** `"nba:MIL"` → the team record behind it, whichever table it lives in. */
export function teamForOption(option) {
  const parsed = parseFavoriteTeam(option);
  if (!parsed) return null;
  const league = parsed.league === 'wnba' ? { league: 'WNBA' } : {};
  const team = getTeam(parsed.abbr, league);
  // A folded franchise with a successor shows as the successor — the
  // Rockers' option reads "Cleveland Sirens" — while the cards it deals are
  // still the folded team's legends (`legendsOf` says so under the name).
  if (team?.successor) return { ...team, ...team.successor, folded: false, legendsOf: team };
  return team;
}

/** The full name of a chosen option, for the places that only need to say it. */
export function favoriteTeamName(option) {
  const team = teamForOption(option);
  return team ? `${team.city} ${team.name}` : null;
}

export default function FavoriteTeamPicker({ onChoose, onCancel, busy = false, error = null }) {
  const [picked, setPicked] = useState(null);
  const [confirming, setConfirming] = useState(false);

  const groups = useMemo(() => {
    const nba = [];
    const wnba = [];
    for (const option of favoriteTeamOptions()) {
      const team = teamForOption(option);
      if (!team) continue;
      (option.startsWith('wnba:') ? wnba : nba).push({ option, team });
    }
    const byCity = (a, b) => `${a.team.city} ${a.team.name}`.localeCompare(`${b.team.city} ${b.team.name}`);
    return [
      { id: 'nba', label: 'NBA', teams: nba.sort(byCity) },
      { id: 'wnba', label: 'WNBA', teams: wnba.sort(byCity) },
    ];
  }, []);

  const pickedTeam = picked ? teamForOption(picked) : null;

  // A PORTAL, NOT A CHILD. The overlay is position:fixed, and a fixed element
  // inside any ancestor with a transform, filter or containment is confined
  // to that ancestor's box instead of the viewport — the tab panel's
  // cross-fade animates a transform, and the picker came out the size of the
  // content column with its title cut off (the user, 2026-09-08: "tiny
  // tiny"). On the body it is measured against the viewport, always.
  return createPortal(
    <div className={styles.backdrop} role="dialog" aria-modal="true" aria-label="Pick your favourite team">
      <div className={styles.sheet}>
        <header className={styles.head}>
          <div>
            <h2 className={styles.title}>Who do you support?</h2>
            <p className={styles.sub}>
              Your starter pack comes with three commons and an uncommon from this team.
              <strong>You can only choose once.</strong>
            </p>
          </div>
          {onCancel && (
            <button className={styles.ghost} onClick={onCancel} disabled={busy}>Not yet</button>
          )}
        </header>

        {error && <div className={styles.error}>{error}</div>}

        <div className={styles.scroll}>
          {groups.map(group => (
            <section key={group.id} className={styles.group}>
              <h3 className={styles.groupTitle}>{group.label}</h3>
              <div className={styles.grid}>
                {group.teams.map(({ option, team }) => {
                  const src = team.logo ? logoSrc(team.logo) : null;
                  const on = picked === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      className={`${styles.team} ${on ? styles.teamOn : ''}`}
                      aria-pressed={on}
                      disabled={busy}
                      // The team's own colour, only on the one you are pointing
                      // at — thirty tinted tiles at once is a swatch book.
                      style={on ? { borderColor: team.primary, background: `${team.primary}22` } : undefined}
                      onClick={() => { setPicked(option); setConfirming(false); }}
                    >
                      {src
                        ? <img className={styles.crest} src={src} alt="" />
                        : <span className={styles.crestDot} style={{ background: team.primary }} />}
                      <span className={styles.teamName}>
                        <span className={styles.city}>{team.city}</span>
                        <span className={styles.nick}>{team.name}</span>
                        {team.legendsOf
                          ? <span className={styles.era}>{team.legendsOf.name} legends · {team.legendsOf.era}</span>
                          : team.folded && <span className={styles.era}>{team.era}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <footer className={styles.foot}>
          {pickedTeam ? (
            confirming ? (
              <>
                <span className={styles.confirmText}>
                  The <strong>{pickedTeam.city} {pickedTeam.name}</strong>, for good?
                </span>
                <button className={styles.ghost} disabled={busy} onClick={() => setConfirming(false)}>
                  Back
                </button>
                <button className={styles.primary} disabled={busy} onClick={() => onChoose(picked)}>
                  {busy ? 'Signing…' : 'Yes, lock it in'}
                </button>
              </>
            ) : (
              <>
                <span className={styles.confirmText}>{pickedTeam.city} {pickedTeam.name}</span>
                <button className={styles.primary} disabled={busy} onClick={() => setConfirming(true)}>
                  Choose them
                </button>
              </>
            )
          ) : (
            <span className={styles.confirmText}>Pick a team to continue.</span>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
