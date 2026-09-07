// THE SYNTH — one AudioContext, one mute, two instruments.
//
// Extracted from packAudio.js when the game itself started making noise. The
// pack screen had all of it: a lazily-created context, a persisted mute, a
// tone() with overtones and filter sweeps, a noise() for air. None of that is
// about packs, and the alternative to moving it was a second AudioContext and
// a second mute switch that disagreed with the first one.
//
// ── WHY THERE ARE NO .MP3 FILES ─────────────────────────────────────────────
//
// Every sound is generated at play time. That buys back bytes in the bundle, a
// licence per clip, and a network round trip at the exact moment the player is
// waiting for something. It also means a sound is a NUMBER rather than a
// recording: a louder landing is the same tick with more gain, so tuning is
// editing a table instead of re-cutting audio.
//
// ── AUTOPLAY, AND WHY NOTHING HAPPENS UNTIL A CLICK ─────────────────────────
//
// Browsers refuse to start an AudioContext no gesture asked for, and a refused
// context does not throw — it sits in `suspended` and plays silence. So the
// context is created LAZILY on the first sound, which by construction happens
// inside a gesture (the player tapped a card, pressed Roll), and resume() is
// called every time in case the tab was backgrounded. A browser that still
// says no gets silence and no errors.
//
// ── SOUND IS A GARNISH AND MUST NEVER BREAK ANYTHING ────────────────────────
//
// Every entry point returns quietly on a null context. Nothing here is allowed
// to throw into a caller: not a pack open, and not a dice roll.
//
// ── THE MUTE IS THE PLAYER'S, AND IT PERSISTS ───────────────────────────────
//
// localStorage, read once at module load, defaulting to ON. A muted session
// that forgets itself is worse than no sound at all, and reading storage can
// throw outright in a private window, so every access is guarded.

const STORAGE_KEY = 'showdown-sound';

let ctx = null;
let muted = false;
try {
  muted = localStorage.getItem(STORAGE_KEY) === 'off';
} catch {
  muted = false;
}

export function isMuted() {
  return muted;
}

/** Flip the mute and persist it. Returns the new muted state. */
export function toggleMute() {
  muted = !muted;
  try {
    localStorage.setItem(STORAGE_KEY, muted ? 'off' : 'on');
  } catch {
    // A browser that refuses storage still gets the toggle for this session.
  }
  return muted;
}

/**
 * The shared AudioContext, created on first use inside a gesture.
 *
 * Returns null when audio is unavailable — an old browser, a locked-down one,
 * or a context the browser refused to build. Every caller treats null as
 * "no sound" rather than as an error.
 */
export function audio() {
  if (muted) return null;
  try {
    if (!ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    // A context can be suspended by the browser at any time (tab hidden, policy
    // change). Resuming an already-running context is a no-op.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/**
 * One note.
 *
 * `type` is the oscillator shape, and it is what makes the ladder audible: a
 * sine is soft and flute-like, a triangle has more edge, a sawtooth is bright
 * and brassy. The rarer the card, the brighter the wave.
 */
export function tone(ac, {
  freq, start = 0, dur = 0.3, gain = 0.12, type = 'sine', glide = 0,
  // The instrument's three knobs — see INSTRUMENTS. All optional; the defaults
  // reproduce the original chime exactly.
  overtone = null,   // { ratio, gain }: a second partial, e.g. a bell's inharmonic 2.76x
  detune = 0,        // cents on a second oscillator, for the Dissonance shimmer
  lowpass = null,    // { from, to }: a filter sweep, which is what makes a pluck
}) {
  const t0 = ac.currentTime + start;
  const amp = ac.createGain();
  let out = amp;
  if (lowpass) {
    const filter = ac.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(lowpass.from, t0);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, lowpass.to), t0 + dur);
    amp.connect(filter).connect(ac.destination);
  } else {
    amp.connect(ac.destination);
  }

  const voice = (f, g, cents = 0) => {
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    if (cents) osc.detune.setValueAtTime(cents, t0);
    // A glide is what turns two notes into one gesture — used for the whoosh.
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, glide), t0 + dur);
    const vg = ac.createGain();
    vg.gain.setValueAtTime(g, t0);
    osc.connect(vg).connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  };

  // Attack fast, decay slow. setValueAtTime(0) first: an exponential ramp from
  // exactly zero is undefined and silently produces nothing in some engines.
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur / 4));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  voice(freq, 1);
  if (detune) voice(freq, 0.7, detune);
  if (overtone) voice(freq * overtone.ratio, overtone.gain);
}

/** Filtered white noise — the air in a whoosh, and the fizz under a burst. */
export function noise(ac, { start = 0, dur = 0.25, gain = 0.06, from = 900, to = 200 }) {
  const t0 = ac.currentTime + start;
  const frames = Math.max(1, Math.floor(ac.sampleRate * dur));
  const buffer = ac.createBuffer(1, frames, ac.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1;

  const src = ac.createBufferSource();
  src.buffer = buffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(from, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  const amp = ac.createGain();
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

  src.connect(filter).connect(amp).connect(ac.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}
