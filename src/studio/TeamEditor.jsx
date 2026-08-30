// The team template editor — the "wider level" adjustment.
//
// Everything else in the studio edits ONE card. This edits a team, and every
// player on that team re-themes at once, which is the only sane way to hold
// thirty color schemes to a standard across 350 cards.
//
// It exists because src/cards/teams.js is deliberately not the place to put
// taste. That table records the OFFICIAL colors, verified against TruColor,
// and being faithful has consequences the eye disagrees with: Denver's second
// official color is Flatirons Red, so the Nuggets lose the gold everyone
// associates with them. OKC and Memphis land similarly. The fix belongs in the
// set's team-overrides.json, not in the record of what is official.
//
// THREE FIELDS, and the third is the important one. Primary and secondary have
// official values to depart from; the ACCENT — the color used for team-tinted
// text and hairlines — has none. The card computes it from the other two, and
// for 15 of 30 teams that computation gives up and returns cream, because so
// many official second colors are black or navy. Denver is one of them. So the
// accent is not merely also-editable: without it Denver cannot be fixed at all.
import { useState } from 'react';
import {
  getTeam,
  getThemedTeam,
  resolveAccent,
  canonicalTeamFor,
  leagueTeamCount,
} from '../cards/teams.js';
import { DEFAULT_LEAGUE } from '../cards/sets.js';
import {
  THEME_FIELDS,
  normalizeHex,
  isValidHex,
  isUnambiguousHex,
  setTeamColor,
  clearTeamColor,
  clearTeamOverride,
  hasTeamOverride,
  overriddenTeams,
} from './teamTheme.js';
import styles from './Studio.module.css';

const FIELD_LABEL = { primary: 'primary', secondary: 'secondary', accent: 'accent' };

const FIELD_HINT = {
  primary: 'The team’s first official color. Fills the card’s bands and blocks.',
  secondary: 'The team’s second official color, in the order the source lists them.',
  accent:
    'The color used for team-tinted TEXT and hairlines. No team has an official one — ' +
    'the card picks the brighter of the two above, or falls back to cream when both are too ' +
    'dark to read on navy (15 of 30 teams). Set it here to choose it outright.',
};

export default function TeamEditor({ team: abbr, overrides, onChange, league = DEFAULT_LEAGUE }) {
  // THE LEAGUE IS NOT OPTIONAL DECORATION. Nine abbreviations name a different
  // franchise in each league's table, so without it this panel sat under a
  // Toronto TEMPO card calling itself the Toronto Raptors and offering the
  // Raptors' colours to edit — and under an Aces card it said "this player has
  // no resolved team", because LVA is in no NBA table at all. Both are the same
  // omission the card itself already fixed by asking for the league.
  const canonical = canonicalTeamFor(abbr, { league });
  const official = getTeam(canonical, { league });
  const themed = getThemedTeam(canonical, overrides, { league });
  const customised = overriddenTeams(overrides);
  const teamCount = leagueTeamCount(league);

  // A team that isn't a team. 45 pool players still carry Basketball-
  // Reference's "2TM"/"3TM" trade aggregates, and 'Unknown' has no official
  // colors to depart from — an override keyed "2TM" would theme a code, not a
  // franchise, and would outlive the bad data that produced it. No selection
  // at all lands here too.
  const editable = official.name !== 'Unknown';

  return (
    <div className={styles.teamPanel}>
      <div className={styles.teamHead}>
        <span className={styles.teamName}>
          {editable ? `${official.city} ${official.name}` : abbr ? 'No team' : 'No player selected'}
          {abbr && <span className={styles.teamAbbr}>{canonical}</span>}
          {hasTeamOverride(overrides, canonical) && (
            <span
              className={styles.teamCustomTag}
              title="This team departs from its official colors."
            >
              customised
            </span>
          )}
        </span>

        <span className={styles.spacer} />

        {/* Overrides accumulate across sessions and are invisible on every
            card but the one on screen. The count is the standing answer to
            "what have I changed", and the hover text names them. */}
        <span
          className={styles.teamCount}
          title={
            customised.length
              ? `Teams departing from their official colors: ${customised.join(', ')}`
              : 'Every team is on its official colors from src/cards/teams.js.'
          }
          data-customised-count={customised.length}
        >
          {customised.length} of {teamCount} customised
        </span>

        <button
          type="button"
          className={styles.resetButton}
          disabled={!editable || !hasTeamOverride(overrides, canonical)}
          title={
            'Remove this team’s override entirely so it follows the official colors again. ' +
            'Removes the entry rather than writing today’s official values into it, so a later ' +
            'correction upstream still reaches these cards.'
          }
          onClick={() => onChange(clearTeamOverride(overrides, canonical))}
        >
          Reset to official
        </button>
      </div>

      {editable ? (
        <div className={styles.teamFields}>
          {THEME_FIELDS.map(field => (
            <ColorField
              key={`${canonical}:${field}`}
              field={field}
              // The accent has no official value; what it "is" when nobody has
              // chosen one is whatever the card computes, so show that.
              value={field === 'accent' ? resolveAccent(themed) : themed[field]}
              official={field === 'accent' ? null : official[field]}
              overridden={normalizeHex(overrides?.[canonical]?.[field]) !== null}
              onSet={hex => onChange(setTeamColor(overrides, canonical, field, hex))}
              onClear={() => onChange(clearTeamColor(overrides, canonical, field))}
            />
          ))}
        </div>
      ) : abbr ? (
        <p className={styles.teamEmpty}>
          This player has no resolved team ({canonical}), so there is no template to edit. Run{' '}
          <code>
            {league === 'WNBA'
              ? 'node scripts/cardgen/wnba/fetchWnba.js'
              : 'node scripts/cardgen/generateTeams.js'}
          </code>{' '}
          to give the trade-aggregate players a real team.
        </p>
      ) : (
        <p className={styles.teamEmpty}>Select a player to edit their team’s colors.</p>
      )}
    </div>
  );
}

