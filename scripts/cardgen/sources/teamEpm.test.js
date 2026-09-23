// The team-epm fetch (2026-09-23): the Live Series' nightly opponent table,
// validated the way season-epm is and cached under the key realGames.js reads.
import { describe, it, expect } from 'vitest';
import {
  FIRST_API_SEASON,
  REQUIRED_TEAM_EPM_FIELDS,
  fetchTeamEpm,
  parseTeamEpmRows,
  teamEpmCacheKey,
} from './dunksAndThreesApi.js';

const row = (over = {}) => ({
  season: 2027, seasontype: 2, game_dt: '2026-10-22', team_alias: 'OKC', team_depm: 4.2, ...over,
});

describe('team-epm', () => {
  it('caches under the key realGames.js reads for the opponent table', () => {
    expect(teamEpmCacheKey(2027)).toBe('dunksandthrees-api-team-epm-2027');
  });

  it('believes a body only when it has the columns the adjustment reads and echoes the season', () => {
    expect(parseTeamEpmRows([row()], { season: 2027 })).toEqual([row()]);
    expect(() => parseTeamEpmRows([], { season: 2027 })).toThrow(/no rows/);
    expect(() => parseTeamEpmRows(null, { season: 2027 })).toThrow(/no rows/);
    const { team_depm, ...noDepm } = row();
    expect(() => parseTeamEpmRows([noDepm], { season: 2027 })).toThrow(/missing expected fields: team_depm/);
    expect(() => parseTeamEpmRows([row(), row({ season: 2026 })], { season: 2027 })).toThrow(/served season 2026, not 2027/);
    expect(REQUIRED_TEAM_EPM_FIELDS).toEqual(['season', 'game_dt', 'team_alias', 'team_depm']);
  });

  it("refuses a season below the API's coverage without making a request", async () => {
    await expect(fetchTeamEpm(FIRST_API_SEASON - 1)).rejects.toThrow(new RegExp(`${FIRST_API_SEASON} or later`));
    await expect(fetchTeamEpm('2027')).rejects.toThrow(/integer year/);
  });
});
