import { useEffect, useRef } from 'react';
import styles from './GameLog.module.css';

export default function GameLog({ log }) {
  const bottomRef = useRef(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [log.length]);

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Game Log</div>
      <div className={styles.scroll}>
        {log.length === 0 && <div className={styles.empty}>Game started — both teams drew 7 cards. Draft order: A B B A A B B A A B</div>}
        {log.map((entry, i) => (
          <div key={i} className={`${styles.entry} ${entry.team ? styles[`team${entry.team}`] : styles.sys}`}>
            {entry.msg}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
