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
      tone(ac, { freq: 784, dur: 0.16, gain: 0.075, type: 'triangle' });
      tone(ac, { freq: 1175, start: 0.09, dur: 0.3, gain: 0.07, type: 'triangle', overtone: { ratio: 2, gain: 0.3 } });
      break;
    case 'top':
      tone(ac, { freq: 988, dur: 0.28, gain: 0.07, type: 'triangle', overtone: { ratio: 2.2, gain: 0.25 } });
      break;
    case 'fumble':
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
