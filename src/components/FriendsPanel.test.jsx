import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

let state;
vi.mock('../firebase/FriendsProvider.jsx', () => ({ useFriends: () => state }));
vi.mock('../firebase/friends.js', () => ({ requestFriend: vi.fn(), answerFriendRequest: vi.fn(), removeFriend: vi.fn() }));
vi.mock('../ui/dialogs.jsx', () => ({ useDialogs: () => ({ ask: async () => true, toast: () => {} }) }));
const { default: FriendsPanel } = await import('./FriendsPanel.jsx');

const overview = {
  code: 'ABC234',
  friends: [{ uid: 'alex', name: 'Alex Example', needs: [{ cardKey: 'x', goalId: 'g', goalLabel: 'Atlanta Hawks collection', missing: 1 }] }],
  incoming: [{ id: 'jo_me', from: 'jo', name: 'Jo Example' }],
  outgoing: [{ id: 'me_kim', to: 'kim', label: 'code KKKKKK' }],
  playedWith: [{ uid: 'lee', label: 'Bench Mob (Fall League)', via: 'league' }],
};

describe('the Friends page', () => {
  it('shows your code, requests both ways, friends with what they need, and people you have played', () => {
    state = { overview, error: null, refresh: () => {} };
    const html = renderToStaticMarkup(<FriendsPanel />);
    expect(html).toContain('ABC234');
    expect(html).toContain('data-incoming="jo_me"');
    expect(html).toContain('Jo Example');
    expect(html).toContain('code KKKKKK');
    expect(html).toContain('data-friend="alex"');
    expect(html).toContain('needs 1 card');
    expect(html).toContain('data-played="lee"');
    expect(html).toContain('Bench Mob (Fall League)');
  });

  it('says so when Friends is not reachable', () => {
    state = { overview: null, error: 'Friends is not switched on yet. Try again after the next update.', refresh: () => {} };
    expect(renderToStaticMarkup(<FriendsPanel />)).toContain('not switched on yet');
  });
});
