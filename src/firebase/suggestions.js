// The suggestion box's calls (src/game/suggestions.js has the story). All of
// it is server work: the collection is closed to the client by the rules'
// closing match, so there is no direct-write route to mirror.
import { getFunctions, httpsCallable } from 'firebase/functions';
import { app } from './config.js';

let fns = null;
const call = name => data => {
  fns ??= getFunctions(app, 'us-central1');
  return httpsCallable(fns, name)(data).then(r => r.data, e => {
    // A callable the live server does not have yet answers a bare "internal".
    if (e?.code === 'functions/internal' && /^internal$/i.test(e.message ?? '')) {
      throw new Error('The suggestion box is not switched on yet. Try again after the next update.');
    }
    throw e;
  });
};

/** `{ kind, text, screen }` → `{ id }`, or throws with the server's reason. */
export const submitSuggestion = call('submitSuggestion');
/** `{ trusted, items }`: a trusted player's own suggestions and their outcomes. */
export const mySuggestions = call('mySuggestions');
/** Admins: the whole queue, newest first. */
export const listSuggestions = call('listSuggestions');
/** Admins: `{ id, status, outcome? }`. */
export const answerSuggestion = call('answerSuggestion');
/** Admins: `{ uid, trusted }`. */
export const setSuggestionTrust = call('setSuggestionTrust');
