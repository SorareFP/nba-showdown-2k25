// A saved team carries the Climb mark when it is a Climb five (2026-10-19).
import { describe, it, expect, vi } from 'vitest';

const added = [];
vi.mock('./config.js', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (...path) => path.slice(1).join('/'),
  doc: (...path) => path.slice(1).join('/'),
  addDoc: async (ref, data) => { added.push({ ref, data }); return { id: 'new' }; },
  updateDoc: async () => {}, deleteDoc: async () => {}, getDocs: async () => ({ docs: [] }),
  query: q => q, orderBy: () => null, serverTimestamp: () => 'now',
}));

describe('saving a team', () => {
  it('marks a Climb five, and leaves a plain team unmarked', async () => {
    const { saveTeam } = await import('./savedTeams.js');
    await saveTeam('u1', { name: 'Five', players: ['a', 'b', 'c', 'd', 'e'], salary: 2100, climb: true });
    await saveTeam('u1', { name: 'Ten', players: ['a'], salary: 500 });
    expect(added[0].data).toMatchObject({ name: 'Five', climb: true });
    expect(added[1].data.climb).toBeUndefined();
  });
});
