// THE CLIMB'S TAB — the run, where it is kept, and the server's ledger.
//
// The run is run.js's pure state, saved after every step (users/{uid}/runs,
// src/firebase/climb.js). The ledger is the server's (serverWrites.js
// climbStart / climbGame / climbBank): a game is opened there before the
// Play tab deals it, its claim moves the ledger, and the pot banks from it.
// A game goes out the way a season fixture does — App holds the preset and
// hands the result back as `pendingResult`. `store` and `server` are swapped
// for in-memory ones by the dev harness (?demo=climb).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { useDialogs } from '../../ui/dialogs.jsx';
import { saveRun, loadActiveRun } from '../../firebase/climb.js';
import { climbStart, climbGame, climbBank } from '../../firebase/serverWrites.js';
import { ownedPlayers } from '../../game/teamRules.js';
import {
  newRun, chooseCamp, chooseStop, presetFor, recordResult, pickStrat, pickPlayer, skipOffers,
  restDay, takeFreeRest, retire, rosterCards,
} from '../../game/modes/run.js';
import { stopById } from '../../game/modes/climbMap.js';
import { ClimbStart, TrainingCamp, ClimbMap, RewardPicker, RestDay, RunOver } from './ClimbScreens.jsx';
import styles from './Climb.module.css';

export const FIREBASE_STORE = { loadActive: loadActiveRun, save: saveRun };
export const FIREBASE_SERVER = { start: climbStart, openGame: climbGame, bank: climbBank };

export default function ClimbTab({ collection = null, pendingResult = null, onResultConsumed, onPlayFixture, store = FIREBASE_STORE, server = FIREBASE_SERVER }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { ask, toast } = useDialogs();
  const [run, setRun] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const [freeRest, setFreeRest] = useState(false);
  const needsAccount = store === FIREBASE_STORE && !uid;

  useEffect(() => {
    if (needsAccount) return undefined;
    let live = true;
    store.loadActive(uid).then(r => { if (live) setRun(r ?? null); }).catch(() => { if (live) setRun(null); });
    return () => { live = false; };
  }, [uid, store, needsAccount]);

  const commit = useCallback(async next => {
    setRun(next);
    try { await store.save(uid, next); } catch (e) { toast(`The run could not be saved: ${e?.message ?? e}`, { tone: 'error' }); }
    return next;
  }, [store, uid, toast]);

  /** Every step: one at a time, a refusal said out loud. */
  const act = useCallback(async fn => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { toast(e?.message ?? String(e), { tone: 'error' }); } finally { setBusy(false); }
  }, [busy, toast]);

  // A RESULT BACK FROM THE PLAY TAB: only this run's, and only once.
  useEffect(() => {
    if (!pendingResult?.runId || !run || pendingResult.runId !== run.id) return;
    onResultConsumed?.();
    const next = recordResult(run, pendingResult);
    if (next !== run) commit(next);
  }, [pendingResult, run, onResultConsumed, commit]);

  const owned = useMemo(() => ownedPlayers(collection), [collection]);

  const start = ({ rung, keys }) => act(async () => {
    const { runId, seed } = await server.start(uid, { rung });
    await commit(newRun({ id: runId, seed, rung, rosterKeys: keys }));
  });

  const play = async next => {
    const res = await server.openGame(uid, { runId: next.id, stopId: next.game.stopId });
    if (!res?.ok) {
      if (res?.status === 'lost') await commit({ ...run, status: 'lost', game: null });
      throw new Error(res?.status === 'lost' ? 'Your last game never reported, so the run is over.' : 'That run is over.');
    }
    onPlayFixture?.(presetFor(next));
  };

  const go = stopId => act(async () => {
    const next = chooseStop(run, stopId);
    if (stopById(run.map, stopId)?.kind === 'rest') { await commit(next); return; }
    await play(await commit(next));
  });

  const bank = r => act(async () => {
    const res = await server.bank(uid, r.id);
    await commit({ ...r, banked: { coins: res?.coins ?? 0, booster: Boolean(res?.booster) } });
    toast(`Banked ${(res?.coins ?? 0).toLocaleString('en-US')} coins${res?.booster ? ' and a Booster' : ''}.`);
  });

  const retireRun = async () => {
    const yes = await ask({
      title: 'Retire and bank the pot?',
      body: 'The run ends here and the pot is paid to your account.',
      confirmLabel: 'Retire and bank', cancelLabel: 'Keep climbing',
    });
    if (!yes) return;
    const r = retire(run);
    await commit(r);
    await bank(r);
  };

  if (needsAccount) return <div className={styles.screen}><p className={styles.lede}>Sign in to climb: a run starts with players you own.</p></div>;
  if (run === undefined) return <div className={styles.screen}><p className={styles.muted}>Loading your climb…</p></div>;
  if (!run) return <ClimbStart owned={owned} onStart={start} busy={busy} />;

  switch (run.status) {
    case 'camp':
      return <TrainingCamp run={run} busy={busy} onChoose={choice => act(() => commit(chooseCamp(run, choice)))} />;
    case 'map':
      if (freeRest) {
        return (
          <RestDay
            run={run} free busy={busy}
            onRest={() => act(async () => { await commit(takeFreeRest(run, { choice: 'rest' })); setFreeRest(false); })}
            onSmith={cardId => act(async () => { await commit(takeFreeRest(run, { choice: 'smith', cardId })); setFreeRest(false); })}
          />
        );
      }
      return (
        <>
          {rosterCards(run).blocked && <p className={styles.note}>Fewer than five of your players are still in the game&apos;s pool. Retire to bank the pot.</p>}
          <ClimbMap run={run} busy={busy} onGo={go} onRetire={retireRun} onFreeRest={() => setFreeRest(true)} />
        </>
      );
    case 'game': {
      const o = run.game?.opponent;
      return (
        <div className={styles.screen}>
          <h2 className={styles.title}>{run.game?.kind === 'boss' ? 'The boss' : run.game?.kind === 'rivalry' ? 'A Rivalry' : 'A Game'}{o ? `: ${o.classic ? 'Classic ' : ''}${o.city} ${o.name}` : ''}</h2>
          <p className={styles.lede}>One quarter from Q4. Your game is waiting on the Play tab.</p>
          <div className={styles.actions}><button type="button" className={styles.primary} disabled={busy} onClick={() => act(() => play(run))}>Play it</button></div>
        </div>
      );
    }
    case 'reward':
      return (
        <RewardPicker
          run={run} busy={busy}
          onPickStrat={id => act(() => commit(pickStrat(run, id)))}
          onPickPlayer={key => act(() => commit(pickPlayer(run, key)))}
          onSkip={part => act(() => commit(skipOffers(run, part ?? null)))}
        />
      );
    case 'rest':
      return (
        <RestDay
          run={run} busy={busy}
          onRest={() => act(() => commit(restDay(run, { choice: 'rest' })))}
          onSmith={cardId => act(() => commit(restDay(run, { choice: 'smith', cardId })))}
        />
      );
    default:
      return <RunOver run={run} busy={busy} onBank={() => bank(run)} onNew={() => setRun(null)} />;
  }
}
