// A CRASH IS A SCREEN, NOT A BLANK PAGE (2026-09-23).
//
// The app had no error boundary: one render error anywhere unmounted the whole
// tree and left a white page — and a player looking at a white page mid-game
// believes the game is gone. The user, the same day, after losing one: "That's
// a 'fuck this game' moment when people quit, so we should make sure it never
// happens."
//
// This catches it, says the game is saved (it is: every change was written
// before the render that failed), and offers two ways out. Reload is enough
// for anything transient. If the saved game itself is what breaks the screen,
// "Set it aside" moves it to the backups (writeLocalGame(null) keeps an
// in-progress game before it clears) so the rest of the app works, and it
// can be recovered from the Play screen once the bug is fixed. Nothing here
// ever deletes a game.
import { Component } from 'react';
import { writeLocalGame } from '../game/gameSave.js';

const box = {
  maxWidth: 520, margin: '48px auto', padding: '24px 22px', borderRadius: 12,
  background: 'var(--card-bg)', border: '1px solid var(--border)', textAlign: 'center',
};
const btn = {
  padding: '10px 18px', borderRadius: 8, border: 'none', cursor: 'pointer',
  fontWeight: 700, fontSize: 14, margin: '6px',
};

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Showdown crashed on this screen:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={box}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🏀</div>
        <h2 style={{ margin: '0 0 8px' }}>Something broke on this screen</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.5, margin: '0 0 14px' }}>
          Your game in progress is saved. Reload to pick it back up. If this screen keeps coming back,
          set the game aside: it is kept under <b>Recover a game</b> on the Play screen, and nothing is lost.
        </p>
        <div>
          <button style={{ ...btn, background: 'var(--orange)', color: '#fff' }} onClick={() => window.location.reload()}>
            Reload
          </button>
          <button
            style={{ ...btn, background: 'rgba(255,255,255,0.1)', color: 'var(--text)' }}
            onClick={() => { writeLocalGame(null); window.location.reload(); }}
          >
            Set the game aside and reload
          </button>
        </div>
        <details style={{ marginTop: 14, textAlign: 'left', fontSize: 12, color: 'var(--text-dim)' }}>
          <summary>What went wrong</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{String(error?.stack ?? error)}</pre>
        </details>
      </div>
    );
  }
}
