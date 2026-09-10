import { describe, it, expect, afterEach } from 'vitest';
import { phoneNavTabs, PHONE_BAR } from './phoneNav.js';
import { isPhoneNow, PHONE_QUERY } from './useIsPhone.js';

const t = id => ({ id, label: id });

describe('the phone bottom bar', () => {
  it('gives a guest every section and no More', () => {
    const { bar, more } = phoneNavTabs([t('home'), t('howtoplay')]);
    expect(bar.map(x => x.id)).toEqual(['home', 'howtoplay']);
    expect(more).toEqual([]);
  });

  it('puts the four everyday sections on the bar and the rest behind More', () => {
    const tabs = ['builder', 'play', 'season', 'tournament', 'pvp', 'collection', 'howtoplay'].map(t);
    const { bar, more } = phoneNavTabs(tabs);
    expect(bar.map(x => x.id)).toEqual(PHONE_BAR);
    expect(more.map(x => x.id)).toEqual(['tournament', 'pvp', 'howtoplay']);
    expect(bar.length + 1).toBeLessThanOrEqual(5);           // four plus the More button
  });

  it('never loses a section: bar and More together are the whole list', () => {
    const tabs = ['builder', 'play', 'season', 'tournament', 'pvp', 'collection', 'howtoplay'].map(t);
    const { bar, more } = phoneNavTabs(tabs);
    expect([...bar, ...more].map(x => x.id).sort()).toEqual(tabs.map(x => x.id).sort());
  });
});

describe('isPhoneNow', () => {
  const real = globalThis.matchMedia;
  afterEach(() => { globalThis.matchMedia = real; });

  it('is false where matchMedia does not exist, so servers and tests get the desktop layout', () => {
    globalThis.matchMedia = undefined;
    expect(isPhoneNow()).toBe(false);
  });

  it('asks the phone query', () => {
    let asked = null;
    globalThis.matchMedia = q => { asked = q; return { matches: true }; };
    expect(isPhoneNow()).toBe(true);
    expect(asked).toBe(PHONE_QUERY);
  });
});
