// THE SAMPLES — recorded sounds, on the same AudioContext as the synth.
//
// audioEngine.js was written on "no audio files", and its reasons still hold
// for punctuation: a roll every few seconds wants a number, not a download.
// What changed (2026-09-16, the user: "I want to add to the visual and audio
// feedback of the game") is the moments that are EVENTS — a made check, a
// missed one, the crowd, the whistle into Crunch Time, the announcer — which
// read better as the real thing. A handful of short clips, CC0 from Freesound
// (public/sounds/CREDITS.md), fetched once after the first gesture and decoded
// into memory. Until they arrive, or if they never do, every cue falls back
// to the synth it stands in for, so the game is never silent and never throws.
//
// ── THE MUTE IS STILL THE ONE MUTE ──────────────────────────────────────────
//
// audio() returns null while muted, and everything here goes through it, so
// the SoundToggle silences the clips the way it silences the synth.
import { audio } from './audioEngine.js';

// The app ships under a base path (vite.config.js); Node has no import.meta.env.
const BASE = `${(typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/'}sounds/`;

/**
 * name → file, gain, and the slice of the clip to play, in seconds. A Freesound
 * clip often carries several takes; `offset`/`dur` pick one, `fade` eases a
 * crowd out rather than cutting it.
 */
export const SAMPLES = {
  bounce:     { file: 'bounce.mp3',     gain: 0.55 },
  swish:      { file: 'swish.mp3',      gain: 0.7,  dur: 1.4 },
  rim:        { file: 'rim.mp3',        gain: 0.6,  dur: 1.2 },
  whistle:    { file: 'whistle.mp3',    gain: 0.5 },
  roar:       { file: 'roar.mp3',       gain: 0.35, offset: 0.4, dur: 3.2, fade: 0.9 },
  groan:      { file: 'groan.mp3',      gain: 0.45, dur: 2.2, fade: 0.5 },
  // The first hot marker is an ember, not a line (the user, 2026-09-16:
  // "remove the heating up voice and just use like an ember sound"); the
  // second is the announcer's one line — a recorded voice, when there is one.
  ember:      { file: 'ember.mp3',      gain: 0.6, dur: 1.6, fade: 0.5 },
  on_fire:    { file: 'on-fire.mp3',    gain: 0.9 },
};

const buffers = new Map();   // name → AudioBuffer, or null once a fetch has failed
const loading = new Map();
let warmed = false;

function load(name) {
  if (buffers.has(name)) return Promise.resolve(buffers.get(name));
  if (loading.has(name)) return loading.get(name);
  const ac = audio();
  if (!ac || typeof fetch !== 'function') return Promise.resolve(null);
  const p = (async () => {
    try {
      const res = await fetch(BASE + SAMPLES[name].file);
      if (!res.ok) throw new Error(String(res.status));
      const buf = await ac.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, buf);
      return buf;
    } catch {
      buffers.set(name, null);   // missing or undecodable: the synth stands in, and we do not ask again
      return null;
    } finally {
      loading.delete(name);
    }
  })();
  loading.set(name, p);
  return p;
}

/** Warm every clip. Called from the first cue that plays, which is inside a gesture. */
export function preloadSfx() {
  if (warmed) return;
  if (!audio()) return;          // no context yet (muted, or no gesture): try again on the next cue
  warmed = true;
  for (const name of Object.keys(SAMPLES)) load(name);
}

/** Is a clip in memory right now? */
export function hasSfx(name) {
  return Boolean(buffers.get(name));
}

/**
 * Play a clip if it is in memory. Returns false when it is not — muted, no
 * context, not loaded yet, or missing — and the caller plays its synth.
 */
export function playSfx(name, { gain = 1 } = {}) {
  const spec = SAMPLES[name];
  const ac = audio();
  if (!spec || !ac) return false;
  const buf = buffers.get(name);
  if (!buf) { preloadSfx(); return false; }
  try {
    const src = ac.createBufferSource();
    src.buffer = buf;
    const g = ac.createGain();
    const level = spec.gain * gain;
    const offset = spec.offset || 0;
    const dur = Math.min(spec.dur ?? buf.duration - offset, buf.duration - offset);
    const t0 = ac.currentTime;
    g.gain.setValueAtTime(level, t0);
    if (spec.fade && dur > spec.fade) {
      g.gain.setValueAtTime(level, t0 + dur - spec.fade);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
    }
    src.connect(g).connect(ac.destination);
    src.start(t0, offset, dur);
    return true;
  } catch {
    return false;
  }
}

/** For tests: forget every clip. */
export function _resetSfx() {
  buffers.clear();
  loading.clear();
  warmed = false;
}
