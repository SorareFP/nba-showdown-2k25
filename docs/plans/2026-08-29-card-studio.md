# Card Studio Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a local, dev-only Card Studio that turns curated player photos + generated stat data into print-ready 843×1181 card PNGs for the new season's ~331-player set, re-runnable whenever stats change.

**Architecture:** One React card component is the single source of truth — it renders both the studio's live preview and the batch-exported PNG, so they can never drift. The studio is a separate Vite entry point (`studio.html`), which Vite excludes from production builds automatically. File persistence (photos, crop metadata, team colors) goes through a Vite dev-server middleware plugin, so there's no second server process to run. Batch export drives the same component through Playwright.

**Tech Stack:** React 18, Vite 5 (multi-entry + `configureServer` plugin), Vitest, Playwright (new dev dependency, export only).

---

## Before you start

Read these first — they carry context this plan assumes:

- `docs/plans/2026-08-29-card-studio-design.md` — the approved design and the reasoning behind each decision.
- `scripts/cardgen/sources/basketballReference.js` and `scripts/cardgen/sources/playerPool.js` — the established source-adapter conventions. **Follow them:** throw loudly when expected page structure is missing (never silently fall back to parsing unscoped input), test against a real trimmed HTML fixture in `__fixtures__/`, and document dedup rules in comments.
- `src/game/cards.js` — the card data shape (`chart` is an array of `{lo, hi, pts, reb, ast}`).
- `src/game/cardImages.js` — confirms exported PNGs go to `public/cards/players/{playerId}.png`.

### ⚠️ Card data for the new pool does not exist yet

`card-data/generated/player-pool-2026.json` (331 players: `name`, `team`, `pos`, `games`, `mpg`) and `card-data/generated/speed-power-totals-2026.json` exist. But **per-player scoring charts, final Speed/Power splits, and salaries for the new pool have not been generated.** The scoring-chart pipeline is built and validated but hasn't been run over the new pool, and the Speed/Power positional split isn't built at all.

**Do not block on this.** Use the existing 306-card dataset (`src/game/rawCards.js`, via `src/game/cards.js`) as development and test data throughout — it has every field the card component needs. The studio must degrade gracefully when a field is missing (render a placeholder, not a crash), because the real new-pool data will arrive incrementally.

### Existing test baseline

`npm test` currently passes 28 tests across 7 files. Keep it green.

---

## Task 1: NBA roster source adapter

**Files:**
- Create: `scripts/cardgen/sources/nbaRoster.js`
- Test: `scripts/cardgen/sources/nbaRoster.test.js`
- Create fixture: `scripts/cardgen/sources/__fixtures__/sample-nba-players.html`

`https://www.nba.com/players` embeds a `<script id="__NEXT_DATA__" type="application/json">` tag whose JSON contains `props.pageProps.players` — an array of 581 active players. This adapter extracts it. Verified live 2026-08-29.

**Step 1: Build the fixture**

Fetch the real page and trim it to a handful of players, preserving the exact structure:

```bash
curl -s -A "Mozilla/5.0" "https://www.nba.com/players" -o /tmp/nba_players_full.html
```

Then write a script (throwaway, don't commit it) that parses out `__NEXT_DATA__`, keeps only 4 players — include **Nikola Jokic** (accented surname `Jokić` in our pool, plain `Jokic` here — exercises normalization), **James Harden** (a `2TM` player in our pool), and any 2 others — and re-emits a minimal HTML file:

```html
<!-- Trimmed excerpt of a REAL nba.com/players page for fixture purposes. -->
<!-- Source: https://www.nba.com/players (fetched 2026-08-29). -->
<html><body>
<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"players":[ ...4 real player objects verbatim... ]}}}</script>
</body></html>
```

The player objects must be **verbatim real records**, not hand-typed. Each has keys: `PERSON_ID`, `PLAYER_LAST_NAME`, `PLAYER_FIRST_NAME`, `PLAYER_SLUG`, `TEAM_ID`, `TEAM_SLUG`, `TEAM_CITY`, `TEAM_NAME`, `TEAM_ABBREVIATION`, `JERSEY_NUMBER`, `POSITION`, `HEIGHT`, `WEIGHT`, and others.

**Step 2: Write the failing test**

```js
// scripts/cardgen/sources/nbaRoster.test.js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseRosterHtml } from './nbaRoster.js';

const FIXTURE = readFileSync(new URL('./__fixtures__/sample-nba-players.html', import.meta.url), 'utf-8');

describe('parseRosterHtml', () => {
  it('extracts player records with team and person id', () => {
    const players = parseRosterHtml(FIXTURE);
    expect(players.length).toBeGreaterThan(0);
    const jokic = players.find(p => p.lastName === 'Jokic');
    expect(jokic).toMatchObject({
      personId: 203999,
      firstName: 'Nikola',
      team: 'DEN',
      teamCity: 'Denver',
      teamName: 'Nuggets',
    });
    expect(jokic.fullName).toBe('Nikola Jokic');
  });

  it('throws when the __NEXT_DATA__ script tag is missing', () => {
    expect(() => parseRosterHtml('<html><body>nope</body></html>')).toThrow(/__NEXT_DATA__/);
  });

  it('throws when the players array is missing from the blob', () => {
    const html = '<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>';
    expect(() => parseRosterHtml(html)).toThrow(/pageProps\.players/);
  });
});
```

**Step 3: Run to verify it fails**

Run: `npm test -- nbaRoster`
Expected: FAIL — cannot resolve `./nbaRoster.js`.

**Step 4: Implement**

```js
// scripts/cardgen/sources/nbaRoster.js
//
// nba.com/players source adapter — resolves each active player's CURRENT team.
//
// Why this exists: Basketball-Reference (our stats source) reports players who
// were traded mid-season under aggregate team codes "2TM"/"3TM" rather than a
// real team. 45 of the 331-player pool carry those codes. A card can't show a
// logo or team colors for "2TM", so we need a real-team source.
//
// STRUCTURE (verified 2026-08-29 against the live page): nba.com is a Next.js
// app that server-renders its data into a <script id="__NEXT_DATA__"> tag. The
// player array lives at props.pageProps.players and contains 581 active
// players. A trimmed excerpt of the real page is saved as
// __fixtures__/sample-nba-players.html.
//
// Only ACTIVE rostered players appear here. Retired players and unsigned free
// agents are absent by definition — that is expected, not an error. Callers
// handle those via manual assignment (see scripts/cardgen/resolveTeams.js).

const SCRIPT_ID = '__NEXT_DATA__';

/** Extracts and parses the __NEXT_DATA__ JSON blob from an nba.com page. */
function extractNextData(html) {
  const marker = `id="${SCRIPT_ID}"`;
  const idIndex = html.indexOf(marker);
  if (idIndex === -1) {
    throw new Error(
      `parseRosterHtml: could not find ${marker} in the input HTML — nba.com's page structure ` +
        'may have changed; verify against a live page before assuming the site is unreachable.'
    );
  }
  const openEnd = html.indexOf('>', idIndex);
  const closeStart = html.indexOf('</script>', openEnd);
  if (openEnd === -1 || closeStart === -1) {
    throw new Error(`parseRosterHtml: found ${marker} but its <script> tag is malformed or truncated.`);
  }
  const json = html.slice(openEnd + 1, closeStart);
  try {
    return JSON.parse(json);
  } catch (err) {
    throw new Error(`parseRosterHtml: ${SCRIPT_ID} contents were not valid JSON: ${err.message}`);
  }
}

