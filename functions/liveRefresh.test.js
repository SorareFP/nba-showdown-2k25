// THE SERVER'S LIVE NUMBERS (2026-11-02; the user: "Go for it"). Read from the
// file the nightly job publishes with the site, so a burn, a listing floor and
// a pack slot see the rarity the player sees.
import { describe, it, expect } from 'vitest';
import { liveRefresher, LIVE_SALARIES_URL } from './liveRefresh.js';

const HOUR = 60 * 60 * 1000;
const clock = (t = 1000) => { const c = () => t; c.add = ms => { t += ms; }; return c; };
const site = (body = { cards: {} }, ok = true) => {
  const f = async url => { f.calls.push(url); if (f.fail) throw new Error(f.fail); return { ok, status: ok ? 200 : 404, json: async () => body }; };
  f.calls = [];
  return f;
};
const make = (over = {}) => {
  const now = over.now ?? clock();
  const fetchImpl = over.fetchImpl ?? site();
  const applied = [];
  const refresh = liveRefresher({ apply: f => { applied.push(f); return 1; }, fetchImpl, now, enabled: true, log: () => {}, ...over });
  return { refresh, fetchImpl, now, applied };
};

describe('the Live refresher', () => {
  it('reads the published file and hands it over', async () => {
    const { refresh, fetchImpl, applied } = make({ fetchImpl: site({ cards: { A: [900, 'BOS'] } }) });
    await refresh();
    expect(fetchImpl.calls).toEqual([LIVE_SALARIES_URL]);
    expect(applied).toEqual([{ cards: { A: [900, 'BOS'] } }]);
  });

  it('reads it once an hour, however many calls come in', async () => {
    const { refresh, fetchImpl, now } = make();
    await refresh();
    await refresh();
    now.add(HOUR - 1);
    await refresh();
    expect(fetchImpl.calls.length).toBe(1);
    now.add(2);
    await refresh();
    expect(fetchImpl.calls.length).toBe(2);
  });

  it('shares one read among calls that arrive together', async () => {
    const { refresh, fetchImpl } = make();
    await Promise.all([refresh(), refresh(), refresh()]);
    expect(fetchImpl.calls.length).toBe(1);
  });

  it('never fails a call: the deployed numbers stand, and it tries again in five minutes', async () => {
    const fetchImpl = site();
    fetchImpl.fail = 'site down';
    const { refresh, applied, now } = make({ fetchImpl });
    await expect(refresh()).resolves.toBeNull();
    expect(applied).toEqual([]);
    now.add(60 * 1000);
    await refresh();
    expect(fetchImpl.calls.length).toBe(1);
    now.add(5 * 60 * 1000);
    fetchImpl.fail = null;
    await refresh();
    expect(applied.length).toBe(1);
  });

  it('treats a missing page as a failure', async () => {
    const { refresh, applied } = make({ fetchImpl: site({}, false) });
    await expect(refresh()).resolves.toBeNull();
    expect(applied).toEqual([]);
  });

  it('gives up on a slow site rather than hold a pack open', async () => {
    let signal = null;
    const fetchImpl = (url, opts) => { signal = opts.signal; return new Promise((_, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('timed out'))); }); };
    const { refresh } = make({ fetchImpl, timeoutMs: 5 });
    await expect(refresh()).resolves.toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it('does nothing away from Cloud Functions, so a test never reaches the network', async () => {
    const fetchImpl = site();
    const refresh = liveRefresher({ apply: () => 0, fetchImpl, enabled: false });
    await expect(refresh()).resolves.toBeNull();
    expect(fetchImpl.calls).toEqual([]);
  });
});
