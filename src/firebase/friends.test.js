// The client's friends calls: a server without the feature yet must read as
// "not switched on", not as a crash (the site can go out before the functions).
import { describe, it, expect, vi } from 'vitest';

vi.mock('./config.js', () => ({ app: {}, db: {} }));
vi.mock('firebase/firestore', () => ({ doc: () => ({}), getDoc: async () => ({ exists: () => false }), setDoc: async () => {}, serverTimestamp: () => 'TS' }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: (_f, name) => async () => {
    if (name === 'myFriends') { const e = new Error('internal'); e.code = 'functions/internal'; throw e; }
    if (name === 'requestFriend') { const e = new Error('No player has that code'); e.code = 'functions/not-found'; throw e; }
    return { data: { ok: true } };
  },
}));

const { myFriends, requestFriend, removeFriend, NOT_ON_MESSAGE } = await import('./friends.js');

describe('the friends calls', () => {
  it('say the feature is not on yet when the server does not have it', async () => {
    await expect(myFriends()).rejects.toThrow(NOT_ON_MESSAGE);
  });
  it('pass the server\'s own reason through', async () => {
    await expect(requestFriend({ code: 'ZZZZZZ' })).rejects.toThrow('No player has that code');
  });
  it('return the reply\'s data', async () => {
    expect(await removeFriend({ uid: 'x' })).toEqual({ ok: true });
  });
});