/** Parses nba.com/players HTML into normalized roster records. */
export function parseRosterHtml(html) {
  const data = extractNextData(html);
  const players = data?.props?.pageProps?.players;
  if (!Array.isArray(players)) {
    throw new Error(
      'parseRosterHtml: props.pageProps.players was not an array — the shape of nba.com\'s ' +
        'embedded data has changed.'
    );
  }
  return players.map(p => ({
    personId: p.PERSON_ID,
    firstName: p.PLAYER_FIRST_NAME,
    lastName: p.PLAYER_LAST_NAME,
    fullName: `${p.PLAYER_FIRST_NAME} ${p.PLAYER_LAST_NAME}`,
    team: p.TEAM_ABBREVIATION,
    teamCity: p.TEAM_CITY,
    teamName: p.TEAM_NAME,
    jersey: p.JERSEY_NUMBER,
    position: p.POSITION,
  }));
}

/** Fetches and parses the current active-player roster from nba.com. */
export async function fetchRoster() {
  const res = await fetch('https://www.nba.com/players', {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`nba.com fetch failed: ${res.status}`);
  return parseRosterHtml(await res.text());
}
```

**Step 5: Run to verify it passes**

Run: `npm test -- nbaRoster`
Expected: PASS, 3 tests.

**Step 6: Commit**

```bash
git add scripts/cardgen/sources/nbaRoster.js scripts/cardgen/sources/nbaRoster.test.js scripts/cardgen/sources/__fixtures__/sample-nba-players.html
git commit -m "feat(cardgen): add nba.com roster source adapter"
```

---

## Task 2: Resolve real teams for the player pool

**Files:**
- Create: `scripts/cardgen/resolveTeams.js`
- Test: `scripts/cardgen/resolveTeams.test.js`
- Create: `card-data/manual-teams.json`

Merges the pool with the nba.com roster to replace `2TM`/`3TM` with real teams, and normalizes Basketball-Reference's team abbreviations to nba.com's.

**Step 1: Create the manual-team override file**

Basketball-Reference and nba.com disagree on three abbreviations, and 12 pool players are retired/unsigned so they never appear on nba.com. Create `card-data/manual-teams.json`:

```json
{
  "_comment": "Teams for players who cannot be resolved from nba.com's active roster (retired or unsigned free agents). Keyed by the player name exactly as it appears in player-pool-2026.json. Set to null if the player should be dropped from the set instead.",
  "Russell Westbrook": null,
  "Bobby Portis": null,
  "GG Jackson II": null,
  "Cam Thomas": null,
  "Vince Williams Jr.": null,
  "Walter Clayton": null,
  "Ron Holland": null,
  "Robert Williams": null,
  "Ochai Agbaji": null,
  "Guerschon Yabusele": null,
  "Jonas Valančiūnas": null,
  "Drew Eubanks": null
}
```

`null` means "unresolved, needs a human decision" — the resolver reports these rather than guessing. Russell Westbrook is confirmed retired; the user will fill in or drop the rest via the studio.

**Step 2: Write the failing test**

```js
// scripts/cardgen/resolveTeams.test.js
import { describe, it, expect } from 'vitest';
import { normalizeName, canonicalTeam, resolvePlayerTeams } from './resolveTeams.js';

describe('normalizeName', () => {
  it('strips diacritics, case, and punctuation', () => {
    expect(normalizeName('Nikola Jokić')).toBe(normalizeName('Nikola Jokic'));
    expect(normalizeName('Alperen Şengün')).toBe(normalizeName('Alperen Sengun'));
    expect(normalizeName("De'Aaron Fox")).toBe('dearonfox');
    expect(normalizeName('A.J. Green')).toBe('ajgreen');
  });
});

describe('canonicalTeam', () => {
  it('maps Basketball-Reference abbreviations to nba.com ones', () => {
    expect(canonicalTeam('BRK')).toBe('BKN');
    expect(canonicalTeam('CHO')).toBe('CHA');
    expect(canonicalTeam('PHO')).toBe('PHX');
  });
  it('passes through abbreviations that already agree', () => {
    expect(canonicalTeam('DEN')).toBe('DEN');
    expect(canonicalTeam('GSW')).toBe('GSW');
  });
});

describe('resolvePlayerTeams', () => {
  const roster = [
    { fullName: 'James Harden', team: 'CLE', personId: 201935 },
    { fullName: 'Nikola Jokic', team: 'DEN', personId: 203999 },
  ];

  it('replaces multi-team aggregate codes with the real current team', () => {
    const pool = [{ name: 'James Harden', team: '2TM' }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0]).toMatchObject({ name: 'James Harden', team: 'CLE', personId: 201935 });
  });

  it('matches across diacritics', () => {
    const pool = [{ name: 'Nikola Jokić', team: 'DEN' }];
    const { resolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved[0]).toMatchObject({ team: 'DEN', personId: 203999 });
  });

  it('reports players absent from the roster as unresolved', () => {
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, {});
    expect(resolved).toHaveLength(0);
    expect(unresolved).toEqual(['Russell Westbrook']);
  });

  it('uses a manual override when the roster has no match', () => {
    const pool = [{ name: 'Russell Westbrook', team: 'SAC' }];
    const { resolved, unresolved } = resolvePlayerTeams(pool, roster, { 'Russell Westbrook': 'DEN' });
    expect(unresolved).toHaveLength(0);
    expect(resolved[0]).toMatchObject({ team: 'DEN', personId: null });
  });
});
```

**Step 3: Run to verify it fails**

Run: `npm test -- resolveTeams`
Expected: FAIL — cannot resolve `./resolveTeams.js`.

**Step 4: Implement**

```js
// scripts/cardgen/resolveTeams.js
//
// Merges the Basketball-Reference-derived player pool with nba.com's active
// roster to give every player a REAL current team.
//
// Two problems this solves:
//  1. Basketball-Reference reports mid-season-traded players under aggregate
//     codes "2TM"/"3TM" (45 of 331 players). Those aren't teams.
//  2. The two sources disagree on three abbreviations (see TEAM_ALIASES).
//
// Players who are retired or unsigned never appear on nba.com's active roster.
// They're returned as `unresolved` rather than guessed at, and get their team
// from card-data/manual-teams.json.