/**
 * One color: a swatch picker and a hex box, editing the same value.
 *
 * BOTH, because they answer different questions. The picker is for "warmer
 * than that"; the box is for "it is exactly #FEC524", which is how a brand
 * color actually arrives — pasted from somewhere that knows.
 *
 * THE BOX IS A DRAFT WHILE IT HAS FOCUS. Two rules, and both are needed:
 *
 *  - What the user typed is what the box shows. The committed value never
 *    writes over an in-progress edit, or the box edits itself as you type.
 *  - Only an UNAMBIGUOUS value auto-commits (see isUnambiguousHex). A 3-digit
 *    shorthand is a real color and a prefix of a longer one, so "#008" on the
 *    way to "#008080" would otherwise repaint the team #000088 and leave that
 *    in the box. Shorthand still commits — on Enter or on blur, when the user
 *    has said they are done.
 */
function ColorField({ field, value, official, overridden, onSet, onClear }) {
  const [draft, setDraft] = useState(null);
  const [focused, setFocused] = useState(false);
  // Only an active edit may hide the committed value. Out of focus the field
  // always shows the truth, which is what makes Reset and the picker land here
  // visibly. (Switching team remounts this component — see the `key` above —
  // so a draft can never survive to a different team.)
  const shown = focused && draft !== null ? draft : value;
  const valid = isValidHex(shown);

  const commit = text => {
    const hex = normalizeHex(text);
    if (hex) onSet(hex);
  };

  return (
    <label className={styles.teamField} title={FIELD_HINT[field]}>
      <span className={styles.teamFieldLabel}>
        {FIELD_LABEL[field]}
        {overridden ? (
          <button
            type="button"
            className={styles.teamFieldClear}
            title={
              official
                ? `Overridden. Back to the official ${official}.`
                : 'Overridden. Back to the color the card computes.'
            }
            onClick={onClear}
          >
            ×
          </button>
        ) : (
          <span className={styles.teamFieldAuto} title="Not overridden.">
            {field === 'accent' ? 'auto' : 'official'}
          </span>
        )}
      </span>

      <input
        className={styles.teamSwatch}
        type="color"
        // <input type="color"> only accepts #rrggbb, so feed it the committed
        // value, never the draft — a partial hex makes it silently snap black.
        value={normalizeHex(value) ?? '#000000'}
        onChange={event => onSet(event.target.value)}
        aria-label={`${field} color`}
      />

      <input
        className={`${styles.teamHex} ${valid ? '' : styles.teamHexInvalid}`}
        type="text"
        spellCheck={false}
        value={shown}
        aria-label={`${field} hex`}
        onFocus={() => setFocused(true)}
        onChange={event => {
          setDraft(event.target.value);
          // Mid-typing, only a value that cannot grow into a different color.
          if (isUnambiguousHex(event.target.value)) commit(event.target.value);
        }}
        // Leaving the field ends the edit: a shorthand still standing is taken
        // at its word, anything else is abandoned and the committed value
        // comes back on screen.
        onBlur={event => {
          commit(event.currentTarget.value);
          setFocused(false);
          setDraft(null);
        }}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            commit(event.currentTarget.value);
            setDraft(null);
          } else if (event.key === 'Escape') {
            setDraft(null);
          }
        }}
      />
    </label>
  );
}
