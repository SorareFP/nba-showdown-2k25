import { useState, useEffect, useRef } from 'react';
import styles from './GameLog.module.css';
import { ENGINE_STAMP } from '../../game/engine.js';

/**
 * `docked`: the wide-monitor rail beside the court (PlayTab, useIsWide). The
 * log is always open there and fills the rail's height, so the whole game
 * reads at a glance; there is nothing to fold.
 */
export default function GameLog({ log, docked = false, defaultOpen = false }) {
  // `defaultOpen`: under the court on a roomy screen (PlayTab/PvpGame,
  // useIsRoomy), open from the start and still foldable.
  const [openState, setOpen] = useState(defaultOpen);
  const open = docked || openState;
  // NEWEST FIRST (the user, 2026-09-25: "Can we make the most current part of
  // the game log appear on top and push old stuff down?"). A new line lands at
  // the top, so the list is brought back to the top when one arrives (within
  // the log only, never the page). The Copy button keeps the game's own order,
  // oldest first, since a bug report reads forwards.
  const scrollRef = useRef(null);
  useEffect(() => {
    if (open && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [log.length, open]);

  const last = log[log.length - 1];

  // COPY THE WHOLE LOG, VERBATIM, WITH ITS TEAM TAGS. A bug report is only as
  // good as the log behind it, and a log retyped by hand loses the order and
  // the lines that did not seem to matter. One click, paste anywhere.
  const [copied, setCopied] = useState(false);
  const copyLog = async () => {
    const header = `NBA Showdown log · engine ${ENGINE_STAMP} · copied ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`;
    const text = [header, ...log.map(e => `[${e.team ?? '—'}] ${e.msg}`)].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy the game log:', text);
    }
  };

  return (
    <div className={`${styles.panel} ${docked ? styles.docked : ''}`}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        {docked ? (
          <div className={styles.toggle} style={{ flex: 1 }}>
            <span className={styles.toggleTitle}>Game Log</span>
            <span className={styles.last} />
            <span className={styles.count}>{log.length} entries</span>
          </div>
        ) : (
          <button className={styles.toggle} style={{ flex: 1 }} onClick={() => setOpen(o => !o)}>
            <span className={styles.toggleTitle}>Game Log</span>
            <span className={styles.last}>{last ? last.msg.substring(0,60)+(last.msg.length>60?'…':'') : 'Game started'}</span>
            <span className={styles.count}>{log.length} entries</span>
            <span>{open ? '▲' : '▼'}</span>
          </button>
        )}
        <button className={styles.toggle} style={{ flex: '0 0 auto', padding: '0 10px' }} onClick={copyLog} title="Copy the whole log to the clipboard">
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      {open && (
        <div className={styles.scroll} ref={scrollRef}>
          {log.map((entry, i) => ({ entry, i })).reverse().map(({ entry, i }) => (
            <div key={i} className={`${styles.entry} ${entry.team ? styles['team'+entry.team] : styles.sys}`}>
              {entry.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