/** Basketball-Reference abbreviation -> nba.com abbreviation. */
const TEAM_ALIASES = { BRK: 'BKN', CHO: 'CHA', PHO: 'PHX' };

const MULTI_TEAM_CODES = new Set(['2TM', '3TM', '4TM', 'TOT']);

/** Canonicalizes a team abbreviation to nba.com's spelling. */
export function canonicalTeam(abbr) {
  return TEAM_ALIASES[abbr] ?? abbr;
}

/**
 * Normalizes a player name for cross-source matching: strips diacritics
 * ("Jokić" -> "jokic"), lowercases, and drops all non-letters so punctuation
 * differences ("A.J. Green" vs "AJ Green", "De'Aaron" vs "DeAaron") don't
 * prevent a match.
 */
export function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/**
 * @param pool     Array of { name, team, ... } from player-pool-2026.json
 * @param roster   Array of { fullName, team, personId } from nbaRoster.js
 * @param manual   { [playerName]: teamAbbr | null } from manual-teams.json
 * @returns { resolved, unresolved } — `unresolved` is an array of player names
 *          with neither a roster match nor a non-null manual override.
 */
export function resolvePlayerTeams(pool, roster, manual = {}) {
  const byName = new Map(roster.map(r => [normalizeName(r.fullName), r]));
  const resolved = [];
  const unresolved = [];

  for (const player of pool) {
    const match = byName.get(normalizeName(player.name));
    if (match) {
      resolved.push({ ...player, team: match.team, personId: match.personId });
      continue;
    }
    const override = manual[player.name];
    if (override) {
      resolved.push({ ...player, team: canonicalTeam(override), personId: null });
      continue;
    }
    // No roster match and no usable override. Note that falling back to the
    // pool's own team would be wrong for the 2TM/3TM players — that's exactly
    // the bad data we're here to fix — so report instead of guessing.
    unresolved.push(player.name);
  }

  return { resolved, unresolved };
}

/** True if a pool team code is a Basketball-Reference multi-team aggregate. */
export function isMultiTeamCode(abbr) {
  return MULTI_TEAM_CODES.has(abbr);
}
```

**Step 5: Run to verify it passes**

Run: `npm test -- resolveTeams`
Expected: PASS, 7 tests.

**Step 6: Add the generation script**

Create `scripts/cardgen/generateTeams.js` — a small runnable script (not unit-tested; it does I/O and a network fetch):

```js
// scripts/cardgen/generateTeams.js
// Run: node scripts/cardgen/generateTeams.js
// Writes card-data/generated/player-teams-2026.json
import { readFileSync, writeFileSync } from 'node:fs';
import { fetchRoster } from './sources/nbaRoster.js';
import { resolvePlayerTeams, isMultiTeamCode } from './resolveTeams.js';

const root = new URL('../../', import.meta.url);
const readJson = p => JSON.parse(readFileSync(new URL(p, root), 'utf-8'));

const pool = readJson('card-data/generated/player-pool-2026.json');
const manual = readJson('card-data/manual-teams.json');

const roster = await fetchRoster();
console.log(`nba.com roster: ${roster.length} active players`);

const before = pool.filter(p => isMultiTeamCode(p.team)).length;
const { resolved, unresolved } = resolvePlayerTeams(pool, roster, manual);

console.log(`pool: ${pool.length} | resolved: ${resolved.length} | unresolved: ${unresolved.length}`);
console.log(`multi-team codes before: ${before} | after: ${resolved.filter(p => isMultiTeamCode(p.team)).length}`);
if (unresolved.length) console.log('unresolved (need card-data/manual-teams.json entries):', unresolved);

writeFileSync(
  new URL('card-data/generated/player-teams-2026.json', root),
  JSON.stringify(resolved, null, 2) + '\n'
);
console.log('wrote card-data/generated/player-teams-2026.json');
```

**Step 7: Run it against live data**

Run: `node scripts/cardgen/generateTeams.js`
Expected: roster ~581 players; resolved ~319; unresolved 12; **multi-team codes after: 0**. If any `2TM`/`3TM` survives, stop and investigate — that's the whole point of this task.

**Step 8: Commit**

```bash
git add scripts/cardgen/resolveTeams.js scripts/cardgen/resolveTeams.test.js scripts/cardgen/generateTeams.js card-data/manual-teams.json card-data/generated/player-teams-2026.json
git commit -m "feat(cardgen): resolve real current teams from nba.com roster"
```

---

## Task 3: Team table (colors + logo paths)

**Files:**
- Create: `src/cards/teams.js`
- Test: `src/cards/teams.test.js`

Static reference data. The user sources logo image files separately — this only defines the structure and the paths where those files are expected.

**Step 1: Write the failing test**

```js
// src/cards/teams.test.js
import { describe, it, expect } from 'vitest';
import { TEAMS, getTeam } from './teams.js';

describe('TEAMS', () => {
  it('has all 30 NBA teams', () => {
    expect(Object.keys(TEAMS)).toHaveLength(30);
  });

  it('gives every team a name, two colors, and a logo path', () => {
    for (const [abbr, team] of Object.entries(TEAMS)) {
      expect(team.name, abbr).toBeTruthy();
      expect(team.primary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.secondary, abbr).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(team.logo, abbr).toBe(`/logos/${abbr}.png`);
    }
  });

  it('uses nba.com abbreviations, not Basketball-Reference ones', () => {
    expect(TEAMS.BKN).toBeDefined();
    expect(TEAMS.CHA).toBeDefined();
    expect(TEAMS.PHX).toBeDefined();
    expect(TEAMS.BRK).toBeUndefined();
    expect(TEAMS.CHO).toBeUndefined();
    expect(TEAMS.PHO).toBeUndefined();
  });
});

