// THE CLIMB'S TAB — the run, where it is kept, and the server's ledger.
//
// The run is run.js's pure state, saved after every step (users/{uid}/runs,
// src/firebase/climb.js). The ledger is the server's (serverWrites.js
// climbStart / climbGame / climbBank): a game is opened there before the
// Play tab deals it, its claim moves the ledger, and the pot banks from it.
// A game goes out the way a season fixture does — App holds the preset and
// hands the result back as `pendingResult`. `store` and `server` are swapped
// for in-memory ones by the dev harness (?demo=climb).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../../firebase/AuthProvider.jsx';
import { useDialogs } from '../../ui/dialogs.jsx';
import { saveRun, loadActiveRun } from '../../firebase/climb.js';
import { loadTeams, saveTeam } from '../../firebase/savedTeams.js';
import { getCardByKey } from '../../game/cardSets.js';
import { climbStart, climbGame, climbBank } from '../../firebase/serverWrites.js';
import { ownedPlayers, capSal } from '../../game/teamRules.js';
import {
  newRun, chooseCamp, chooseStop, presetFor, recordResult, pickStrat, pickPlayer, pickPerk, skipOffers,
  restDay, takeFreeRest, retire, rosterCards, recordServerWin, abandon,
} from '../../game/modes/run.js';
import { stopById } from '../../game/modes/climbMap.js';
import { ClimbStart, TrainingCamp, ClimbMap, RewardPicker, RestDay, RunOver } from './ClimbScreens.jsx';
import styles from './Climb.module.css';

/**
 * ONE STEP AT A TIME, by a ref (final review, 2026-10-18): a flag in React
 * state let two taps in one tick both through, and two different stops opened
 * on the server end the run. Resolves true when `fn` ran, false when refused.
 */
export async function oneAtATime(gate, fn) {
  if (gate.current) return false;
  gate.current = true;
  try { await fn(); return true; } finally { gate.current = false; }
}

export const FIREBASE_STORE = { loadActive: loadActiveRun, save: saveRun };
export const FIREBASE_SERVER = { start: climbStart, openGame: climbGame, bank: climbBank };
/** Saved teams: the Climb fives among them fill the start screen (2026-10-19). */
export const FIREBASE_TEAMS = { load: loadTeams, save: saveTeam };

