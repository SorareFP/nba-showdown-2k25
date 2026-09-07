import { useState, useEffect, useRef } from 'react';
import styles from './GameLog.module.css';
import { ENGINE_STAMP } from '../../game/engine.js';

export default function GameLog({ log }) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef(null);
  const bottomRef = useRef(null);
  useEffect(() => {
    // Scroll only within the log container, not the whole page
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
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
    <div className={styles.panel}>
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button className={styles.toggle} style={{ flex: 1 }} onClick={() => setOpen(o => !o)}>
          <span className={styles.toggleTitle}>Game Log</span>
          <span className={styles.last}>{last ? last.msg.substring(0,60)+(last.msg.length>60?'…':'') : 'Game started'}</span>
          <span className={styles.count}>{log.length} entries</span>
          <span>{open ? '▲' : '▼'}</span>
        </button>
        <button className={styles.toggle} style={{ flex: '0 0 auto', padding: '0 10px' }} onClick={copyLog} title="Copy the whole log to the clipboard">
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      {open && (
        <div className={styles.scroll} ref={scrollRef}>
          {log.map((entry, i) => (
            <div key={i} className={`${styles.entry} ${entry.team ? styles['team'+entry.team] : styles.sys}`}>
              {entry.msg}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
