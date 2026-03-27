import { useState, useEffect, useRef } from 'react';
import styles from './GameLog.module.css';

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

  return (
    <div className={styles.panel}>
      <button className={styles.toggle} onClick={() => setOpen(o => !o)}>
        <span className={styles.toggleTitle}>Game Log</span>
        <span className={styles.last}>{last ? last.msg.substring(0,60)+(last.msg.length>60?'…':'') : 'Game started'}</span>
        <span className={styles.count}>{log.length} entries</span>
        <span>{open ? '▲' : '▼'}</span>
      </button>
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
