// THE SAVED DUNKSANDTHREES TABLE (2026-11-12): what `npm run live:dt` reads, seals and opens.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  parseSavedPage, seal, unseal, newKey, newestSaved, ensureKey, daysOld, DT_DATA_LINK, DT_KEY_NAME,
} from './dtTable.js';

/** SvelteKit's devalue wire format, as in sources/dunksAndThrees.test.js. */
function flatten(value) {
  const out = [];
  const seen = new Map();
  const put = v => {
    if (v === undefined) return -1;
    const key = typeof v === 'object' && v !== null ? v : `${typeof v}:${String(v)}`;
    if (seen.has(key)) return seen.get(key);
    const index = out.length;
    out.push(null);
    seen.set(key, index);
    if (Array.isArray(v)) out[index] = v.map(put);
    else if (v && typeof v === 'object') out[index] = Object.fromEntries(Object.entries(v).map(([k, c]) => [k, put(c)]));
    else out[index] = v;
    return index;
  };
  put(value);
  return out;
}
const row = (name, over = {}) => ({ player_name: name, player_id: 7, team_alias: 'SAS', tot: 7.8, off: 3.8, def: 4.0, p_pts_100: 36.5, p_mp_48: 33, ...over });
const page = (rows, season = 2027) => JSON.stringify({
  nodes: [{ type: 'skip' }, { type: 'data', data: flatten({ season, date: '2026-11-11', stats: rows }) }],
});

describe('a saved page', () => {
  it('reads the raw JSON a browser saves into the rows a card reads', () => {
    const t = parseSavedPage(page([row('Victor Wembanyama'), row('Nikola Jokic', { off: 8.1 })]));
    expect(t).toMatchObject({ season: 2027, asOf: '2026-11-11' });
    expect(t.rows).toHaveLength(2);
    expect(t.rows[1]).toMatchObject({ name: 'Nikola Jokic', epmOff: 8.1, epmDef: 4, epm: 7.8, pts100: 36.5, team: 'SAS' });
  });

  it('reads it wrapped in a JSON viewer\'s page, with a byte-order mark', () => {
    const wrapped = `﻿<html><body><pre>${page([row('A Player')]).replaceAll('"', '&quot;')}</pre></body></html>`;
    expect(parseSavedPage(wrapped).rows[0].name).toBe('A Player');
  });

  it('says what to save instead of their 403 page or the wrong page', () => {
    expect(() => parseSavedPage('<html><head><title>403 Forbidden</title></head></html>')).toThrow(DT_DATA_LINK);
    expect(() => parseSavedPage(JSON.stringify({ nodes: [] }))).toThrow(/not dunksandthrees' expected page/);
    expect(() => parseSavedPage(page([row('Locked Player')]))).toThrow(/Locked Player/);
  });
});

describe('the sealed table', () => {
  const table = { season: 2027, asOf: '2026-11-11', savedAt: 'now', rows: [{ name: 'Victor Wembanyama', epmOff: 3.8 }] };

  it('opens with the key it was sealed with, and shows nothing without it', () => {
    const key = newKey();
    const sealed = seal(table, key);
    expect(unseal(sealed, key)).toEqual(table);
    expect(sealed.includes('Wembanyama')).toBe(false);
    expect(() => unseal(sealed, newKey())).toThrow(/does not open/);
  });

  it('refuses a missing or short key, and a file that is not a sealed table', () => {
    expect(() => seal(table, '')).toThrow(DT_KEY_NAME);
    expect(() => seal(table, Buffer.alloc(16).toString('base64'))).toThrow(/32-byte/);
    expect(() => unseal(Buffer.from('{"rows":[]}'), newKey())).toThrow(/not a sealed/);
  });
});

describe('finding the save and the key', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dt-table-'));

  it('takes the newest __data file in the folder, a second save included', () => {
    const dir = tmp();
    const put = (name, at) => {
      fs.writeFileSync(path.join(dir, name), '{}');
      fs.utimesSync(path.join(dir, name), at, at);
    };
    put('__data.json', 1000);
    put('__data (1).json', 2000);
    put('other.json', 3000);
    expect(path.basename(newestSaved(dir))).toBe('__data (1).json');
    expect(newestSaved(path.join(dir, 'nowhere'))).toBeNull();
  });

  it('uses the key in the environment, or adds a new one to the env file and keeps what was there', () => {
    expect(ensureKey('unused', { [DT_KEY_NAME]: 'abc' })).toEqual({ key: 'abc', created: false });
    const file = path.join(tmp(), '.env.local');
    fs.writeFileSync(file, 'OTHER_KEY=x');
    const { key, created } = ensureKey(file, {});
    expect(created).toBe(true);
    expect(Buffer.from(key, 'base64')).toHaveLength(32);
    expect(fs.readFileSync(file, 'utf8')).toBe(`OTHER_KEY=x\n${DT_KEY_NAME}=${key}\n`);
  });

  it('counts a table\'s age in whole days', () => {
    expect(daysOld('2026-11-11', new Date('2026-11-12T09:00:00Z'))).toBe(1);
    expect(daysOld('2026-11-12', new Date('2026-11-12T23:00:00Z'))).toBe(0);
  });
});