export default function ClimbTab({ collection = null, pendingResult = null, onResultConsumed, onPlayFixture, store = FIREBASE_STORE, server = FIREBASE_SERVER, teams = FIREBASE_TEAMS }) {
  const { user } = useAuth();
  const uid = user?.uid ?? null;
  const { ask, toast, askText } = useDialogs();
  const [saved, setSaved] = useState([]);
  const [run, setRun] = useState(undefined);
  const [busy, setBusy] = useState(false);
  const gate = useRef(false);
  const [freeRest, setFreeRest] = useState(false);
  // A look at the map from a Rest Day (2026-10-19); a new step closes it.
  const [peekMap, setPeekMap] = useState(false);
  useEffect(() => { setPeekMap(false); }, [run?.status, run?.restAt]);
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
  const act = useCallback(fn => oneAtATime(gate, async () => {
    setBusy(true);
    try { await fn(); } catch (e) { toast(e?.message ?? String(e), { tone: 'error' }); } finally { setBusy(false); }
  }), [toast]);

  // A RESULT BACK FROM THE PLAY TAB: only this run's, and only once.
  useEffect(() => {
    if (!pendingResult?.runId || !run || pendingResult.runId !== run.id) return;
    onResultConsumed?.();
    const next = recordResult(run, pendingResult);
    if (next !== run) commit(next);
  }, [pendingResult, run, onResultConsumed, commit]);

  const owned = useMemo(() => ownedPlayers(collection), [collection]);

  // YOUR CLIMB FIVES, for the start screen. A failed read just shows none.
  const loadSaved = useCallback(() => {
    if (needsAccount) return;
    Promise.resolve(teams.load(uid)).then(t => setSaved(Array.isArray(t) ? t : [])).catch(() => setSaved([]));
  }, [teams, uid, needsAccount]);
  useEffect(() => { if (run === null) loadSaved(); }, [run, loadSaved]);

  const saveFive = async keys => {
    const name = await askText({ title: 'Name this Climb five', placeholder: 'Bench Mob', confirmLabel: 'Save five' });
    if (!name) return;
    await act(async () => {
      const salary = capSal(keys.map(k => getCardByKey(k)).filter(Boolean));
      await teams.save(uid, { name, players: keys, salary, climb: true });
      toast(`Saved “${name}” to My Teams.`, { tone: 'success' });
      loadSaved();
    });
  };

  const start = ({ rung, keys }) => act(async () => {
    const { runId, seed, mapVersion } = await server.start(uid, { rung });
    await commit(newRun({ id: runId, seed, rung, rosterKeys: keys, mapVersion: mapVersion ?? 1 }));
  });

  const play = async next => {
    const res = await server.openGame(uid, { runId: next.id, stopId: next.game.stopId });
    // Won already: the claim landed but its result never reached this run.
    if (!res?.ok && res?.cleared) {
      await commit(recordServerWin(next, next.game.stopId));
      toast('That game was already won. Its result is in.');
      return;
    }
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

  const giveUp = async () => {
    const yes = await ask({
      title: 'Give up this run?',
      body: 'The run ends here and its pot is lost.',
      confirmLabel: 'Give up the run', cancelLabel: 'Keep it', tone: 'danger',
    });
    if (yes) await act(() => commit(abandon(run)));
  };

  if (needsAccount) return <div className={styles.screen}><p className={styles.lede}>Sign in to climb: a run starts with players you own.</p></div>;
  if (run === undefined) return <div className={styles.screen}><p className={styles.muted}>Loading your climb…</p></div>;
  if (!run) return <ClimbStart owned={owned} saved={saved} onStart={start} onSaveFive={saveFive} busy={busy} />;

  switch (run.status) {
    case 'camp':
      return <TrainingCamp run={run} busy={busy} onChoose={choice => act(() => commit(chooseCamp(run, choice)))} />;
    case 'map':
      if (freeRest) {
        return (
          <RestDay
            run={run} free busy={busy}
            onViewMap={() => setFreeRest(false)}
            onRest={() => act(async () => { await commit(takeFreeRest(run, { choice: 'rest' })); setFreeRest(false); })}
            onPractice={cardId => act(async () => { await commit(takeFreeRest(run, { choice: 'practice', cardId })); setFreeRest(false); })}
            onCut={cardId => act(async () => { await commit(takeFreeRest(run, { choice: 'cut', cardId })); setFreeRest(false); })}
          />
        );
      }
      return (
        <>
          {rosterCards(run).blocked && <p className={styles.note}>Fewer than five of your players are still in the game&apos;s pool. Retire to bank the pot.</p>}
          <ClimbMap run={run} busy={busy} onGo={go} onRetire={retireRun} onFreeRest={() => setFreeRest(true)} onAbandon={giveUp} />
        </>
      );
    case 'game': {
      const o = run.game?.opponent;
      return (
        <div className={styles.screen}>
          <h2 className={styles.title}>{run.game?.kind === 'boss' ? 'The boss' : run.game?.kind === 'rivalry' ? 'A Rivalry' : 'A Game'}{o ? `: ${o.classic ? 'Classic ' : ''}${o.city} ${o.name}` : ''}</h2>
          <p className={styles.lede}>One quarter from Q4. Your game is waiting on the Play tab.</p>
          <div className={styles.actions}>
            <button type="button" className={styles.primary} disabled={busy} onClick={() => act(() => play(run))}>Play it</button>
            <button type="button" className={styles.danger} disabled={busy} onClick={giveUp}>Give up this run</button>
          </div>
        </div>
      );
    }
    case 'reward':
      return (
        <RewardPicker
          run={run} busy={busy}
          onPickStrat={id => act(() => commit(pickStrat(run, id)))}
          onPickPlayer={key => act(() => commit(pickPlayer(run, key)))}
          onPickPerk={(id, target) => act(() => commit(pickPerk(run, id, target)))}
          onSkip={part => act(() => commit(skipOffers(run, part ?? null)))}
        />
      );
    case 'rest':
      if (peekMap) return <ClimbMap run={run} onBack={() => setPeekMap(false)} />;
      return (
        <RestDay
          run={run} busy={busy}
          onViewMap={() => setPeekMap(true)}
          onRest={() => act(() => commit(restDay(run, { choice: 'rest' })))}
          onPractice={cardId => act(() => commit(restDay(run, { choice: 'practice', cardId })))}
          onCut={cardId => act(() => commit(restDay(run, { choice: 'cut', cardId })))}
        />
      );
    default:
      return <RunOver run={run} busy={busy} onBank={() => bank(run)} onNew={() => setRun(null)} onAbandon={giveUp} />;
  }
}
