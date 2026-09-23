// THE STAFF ON SCREEN (2026-09-23): the panel in the front office, the
// Cap Strategist's read at the table. Static markup.
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../firebase/CardStatsProvider.jsx', () => ({ useCardStats: () => ({ stats: {} }) }));
vi.mock('../../firebase/savedDecks.js', () => ({ loadDecks: async () => [] }));

import { StaffPanel, Negotiator, soloMoves } from './DynastyScreens.jsx';
import { createDynasty, HUMAN_ID, DPHASE, rosterKeys, STAFF_ROLES } from '../../game/modes/dynasty.js';
import { buildAiLeague } from '../../game/modes/aiTeams.js';

const html = el => renderToStaticMarkup(el);
const seeded = (s = 808) => () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
const dynasty = () => createDynasty({
  id: 'dyn', size: 4, length: 'short', startMode: 'own', rng: seeded(2),
  human: { name: 'Me', roster: buildAiLeague(1, { rng: seeded(1) })[0].roster },
});
const solo = soloMoves(() => {}, HUMAN_ID);

describe('StaffPanel', () => {
  it('lists the three roles with their next tier, its price and why a hire is refused', () => {
    const d = { ...dynasty(), fp: { [HUMAN_ID]: 4 } };
    const out = html(<StaffPanel d={d} moves={solo} />);
    for (const role of Object.values(STAFF_ROLES)) expect(out).toContain(role.name);
    expect(out).toContain('Scouting Department');
    expect(out).toContain('3 pts');
    // Sports Science needs an aging dynasty; the row says so.
    expect(out).toContain('aging dynasty');
    expect(out).toContain('4 Franchise Points');
  });

  it('shows what is in effect once a tier is held, and nothing to a team that is not a coach', () => {
    const d = { ...dynasty(), staff: { [HUMAN_ID]: { cap: 2 } } };
    const out = html(<StaffPanel d={d} moves={solo} />);
    expect(out).toContain('✓ Read the Room');
    expect(out).toContain('✓ Hometown Discount');
    expect(out).toContain('Luxury Apron');
    expect(html(<StaffPanel d={d} moves={{}} />)).toBe('');
  });
});

describe('the negotiating table', () => {
  it('shows the floor and the discount only with the Cap Strategist', () => {
    const d0 = dynasty();
    const mine = rosterKeys(d0, HUMAN_ID)[0];
    const d = {
      ...d0, phase: DPHASE.resign,
      rights: { ...d0.rights, [mine]: { teamId: HUMAN_ID, kind: 'expiring' } },
      contracts: Object.fromEntries(Object.entries(d0.contracts).filter(([k]) => k !== mine)),
    };
    const plain = html(<Negotiator d={d} cardKey={mine} moves={solo} />);
    expect(plain).not.toContain('He would take about');
    expect(plain).not.toContain('−10%');
    const staffed = html(<Negotiator d={{ ...d, staff: { [HUMAN_ID]: { cap: 2 } } }} cardKey={mine} moves={solo} />);
    expect(staffed).toContain('He would take about');
    expect(staffed).toContain('−10%');
  });
});
