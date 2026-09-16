// THE ANNOUNCER — two lines, at the first and second hot marker.
//
// The user, 2026-09-16: "He's heating up and he's on fire for the first and
// second hot markers." The recordings everyone knows are Midway's and cannot
// ship; the LINES can. A recorded voice goes in as sounds/heating-up.mp3 and
// sounds/on-fire.mp3 (sfx.js) and wins the moment it is there; until then the
// browser's own speech voice says them — a placeholder, and it sounds like
// one, but the moment fires where it should.
//
// A roll of 19+ puts a marker on (engine.js); the count AFTER the roll says
// which line. Markers from cards (Burst of Momentum, a Heat Check hit) do not
// announce — the roll is the moment the whole table is watching.
import { isMuted } from './audioEngine.js';
import { playSfx } from './sfx.js';

export const LINES = {
  heating_up: "He's heating up!",
  on_fire: "He's on fire!",
};

let lastAt = 0;
const GAP_MS = 1500;   // two markers in one section: one line, not two on top of each other

function speak(text) {
  const synth = globalThis.speechSynthesis;
  if (!synth || typeof globalThis.SpeechSynthesisUtterance !== 'function') return false;
  try {
    synth.cancel();
    const u = new globalThis.SpeechSynthesisUtterance(text);
    const voices = (typeof synth.getVoices === 'function' && synth.getVoices()) || [];
    const pick = voices.find(v => /^en/i.test(v.lang) && /male|david|daniel|guy|mark|james/i.test(v.name))
      || voices.find(v => /^en/i.test(v.lang))
      || null;
    if (pick) u.voice = pick;
    u.rate = 1.05;
    u.pitch = 0.6;
    u.volume = 1;
    synth.speak(u);
    return true;
  } catch {
    return false;
  }
}

/** Say a line by key. A recorded clip wins; speech is the placeholder. Never throws. */
export function announce(key, { now = Date.now() } = {}) {
  if (isMuted() || !LINES[key]) return false;
  if (lastAt && now - lastAt < GAP_MS) return false;
  lastAt = now;
  if (playSfx(key)) return true;
  return speak(LINES[key]);
}

/** The marker a roll just awarded: the count after it picks the line. */
export function announceMarker(hotAfter, opts) {
  if (hotAfter === 1) return announce('heating_up', opts);
  if (hotAfter === 2) return announce('on_fire', opts);
  return false;
}

/** For tests. */
export function _resetAnnouncer() {
  lastAt = 0;
}
