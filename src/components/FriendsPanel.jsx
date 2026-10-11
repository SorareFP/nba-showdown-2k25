// THE FRIENDS PAGE (2026-10-11) — docs/plans/2026-10-11-friends-design.md.
// Your code to give out, a box for a friend's, requests both ways, your
// friends and how close they are, and the people you've played (one tap).
import { useState } from 'react';
import { useFriends } from '../firebase/FriendsProvider.jsx';
import { requestFriend, answerFriendRequest, removeFriend } from '../firebase/friends.js';
import { useDialogs } from '../ui/dialogs.jsx';
import s from './FriendsPanel.module.css';

const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
// How a request arrived (final review, 2026-10-11): a name is the sender's to
// set, so the page says what the server knows.
const VIA = { code: 'used your friend code', league: 'played you in a league', pvp: 'played you head to head' };

export default function FriendsPanel() {
  const { overview, error, refresh } = useFriends();
  const { ask, toast } = useDialogs();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);

  const run = async (key, fn, done) => {
    setBusy(key);
    try {
      const r = await fn();
      if (done) toast(done(r), { tone: 'success' });
      await refresh();
    } catch (e) {
      toast(e?.message ?? String(e), { tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  if (!overview) {
    return <div className={s.wrap}><p className={s.muted}>{error ?? 'Loading your friends…'}</p></div>;
  }
  const { friends, incoming, outgoing, playedWith } = overview;

  return (
    <div className={s.wrap}>
      <section className={s.block}>
        <h3 className={s.title}>Your friend code</h3>
        <div className={s.row}>
          <span className={s.code} data-my-code={overview.code}>{overview.code}</span>
          <button className={s.secondary} onClick={() => navigator.clipboard?.writeText(overview.code).then(() => toast('Copied', { tone: 'success' }))}>Copy</button>
        </div>
        <p className={s.muted}>Send it to a friend. They type it below on their account, and you accept.</p>
        <form className={s.row} onSubmit={e => { e.preventDefault(); run('code', () => requestFriend({ code }), r => (r.friends ? 'You are friends now' : 'Request sent')); setCode(''); }}>
          <input className={s.input} value={code} onChange={e => setCode(e.target.value)} placeholder="Friend's code" maxLength={12} aria-label="Friend code" />
          <button className={s.primary} disabled={!code.trim() || busy === 'code'}>Send request</button>
        </form>
      </section>

      {incoming.length > 0 && (
        <section className={s.block}>
          <h3 className={s.title}>Requests for you</h3>
          {incoming.map(r => (
            <div key={r.id} className={s.row} data-incoming={r.id}>
              <span className={s.name}>{r.name} <span className={s.muted}>· {VIA[r.via] ?? VIA.code}</span></span>
              <button className={s.primary} disabled={busy === r.id} onClick={() => run(r.id, () => answerFriendRequest({ id: r.id, accept: true }), () => `You and ${r.name} are friends`)}>Accept</button>
              <button className={s.secondary} disabled={busy === r.id} onClick={() => run(r.id, () => answerFriendRequest({ id: r.id, accept: false }))}>Decline</button>
            </div>
          ))}
        </section>
      )}

      <section className={s.block}>
        <h3 className={s.title}>Friends <span className={s.muted}>{friends.length}</span></h3>
        {friends.length === 0 && <p className={s.muted}>No friends yet.</p>}
        {friends.map(f => (
          <div key={f.uid} className={s.row} data-friend={f.uid}>
            <span className={s.name}>{f.name}</span>
            <span className={s.muted}>{f.needs.length ? `needs ${plural(new Set(f.needs.map(n => n.cardKey)).size, 'card')} to finish a collection` : 'nothing close'}</span>
            <button className={s.danger} disabled={busy === f.uid} onClick={async () => {
              if (!await ask({ title: `Remove ${f.name}?`, body: 'You stop seeing what each other needs.', confirmLabel: 'Remove', tone: 'danger' })) return;
              run(f.uid, () => removeFriend({ uid: f.uid }));
            }}>Remove</button>
          </div>
        ))}
        {outgoing.map(r => (
          <div key={r.id} className={s.row}>
            <span className={s.muted}>Request sent · {r.label ?? 'waiting'}</span>
          </div>
        ))}
      </section>

      {playedWith.length > 0 && (
        <section className={s.block}>
          <h3 className={s.title}>People you've played</h3>
          {playedWith.map(p => (
            <div key={p.uid} className={s.row} data-played={p.uid}>
              <span className={s.name}>{p.label}</span>
              <span className={s.muted}>{p.via === 'pvp' ? 'head to head' : 'league'}</span>
              <button className={s.secondary} disabled={busy === p.uid || outgoing.some(o => o.to === p.uid)} onClick={() => run(p.uid, () => requestFriend({ uid: p.uid }), r => (r.friends ? 'You are friends now' : 'Request sent'))}>
                {outgoing.some(o => o.to === p.uid) ? 'Sent' : 'Add'}
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
