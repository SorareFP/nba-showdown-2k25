// The mute, where you can find it.
//
// It has always existed — packAudio has had a persisted mute since the pack
// screen got sound — but the only control for it was a small button inside the
// pack-opening overlay. That was fine while the packs were the only thing
// making noise. Now the game does, so the switch belongs in the header, next
// to the sign-in button, reachable from every screen.
//
// One switch for everything: the same localStorage key the packs read, so
// muting mid-game also mutes the next pack.
import { useState } from 'react';
import { isMuted, toggleMute } from '../game/audioEngine.js';
import styles from './SoundToggle.module.css';

export default function SoundToggle() {
  const [quiet, setQuiet] = useState(isMuted);
  return (
    <button
      type="button"
      className={styles.btn}
      aria-pressed={quiet}
      aria-label={quiet ? 'Turn sound on' : 'Turn sound off'}
      title={quiet ? 'Sound is off' : 'Sound is on'}
      onClick={() => setQuiet(toggleMute())}
    >
      {quiet ? '🔇' : '🔊'}
    </button>
  );
}
