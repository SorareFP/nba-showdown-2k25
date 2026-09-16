// THE SOUND OF A GAME BEING PLAYED.
//
// The pack screen has had voice since the economy work; the game itself has
// been silent. Four cues, chosen because each marks a moment the player is
// already looking for and currently has to read off the screen to find:
//
//   the roll        the die leaving your hand — clatter, under the tumble
//   the landing     what it was worth, and the sound SCALES with the points,
//                   so a big bucket is audible before you read the number
//   crunch time     the game changing gear, which the log announces and
//                   nothing else does
//   the buzzer      it is over
//
// Same synth as the packs (audioEngine.js): one AudioContext, one mute, no
// audio files. See that file for the autoplay rules and why nothing here can
// throw into a caller.
//
// ── THESE ARE CUES, NOT A SOUNDTRACK ────────────────────────────────────────
//
// A D20 game has a roll every few seconds, so anything with a tail becomes a
// drone within a possession. Everything here is under a third of a second
// except the buzzer, and the gains are deliberately low: the loudest cue in
// this file is quieter than the quietest chime in the pack ladder, because a
// pack is an event and a roll is punctuation.
import { audio, tone, noise } from './audioEngine.js';
import { playSfx, preloadSfx } from './sfx.js';

/**
 * The die leaving your hand.
 *
 * Two short noise bursts rather than one, slightly apart and falling — that is
 * what makes it read as something tumbling rather than as a click. It plays
 * under the on-screen tumble, so it wants to be over before the number lands.
 */
export function playRoll() {
  const ac = audio();
  if (!ac) return;
  // The first cue of a game is the one that warms the clips (sfx.js): it is
  // inside the gesture that made the context, which is the only time that works.
  preloadSfx();
  if (playSfx('bounce')) return;
  noise(ac, { start: 0, dur: 0.09, gain: 0.05, from: 2600, to: 900 });
  noise(ac, { start: 0.11, dur: 0.07, gain: 0.035, from: 1900, to: 700 });
}

/**
 * What the roll was worth.
 *
 * `band` is RollResult's own classification, so the sound and the colour can
 * never disagree about what happened:
 *
 *   crit    a natural 20 — a bright rising third, the only cue with a lift
 *   top     the chart's last row — the same brightness, one note, because it
 *           is a good OUTCOME rather than a good die
 *   hit     a soft tick, pitched and gained by the points, so three points
 *           sounds bigger than one without being a different sound
 *   miss    a dull, short thud
 *   fumble  a natural 1 — low and buzzy, and still short
 */
export function playLanding(band, pts = 0) {
  const ac = audio();
  if (!ac) return;
  switch (band) {
    case 'crit':
      playSfx('roar');   // the crowd, over the chime; nothing if the clip is not here
      tone(ac, { freq: 784, dur: 0.16, gain: 0.075, type: 'triangle' });
      tone(ac, { freq: 1175, start: 0.09, dur: 0.3, gain: 0.07, type: 'triangle', overtone: { ratio: 2, gain: 0.3 } });
      break;
    case 'top':
      tone(ac, { freq: 988, dur: 0.28, gain: 0.07, type: 'triangle', overtone: { ratio: 2.2, gain: 0.25 } });
      break;
    case 'fumble':
      playSfx('groan');
      tone(ac, { freq: 110, dur: 0.22, gain: 0.075, type: 'sawtooth', lowpass: { from: 700, to: 160 } });
      break;
    case 'miss':
      tone(ac, { freq: 196, dur: 0.11, gain: 0.05, type: 'sine', lowpass: { from: 800, to: 300 } });
      break;
    default: {
      // The one cue that moves with the number. Capped at four points because
      // above that the interval stops reading as "bigger" and starts reading
      // as a different note.
      const step = Math.min(Math.max(pts, 1), 4);
      tone(ac, { freq: 392 + step * 66, dur: 0.13, gain: 0.045 + step * 0.006, type: 'sine' });
    }
  }
}

/**
 * Crunch time arming — the game changing gear in the fourth.
 *
 * A two-note fall, slow for this file, because it is the one cue that is not
 * punctuation: it says the rules just changed. See crunch in engine.js.
 */
export function playCrunch() {
  const ac = audio();
  if (!ac) return;
  playSfx('whistle');   // the referee, under the two-note fall
  tone(ac, { freq: 330, dur: 0.4, gain: 0.07, type: 'triangle', overtone: { ratio: 1.5, gain: 0.35 } });
  tone(ac, { freq: 247, start: 0.22, dur: 0.55, gain: 0.075, type: 'triangle', overtone: { ratio: 1.5, gain: 0.35 } });
}

/** The horn. Longer than everything else here, and it has earned it. */
export function playBuzzer() {
  const ac = audio();
  if (!ac) return;
  tone(ac, { freq: 175, dur: 1.1, gain: 0.085, type: 'sawtooth', lowpass: { from: 1400, to: 500 } });
  tone(ac, { freq: 233, dur: 1.1, gain: 0.06, type: 'sawtooth', lowpass: { from: 1400, to: 500 } });
}

/**
 * AN EMBER (2026-09-16): the first hot marker. The user: "remove the heating
 * up voice and just use like an ember sound." The clip is a crackle; the
 * synth stands in with four tiny bursts of air, falling, close together.
 * Returns whether anything played.
 */
export function playEmber() {
  const ac = audio();
  if (!ac) return false;
  if (playSfx('ember')) return true;
  noise(ac, { start: 0,    dur: 0.05, gain: 0.035, from: 3200, to: 1200 });
  noise(ac, { start: 0.09, dur: 0.04, gain: 0.03,  from: 2800, to: 1000 });
  noise(ac, { start: 0.2,  dur: 0.06, gain: 0.04,  from: 3600, to: 1400 });
  noise(ac, { start: 0.33, dur: 0.04, gain: 0.025, from: 2400, to: 900 });
  return true;
}

/**
 * A SHOT CHECK LANDING (2026-09-16): the net or the rim. The clips are the
 * point of this one — a swish is a swish — and the synth stands in until they
 * are here: a short bright tick for a make, a dull thud for a miss.
 */
export function playCheck(hit) {
  const ac = audio();
  if (!ac) return;
  if (playSfx(hit ? 'swish' : 'rim')) return;
  if (hit) tone(ac, { freq: 1318, dur: 0.12, gain: 0.05, type: 'triangle' });
  else tone(ac, { freq: 150, dur: 0.16, gain: 0.06, type: 'square', lowpass: { from: 900, to: 200 } });
}