describe('getTeam', () => {
  it('returns the team for a known abbreviation', () => {
    expect(getTeam('DEN').name).toBe('Nuggets');
  });

  it('returns a neutral fallback for an unknown abbreviation', () => {
    const t = getTeam('ZZZ');
    expect(t.name).toBe('Unknown');
    expect(t.primary).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- teams`
Expected: FAIL — cannot resolve `./teams.js`.

**Step 3: Implement**

```js
// src/cards/teams.js
//
// Team reference data for card theming. Keyed by nba.com abbreviations (NOT
// Basketball-Reference's — see scripts/cardgen/resolveTeams.js TEAM_ALIASES;
// they differ on BKN/CHA/PHX). Colors are each team's primary and secondary
// brand colors.
//
// Logo image files are NOT in this repo — the user adds them to
// public/logos/{ABBR}.png. Cards render without a logo if the file is absent.

export const TEAMS = {
  ATL: { name: 'Hawks',        city: 'Atlanta',      primary: '#E03A3E', secondary: '#C1D32F', logo: '/logos/ATL.png' },
  BOS: { name: 'Celtics',      city: 'Boston',       primary: '#007A33', secondary: '#BA9653', logo: '/logos/BOS.png' },
  BKN: { name: 'Nets',         city: 'Brooklyn',     primary: '#000000', secondary: '#FFFFFF', logo: '/logos/BKN.png' },
  CHA: { name: 'Hornets',      city: 'Charlotte',    primary: '#1D1160', secondary: '#00788C', logo: '/logos/CHA.png' },
  CHI: { name: 'Bulls',        city: 'Chicago',      primary: '#CE1141', secondary: '#000000', logo: '/logos/CHI.png' },
  CLE: { name: 'Cavaliers',    city: 'Cleveland',    primary: '#860038', secondary: '#FDBB30', logo: '/logos/CLE.png' },
  DAL: { name: 'Mavericks',    city: 'Dallas',       primary: '#00538C', secondary: '#B8C4CA', logo: '/logos/DAL.png' },
  DEN: { name: 'Nuggets',      city: 'Denver',       primary: '#0E2240', secondary: '#FEC524', logo: '/logos/DEN.png' },
  DET: { name: 'Pistons',      city: 'Detroit',      primary: '#C8102E', secondary: '#1D42BA', logo: '/logos/DET.png' },
  GSW: { name: 'Warriors',     city: 'Golden State', primary: '#1D428A', secondary: '#FFC72C', logo: '/logos/GSW.png' },
  HOU: { name: 'Rockets',      city: 'Houston',      primary: '#CE1141', secondary: '#000000', logo: '/logos/HOU.png' },
  IND: { name: 'Pacers',       city: 'Indiana',      primary: '#002D62', secondary: '#FDBB30', logo: '/logos/IND.png' },
  LAC: { name: 'Clippers',     city: 'LA',           primary: '#C8102E', secondary: '#1D428A', logo: '/logos/LAC.png' },
  LAL: { name: 'Lakers',       city: 'Los Angeles',  primary: '#552583', secondary: '#FDB927', logo: '/logos/LAL.png' },
  MEM: { name: 'Grizzlies',    city: 'Memphis',      primary: '#5D76A9', secondary: '#12173F', logo: '/logos/MEM.png' },
  MIA: { name: 'Heat',         city: 'Miami',        primary: '#98002E', secondary: '#F9A01B', logo: '/logos/MIA.png' },
  MIL: { name: 'Bucks',        city: 'Milwaukee',    primary: '#00471B', secondary: '#EEE1C6', logo: '/logos/MIL.png' },
  MIN: { name: 'Timberwolves', city: 'Minnesota',    primary: '#0C2340', secondary: '#236192', logo: '/logos/MIN.png' },
  NOP: { name: 'Pelicans',     city: 'New Orleans',  primary: '#0C2340', secondary: '#C8102E', logo: '/logos/NOP.png' },
  NYK: { name: 'Knicks',       city: 'New York',     primary: '#006BB6', secondary: '#F58426', logo: '/logos/NYK.png' },
  OKC: { name: 'Thunder',      city: 'Oklahoma City',primary: '#007AC1', secondary: '#EF3B24', logo: '/logos/OKC.png' },
  ORL: { name: 'Magic',        city: 'Orlando',      primary: '#0077C0', secondary: '#C4CED4', logo: '/logos/ORL.png' },
  PHI: { name: '76ers',        city: 'Philadelphia', primary: '#006BB6', secondary: '#ED174C', logo: '/logos/PHI.png' },
  PHX: { name: 'Suns',         city: 'Phoenix',      primary: '#1D1160', secondary: '#E56020', logo: '/logos/PHX.png' },
  POR: { name: 'Trail Blazers',city: 'Portland',     primary: '#E03A3E', secondary: '#000000', logo: '/logos/POR.png' },
  SAC: { name: 'Kings',        city: 'Sacramento',   primary: '#5A2D81', secondary: '#63727A', logo: '/logos/SAC.png' },
  SAS: { name: 'Spurs',        city: 'San Antonio',  primary: '#C4CED4', secondary: '#000000', logo: '/logos/SAS.png' },
  TOR: { name: 'Raptors',      city: 'Toronto',      primary: '#CE1141', secondary: '#000000', logo: '/logos/TOR.png' },
  UTA: { name: 'Jazz',         city: 'Utah',         primary: '#002B5C', secondary: '#F9A01B', logo: '/logos/UTA.png' },
  WAS: { name: 'Wizards',      city: 'Washington',   primary: '#002B5C', secondary: '#E31837', logo: '/logos/WAS.png' },
};

const FALLBACK = { name: 'Unknown', city: '', primary: '#1B2A4A', secondary: '#C0C0C0', logo: null };

/** Team record for an abbreviation, or a neutral fallback so cards still render. */
export function getTeam(abbr) {
  return TEAMS[abbr] ?? FALLBACK;
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- teams`
Expected: PASS, 5 tests.

**Step 5: Commit**

```bash
git add src/cards/teams.js src/cards/teams.test.js
git commit -m "feat(cards): add team color and logo reference table"
```

---

## Task 4: Card template component

**Files:**
- Create: `src/cards/CardTemplate.jsx`
- Create: `src/cards/CardTemplate.module.css`
- Create: `src/cards/photo.js`
- Test: `src/cards/photo.test.js`

The single source of truth for card rendering — used by both the studio preview and the batch export. Fixed at **843×1181** (2.5″×3.5″ at 337 DPI), matching the existing cards exactly.

**Step 1: Write the failing test for photo resolution**

```js
// src/cards/photo.test.js
import { describe, it, expect } from 'vitest';
import { resolvePhotoUrl, DEFAULT_CROP, cropToStyle } from './photo.js';

describe('resolvePhotoUrl', () => {
  it('prefers a curated photo when one exists', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: true, personId: 203999 }))
      .toBe('/card-art/photos/Nikola_Jokic.jpg');
  });

  it('falls back to the NBA headshot CDN when there is no curated photo', () => {
    expect(resolvePhotoUrl({ playerId: 'Nikola_Jokic', hasPhoto: false, personId: 203999 }))
      .toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/203999.png');
  });

  it('returns null when there is neither a photo nor a person id', () => {
    expect(resolvePhotoUrl({ playerId: 'X', hasPhoto: false, personId: null })).toBeNull();
  });
});

describe('cropToStyle', () => {
  it('translates crop metadata into CSS transform values', () => {
    const style = cropToStyle({ x: 10, y: -5, zoom: 1.5 });
    expect(style.transform).toContain('scale(1.5)');
    expect(style.transform).toContain('translate(10%, -5%)');
  });

  it('uses the default crop when given nothing', () => {
    expect(cropToStyle()).toEqual(cropToStyle(DEFAULT_CROP));
  });
});
```

**Step 2: Run to verify it fails**

Run: `npm test -- photo`
Expected: FAIL — cannot resolve `./photo.js`.

**Step 3: Implement photo resolution**

```js
// src/cards/photo.js
//
// Photo resolution and crop metadata for card art.
//
// Crop is stored as METADATA, never baked into the source image: the original
// photo file is left untouched so a crop can be redone later without
// re-sourcing the photo, and a template change can't destroy existing crops.

/** Neutral crop: centered, no zoom. */
export const DEFAULT_CROP = { x: 0, y: 0, zoom: 1 };

const HEADSHOT_BASE = 'https://cdn.nba.com/headshots/nba/latest/1040x760';

/**
 * Picks the image for a player.
 *
 * Curated action photos are the intended art for every card. The NBA headshot
 * CDN is only a fallback so a player without a curated photo yet still renders
 * a complete card instead of a hole — it is not the target look.
 */
export function resolvePhotoUrl({ playerId, hasPhoto, personId }) {
  if (hasPhoto) return `/card-art/photos/${playerId}.jpg`;
  if (personId) return `${HEADSHOT_BASE}/${personId}.png`;
  return null;
}

/** Converts crop metadata into an inline style for the photo element. */
export function cropToStyle(crop = DEFAULT_CROP) {
  const { x, y, zoom } = { ...DEFAULT_CROP, ...crop };
  return {
    transform: `translate(${x}%, ${y}%) scale(${zoom})`,
    transformOrigin: 'center center',
  };
}
```

**Step 4: Run to verify it passes**

Run: `npm test -- photo`
Expected: PASS, 5 tests.

**Step 5: Build the card component**

```jsx
// src/cards/CardTemplate.jsx
//
// THE single source of truth for card rendering. Both the Card Studio preview
// and the batch PNG export render this same component, so what you see in the
// studio is literally what gets written to disk.
//
// Fixed at 843x1181 = 2.5in x 3.5in at 337 DPI, matching the existing card set.
// Do not make the dimensions responsive — the export screenshots this element
// at exactly these pixel dimensions.
import { getTeam } from './teams.js';
import { resolvePhotoUrl, cropToStyle } from './photo.js';
import styles from './CardTemplate.module.css';

export const CARD_WIDTH = 843;
export const CARD_HEIGHT = 1181;

export default function CardTemplate({ card, crop, hasPhoto = false }) {
  const team = getTeam(card.team);
  const photoUrl = resolvePhotoUrl({
    playerId: card.id,
    hasPhoto,
    personId: card.personId ?? null,
  });

  // Card data for the new pool is generated incrementally, so any of these may
  // be missing while the set is being built. Render a placeholder rather than
  // crashing the studio.
  const chart = Array.isArray(card.chart) ? card.chart : [];

  return (
    <div
      className={styles.card}
      style={{
        width: CARD_WIDTH,
        height: CARD_HEIGHT,
        '--team-primary': team.primary,
        '--team-secondary': team.secondary,
      }}
    >
      <header className={styles.topBar}>
        <Stat label="SPEED" value={card.speed} />
        <Stat label="POWER" value={card.power} />
      </header>

      <div className={styles.name}>{card.name}</div>

      <div className={styles.photoWindow}>
        {photoUrl ? (
          <img src={photoUrl} alt={card.name} className={styles.photo} style={cropToStyle(crop)} />
        ) : (
          <div className={styles.photoPlaceholder}>NO PHOTO</div>
        )}
      </div>

      <div className={styles.sidebar}>
        {team.logo && <img src={team.logo} alt={team.name} className={styles.logo}
          onError={e => { e.currentTarget.style.visibility = 'hidden'; }} />}
        <div className={styles.pos}>{card.pos ?? '—'}</div>
        <Boost label="PAINT" value={card.paintBoost} />
        <Boost label="3PT" value={card.threePtBoost} />
        <Boost label="DEFENSE" value={card.defBoost} />
        <div className={styles.salaryLabel}>SALARY</div>
        <div className={styles.salaryValue}>{card.salary ?? '—'}</div>
      </div>

      <table className={styles.chart}>
        <thead>
          <tr><th>ROLL</th><th>PTS</th><th>REB</th><th>AST</th></tr>
        </thead>
        <tbody>
          {chart.length === 0 ? (
            <tr><td colSpan={4}>chart not generated</td></tr>
          ) : chart.map((t, i) => (
            <tr key={i}>
              <td>{t.hi >= 99 ? `${t.lo}+` : t.lo === t.hi ? t.lo : `${t.lo}-${t.hi}`}</td>
              <td>{t.pts}</td><td>{t.reb}</td><td>{t.ast}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value ?? '—'}</div>
    </div>
  );
}

function Boost({ label, value }) {
  return (
    <div className={styles.boost}>
      <div className={styles.boostLabel}>{label}</div>
      <div className={styles.boostValue}>{value > 0 ? `+${value}` : (value ?? 0)}</div>
    </div>
  );
}
```

**Step 6: Write the stylesheet**

Create `src/cards/CardTemplate.module.css`. Start from the existing card's visual language (navy field, team-colored accents, vertical name at left, angled photo window, stat table lower-left, boosts in a right sidebar) — study `public/cards/players/08_09_LeBron_James.png` for reference. Use `var(--team-primary)` / `var(--team-secondary)` for all accent color so a team change re-themes the whole card.

Key requirements:
- `.card` — `position: relative; overflow: hidden;` with an explicit background (do not rely on inherited page background; the export screenshots this element in isolation).
- `.photoWindow` — `overflow: hidden` so the crop transform clips correctly.
- `.photo` — `width: 100%; height: 100%; object-fit: cover;` so `cropToStyle` transforms on top of a sane baseline.
- All font sizes in `px`, not `rem`/`em` — the export must not depend on a root font size.

Getting the design exactly right is iterative; that's what the studio is for. Aim for a clean, correct-dimension card here and refine visually in Task 6+.

**Step 7: Verify tests still pass**

Run: `npm test`
Expected: all previous tests plus the new ones pass.

**Step 8: Commit**

```bash
git add src/cards/CardTemplate.jsx src/cards/CardTemplate.module.css src/cards/photo.js src/cards/photo.test.js
git commit -m "feat(cards): add card template component and photo resolution"
```

---

## Task 5: Studio entry point and dev-server persistence

**Files:**
- Create: `studio.html`
- Create: `src/studio/main.jsx`
- Create: `src/studio/Studio.jsx`
- Create: `scripts/studio/studioServerPlugin.js`
- Modify: `vite.config.js`
- Create: `card-art/.gitkeep`
- Modify: `.gitignore`

**Why a separate HTML entry rather than a route:** the app has no router (`App.jsx` switches on tab state), so adding one just for the studio would be a new dependency and a change to the shipped app. A second Vite entry is simpler and gets "dev-only" for free — `vite build` only bundles `index.html` by default, so `studio.html` is served in dev and never appears in `dist/`.

**Why a Vite plugin rather than a companion server:** the studio needs to write files (photos, crop metadata, team overrides). A `configureServer` plugin adds routes to the dev server that's already running, so there's no second process to start, no port to manage, and no extra dependency. It also cannot leak into production, since the plugin only runs in dev.

**Step 1: Create the studio entry point**

`studio.html` at the repo root:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Card Studio — NBA Showdown</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/studio/main.jsx"></script>
  </body>
</html>
```

`src/studio/main.jsx`:

```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import Studio from './Studio.jsx';
import '../index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode><Studio /></React.StrictMode>
);
```

**Step 2: Write the persistence plugin**

```js
// scripts/studio/studioServerPlugin.js
//
// Vite dev-server middleware backing the Card Studio's file persistence.
//
// DEV ONLY. Registered with `apply: 'serve'`, so it never runs during `vite
// build` and cannot reach production. It writes inside card-art/ only.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';

const ROOT = process.cwd();
const ART_DIR = resolve(ROOT, 'card-art');
const PHOTO_DIR = resolve(ART_DIR, 'photos');
const CROPS_FILE = resolve(ART_DIR, 'crops.json');
const TEAMS_FILE = resolve(ART_DIR, 'team-overrides.json');

const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function ensureDirs() {
  for (const dir of [ART_DIR, PHOTO_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

function readJsonFile(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return fallback;
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * A playerId is used to build a filesystem path, so it must not be able to
 * escape card-art/photos/. Card ids are of the form "Nikola_Jokic".
 */
function safePlayerId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_.-]+$/.test(id) && !id.includes('..');
}

export function studioServerPlugin() {
  return {
    name: 'card-studio-server',
    apply: 'serve',
    configureServer(server) {
      ensureDirs();

      server.middlewares.use('/__studio/state', (req, res) => {
        const photos = existsSync(PHOTO_DIR)
          ? readdirSync(PHOTO_DIR).filter(f => ALLOWED_EXT.has(extname(f).toLowerCase()))
          : [];
        json(res, 200, {
          photos: photos.map(f => f.replace(/\.[^.]+$/, '')),
          crops: readJsonFile(CROPS_FILE, {}),
          teamOverrides: readJsonFile(TEAMS_FILE, {}),
        });
      });

      server.middlewares.use('/__studio/photo', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const playerId = new URL(req.url, 'http://x').searchParams.get('playerId');
        if (!safePlayerId(playerId)) return json(res, 400, { error: 'invalid playerId' });
        const body = await readBody(req);
        if (!body.length) return json(res, 400, { error: 'empty body' });
        writeFileSync(resolve(PHOTO_DIR, `${playerId}.jpg`), body);
        json(res, 200, { ok: true, playerId });
      });

      server.middlewares.use('/__studio/crops', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const body = JSON.parse((await readBody(req)).toString('utf-8'));
        writeFileSync(CROPS_FILE, JSON.stringify(body, null, 2) + '\n');
        json(res, 200, { ok: true });
      });

      server.middlewares.use('/__studio/teams', async (req, res) => {
        if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
        const body = JSON.parse((await readBody(req)).toString('utf-8'));
        writeFileSync(TEAMS_FILE, JSON.stringify(body, null, 2) + '\n');
        json(res, 200, { ok: true });
      });
    },
  };
}
```

**Step 3: Register the plugin and serve card-art**

Modify `vite.config.js`:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { studioServerPlugin } from './scripts/studio/studioServerPlugin.js'

export default defineConfig({
  plugins: [react(), studioServerPlugin()],
  base: '/nba-showdown-2k25/',
  // Serve card-art/ (photos live outside public/ because they are working
  // files, not shipped assets — only the exported PNGs ship).
  publicDir: 'public',
  server: { fs: { allow: ['.'] } },
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
  },
})
```

For the studio to display photos, reference them as `/card-art/photos/{id}.jpg`; Vite's dev server serves project-root files when `server.fs.allow` includes the root.

**Step 4: Keep working files out of git**

Photos are large binaries and crop metadata is personal working state. Append to `.gitignore`:

```
card-art/photos
```

Keep `card-art/crops.json` and `card-art/team-overrides.json` **tracked** — they're small JSON and represent real design decisions worth versioning. Create `card-art/.gitkeep` so the directory exists.

**Step 5: Verify the studio boots**

Run: `npm run dev`, then open `http://localhost:5173/studio.html`.

Write a minimal `src/studio/Studio.jsx` that fetches `/__studio/state` and renders the JSON, just to prove the plumbing works:

```jsx
import { useEffect, useState } from 'react';

export default function Studio() {
  const [state, setState] = useState(null);
  useEffect(() => { fetch('/__studio/state').then(r => r.json()).then(setState); }, []);
  return <pre>{JSON.stringify(state, null, 2)}</pre>;
}
```

Expected: the page shows `{"photos": [], "crops": {}, "teamOverrides": {}}`.

**Step 6: Verify the studio is excluded from production**

Run: `npm run build`
Then: `ls dist/`
Expected: `dist/index.html` exists, **`dist/studio.html` does not**. If `studio.html` appears in `dist/`, stop — the dev-only guarantee is broken.

**Step 7: Commit**

```bash
git add studio.html src/studio/ scripts/studio/ vite.config.js .gitignore card-art/.gitkeep
git commit -m "feat(studio): add dev-only studio entry point and persistence middleware"
```

---

## Task 6: Studio — player list and photo drop

**Files:**
- Modify: `src/studio/Studio.jsx`
- Create: `src/studio/PlayerList.jsx`
- Create: `src/studio/Studio.module.css`

**Step 1: Load real card data**

The studio needs a player list. Per the note at the top of this plan, **new-pool card data does not exist yet** — so load from whichever source is available, preferring the new pool:

```js
// src/studio/loadCards.js
import { CARDS } from '../game/cards.js';

/**
 * Card records for the studio.
 *
 * Prefers the new season's generated data when present, and falls back to the
 * existing 306-card set so the studio is usable before the new pool's charts,
 * Speed/Power splits, and salaries have been generated.
 */
export async function loadStudioCards() {
  try {
    const res = await fetch('/card-data/generated/player-teams-2026.json');
    if (res.ok) {
      const pool = await res.json();
      return pool.map(p => ({
        id: p.name.replace(/[^A-Za-z0-9]+/g, '_'),
        name: p.name,
        team: p.team,
        pos: p.pos,
        personId: p.personId,
        // chart/speed/power/salary intentionally absent until generated —
        // CardTemplate renders placeholders for these.
      }));
    }
  } catch {
    // fall through to the existing set
  }
  return CARDS;
}
```

**Step 2: Build the player list with photo status**

`PlayerList.jsx` renders every player with a clear has-photo / needs-photo indicator, plus a count (e.g. "84 / 331 photos"), so set-wide progress is visible at a glance. Selecting a player sets the active card.

**Step 3: Wire drag-and-drop photo ingestion**

On drop, POST the file bytes to `/__studio/photo?playerId={id}`:

```js
async function uploadPhoto(playerId, file) {
  const res = await fetch(`/__studio/photo?playerId=${encodeURIComponent(playerId)}`, {
    method: 'POST',
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  return res.json();
}
```

After a successful upload, re-fetch `/__studio/state` so the photo indicator updates.

**Step 4: Manual verification**

Run `npm run dev`, open `/studio.html`:
1. The player list renders with a photo count.
2. Drag an image onto a player → the file appears at `card-art/photos/{playerId}.jpg`.
3. The indicator flips to "has photo".
4. The card preview shows the photo.

**Step 5: Commit**

```bash
git add src/studio/
git commit -m "feat(studio): add player list and drag-drop photo ingestion"
```

---

## Task 7: Studio — crop editor

**Files:**
- Create: `src/studio/CropEditor.jsx`
- Modify: `src/studio/Studio.jsx`

**Step 1: Build the crop controls**

Pan and zoom the photo within the card's photo window. Mouse drag adjusts `x`/`y`; a slider (or scroll wheel) adjusts `zoom`. State shape matches `DEFAULT_CROP` from `src/cards/photo.js`: `{ x, y, zoom }`.

Crop edits update the live `CardTemplate` preview immediately — that's the whole point of the tool.

**Step 2: Persist crops**

Debounce saves (~500ms after the last change) and POST the entire crops map to `/__studio/crops`:

```js
// { [playerId]: { x, y, zoom } }
await fetch('/__studio/crops', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(crops),
});
```

Debouncing matters: a drag fires many events, and each save rewrites the file.

**Step 3: Add a reset control**

A "reset crop" button restores `DEFAULT_CROP` for the selected player. Cheap, and makes experimentation safe.

**Step 4: Manual verification**

1. Select a player with a photo.
2. Drag the photo — the preview updates live.
3. Reload the page — the crop persists (check `card-art/crops.json`).
4. Confirm the original file in `card-art/photos/` is byte-identical to what was dropped (crop must be metadata only).

**Step 5: Commit**

```bash
git add src/studio/
git commit -m "feat(studio): add pan/zoom crop editor with persisted metadata"
```

---

## Task 8: Studio — team template editor

**Files:**
- Create: `src/studio/TeamEditor.jsx`
- Modify: `src/studio/Studio.jsx`
- Modify: `src/cards/teams.js`

**Step 1: Support overrides in the team table**

Add to `src/cards/teams.js`:

```js
/**
 * Team record with any studio overrides applied. Overrides are stored in
 * card-art/team-overrides.json and let colors be tuned per team without
 * editing this file.
 */
export function getThemedTeam(abbr, overrides = {}) {
  return { ...getTeam(abbr), ...(overrides[abbr] ?? {}) };
}
```

Add a test for it alongside the existing `teams.test.js` cases: an override replaces only the fields it specifies, and an unknown team still returns the fallback.

**Step 2: Build the editor UI**

Color pickers for `primary` and `secondary` on the selected player's team. Editing a color re-themes the preview immediately and applies to **every player on that team** — the "wider level" adjustment.

**Step 3: Persist overrides**

POST the map to `/__studio/teams`, same debounce pattern as crops.

**Step 4: Manual verification**

1. Select a Lakers player; change primary to bright red; the preview updates.
2. Select a different Lakers player — also red.
3. Select a Celtics player — unaffected.
4. Reload — the override persists in `card-art/team-overrides.json`.

**Step 5: Commit**

```bash
git add src/studio/ src/cards/teams.js src/cards/teams.test.js
git commit -m "feat(studio): add per-team color template editor"
```

---

## Task 9: Batch export to PNG

**Files:**
- Create: `scripts/studio/export.js`
- Create: `studio-export.html`
- Create: `src/studio/ExportFrame.jsx`
- Modify: `package.json`

**Step 1: Add Playwright**

```bash
npm install --save-dev playwright
npx playwright install chromium
```

**Step 2: Create a single-card render page**

`studio-export.html` mirrors `studio.html` but mounts `ExportFrame`, which reads `?playerId=` from the URL and renders exactly one `CardTemplate` — no studio chrome, nothing else on the page. Reusing the same component is what guarantees the export matches the preview.

```jsx
// src/studio/ExportFrame.jsx
import { useEffect, useState } from 'react';
import CardTemplate from '../cards/CardTemplate.jsx';
import { loadStudioCards } from './loadCards.js';

export default function ExportFrame() {
  const [ready, setReady] = useState(null);
  const playerId = new URLSearchParams(location.search).get('playerId');

  useEffect(() => {
    (async () => {
      const [cards, state] = await Promise.all([
        loadStudioCards(),
        fetch('/__studio/state').then(r => r.json()),
      ]);
      const card = cards.find(c => c.id === playerId);
      setReady({ card, crop: state.crops[playerId], hasPhoto: state.photos.includes(playerId) });
    })();
  }, [playerId]);

  if (!ready?.card) return <div id="export-error">unknown playerId: {playerId}</div>;
  return (
    <div id="export-root">
      <CardTemplate card={ready.card} crop={ready.crop} hasPhoto={ready.hasPhoto} />
    </div>
  );
}
```

**Step 3: Write the export script**

```js
// scripts/studio/export.js
// Run: npm run export:cards   (the dev server must be running)
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.STUDIO_URL ?? 'http://localhost:5173';
const OUT = resolve(process.cwd(), 'public/cards/players');
const CARD_WIDTH = 843;
const CARD_HEIGHT = 1181;

const cards = await fetch(`${BASE}/card-data/generated/player-teams-2026.json`)
  .then(r => (r.ok ? r.json() : null))
  .catch(() => null);

if (!cards) {
  throw new Error(
    `export: could not load player data from ${BASE}. Is the dev server running (npm run dev)?`
  );
}

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: CARD_WIDTH, height: CARD_HEIGHT } });

let done = 0;
for (const player of cards) {
  const playerId = player.name.replace(/[^A-Za-z0-9]+/g, '_');
  await page.goto(`${BASE}/studio-export.html?playerId=${encodeURIComponent(playerId)}`, {
    waitUntil: 'networkidle',
  });

  const error = await page.$('#export-error');
  if (error) {
    console.warn(`SKIP ${playerId}: ${await error.textContent()}`);
    continue;
  }

  const el = await page.$('#export-root > *');
  if (!el) {
    console.warn(`SKIP ${playerId}: card element did not render`);
    continue;
  }

  await el.screenshot({ path: resolve(OUT, `${playerId}.png`) });
  done++;
  if (done % 25 === 0) console.log(`  ...${done}/${cards.length}`);
}

await browser.close();
console.log(`exported ${done}/${cards.length} cards to public/cards/players/`);
```

**Step 4: Add the npm script**

In `package.json` `"scripts"`, add:

```json
"export:cards": "node scripts/studio/export.js"
```

**Step 5: Verify the export**

With `npm run dev` running in one terminal:

Run: `npm run export:cards`
Expected: per-25 progress lines, then a final count.

Then verify the output is print-correct:

```bash
python3 -c "
from PIL import Image
import glob
f = sorted(glob.glob('public/cards/players/*.png'))[0]
im = Image.open(f); print(f, im.size)
assert im.size == (843, 1181), f'wrong size: {im.size}'
print('OK')
"
```

Expected: `(843, 1181)` and `OK`. Any other dimensions mean the card element isn't rendering at its fixed size — fix that before proceeding, because every exported card is wrong otherwise.

**Step 6: Confirm re-runnability**

Run `npm run export:cards` a second time. It should overwrite cleanly with no errors — this is what makes "stats changed, re-export" a one-command operation.

**Step 7: Commit**

```bash
git add scripts/studio/export.js studio-export.html src/studio/ExportFrame.jsx package.json package-lock.json
git commit -m "feat(studio): add batch card export to print-size PNGs"
```

---

## Verification checklist

Before considering this complete:

- [ ] `npm test` passes (28 existing + new tests).
- [ ] `npm run build` succeeds and `dist/studio.html` does **not** exist.
- [ ] `node scripts/cardgen/generateTeams.js` reports **0 remaining** `2TM`/`3TM` codes.
- [ ] Studio loads at `/studio.html`, lists players, and shows a photo count.
- [ ] Dropping a photo writes to `card-art/photos/` and updates the preview.
- [ ] Crops persist across a reload and never modify the source image.
- [ ] A team color change applies to every player on that team.
- [ ] `npm run export:cards` writes PNGs at exactly 843×1181.
- [ ] `git status` shows no stray photo binaries staged (they're gitignored).

## Rollback plan

Each task is one commit, so any single task can be reverted independently:

```bash
git log --oneline -12
git revert <bad-sha>
```

Tasks 6-8 build on Task 5's plumbing, so revert those in reverse order if needed. Tasks 1-3 are standalone data work and can be kept even if the studio itself is rolled back.

## DRY / YAGNI notes

- **One card component, not two.** The studio preview and the PNG export render the identical `CardTemplate`, so they cannot drift. This is the central constraint of the design — do not add an export-specific card renderer.
- **Crop as metadata, never baked in.** Source photos stay untouched, so re-cropping never requires re-sourcing.
- **No router added.** A second Vite entry gives dev-only isolation without a new dependency or any change to the shipped app.
- **No photo search/sourcing in the studio** — drag-and-drop only, per the design's explicit scope.
- **No arbitrary element positioning, layer system, or per-card layout overrides.** Out of scope by design; that's a design-tool rabbit hole.
- **Headshot CDN is a fallback, not the look.** Curated action photos are the target for every card.
