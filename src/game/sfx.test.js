// THE CLIPS AND THE ANNOUNCER (2026-09-16), without a browser: no
// AudioContext means every sample call answers false — the synth's turn — and
// nothing throws; the announcer speaks through whatever speech API exists,
// gates the second line behind the first marker, and goes quiet when muted.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SAMPLES, playSfx, hasSfx, preloadSfx, _resetSfx } from './sfx.js';
import { LINES, announce, announceMarker, _resetAnnouncer } from './announcer.js';
import { toggleMute, isMuted } from './audioEngine.js';
import { newGame, noteCheckFx } from './engine.js';
import { CARDS } from './cards.js';

describe('the clips', () => {
  beforeEach(() => _resetSfx());
  it('name every moment and answer false without a context, so the synth plays instead', () => {
    for (const k of ['bounce', 'swish', 'rim', 'whistle', 'roar', 'groan', 'heating_up', 'on_fire']) expect(SAMPLES[k]?.file).toBeTruthy();
    expect(playSfx('swish')).toBe(false);
    expect(playSfx('nope')).toBe(false);
    expect(hasSfx('swish')).toBe(false);
    expect(() => preloadSfx()).not.toThrow();
  });
});

describe('the announcer', () => {
  let spoken;
  beforeEach(() => {
    _resetAnnouncer();
    spoken = [];
    globalThis.SpeechSynthesisUtterance = function (text) { this.text = text; };
    globalThis.speechSynthesis = { cancel: () => {}, getVoices: () => [], speak: u => spoken.push(u.text) };
  });
  afterEach(() => {
    delete globalThis.SpeechSynthesisUtterance;
    delete globalThis.speechSynthesis;
    vi.restoreAllMocks();
  });
  it('says the first line at one marker and the second at two, nothing at three, and one line per moment', () => {
    expect(announceMarker(1, { now: 1000 })).toBe(true);
    expect(announceMarker(2, { now: 1200 })).toBe(false);      // too soon: one line, not two on top of each other
    expect(announceMarker(2, { now: 5000 })).toBe(true);
    expect(announceMarker(3, { now: 9000 })).toBe(false);
    expect(announceMarker(0, { now: 12000 })).toBe(false);
    expect(spoken).toEqual([LINES.heating_up, LINES.on_fire]);
  });
  it('is silent when muted, and never throws without a speech API', () => {
    toggleMute();
    try { expect(announce('heating_up', { now: 1000 })).toBe(false); } finally { if (isMuted()) toggleMute(); }
    delete globalThis.speechSynthesis;
    expect(announce('on_fire', { now: 50000 })).toBe(false);
    expect(spoken).toEqual([]);
  });
});

describe('the check note', () => {
  it('numbers every 3PT or paint check in sequence, and skips free throws', () => {
    const g = newGame(CARDS.slice(0, 10), CARDS.slice(10, 20));
    expect(g.checkFx).toBeUndefined();
    noteCheckFx(g, { hit: true, pts: 3 }, '3pt', 'A');
    expect(g.checkFx).toEqual({ seq: 1, hit: true, type: '3pt', teamKey: 'A', pts: 3 });
    noteCheckFx(g, { hit: false, pts: 0 }, 'paint', 'B');
    expect(g.checkFx).toEqual({ seq: 2, hit: false, type: 'paint', teamKey: 'B', pts: 0 });
    noteCheckFx(g, { hit: true, pts: 1 }, 'ft', 'A');
    expect(g.checkFx.seq).toBe(2);
  });
});
