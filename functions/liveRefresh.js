// THE NIGHT'S LIVE NUMBERS ON THE SERVER (2026-11-02; the user: "Go for it").
//
// The site is rebuilt every night with the Live Series' new salaries; the
// server's copy of the cards is frozen at the last functions deploy. So a burn,
// a listing floor and a pack slot could read one rarity while the player saw
// another: 70 of 469 had drifted within five days. No API and no key: the job
// publishes a small public file with the site (generateLive.js liveSalariesBody)
// and this reads it like any web page, once an hour.
//
// It never fails a call. A site that is down or slow leaves the numbers already
// in hand, from the last read or the deploy, and tries again in five minutes.
// A call awaits the read, so a cold start prices on tonight's numbers, and the
// timeout is what keeps that from ever holding a pack open.
export const LIVE_SALARIES_URL = 'https://sorarefp.github.io/nba-showdown-2k25/live-salaries.json';

const FRESH_MS = 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;
const TIMEOUT_MS = 1500;

/**
 * `apply` takes the parsed file (cardSets.js applyLiveSalaries). Off anywhere
 * but Cloud Functions, whose runtime sets K_SERVICE, so a test never reaches
 * the network.
 */
export function liveRefresher({
  apply,
  url = LIVE_SALARIES_URL,
  fetchImpl = (...args) => globalThis.fetch(...args),
  now = Date.now,
  enabled = Boolean(process.env.K_SERVICE),
  timeoutMs = TIMEOUT_MS,
  log = console.warn,
}) {
  let nextAt = 0;
  let reading = null;
  const read = async () => {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const moved = apply(await res.json());
      nextAt = now() + FRESH_MS;
      return moved;
    } catch (e) {
      nextAt = now() + RETRY_MS;
      log(`Live salaries not read, keeping the numbers in hand: ${e.message}`);
      return null;
    } finally {
      reading = null;
    }
  };
  return () => {
    if (!enabled || now() < nextAt) return Promise.resolve(null);
    reading ??= read();
    return reading;
  };
}
