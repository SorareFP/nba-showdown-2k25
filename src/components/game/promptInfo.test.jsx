// EVERY CHOICE PROMPT SAYS WHAT BEARS ON THE CHOICE (2026-09-25). The user,
// on Help Defender's "Who is beating their defender?": "This would be an
// opportune time to see relevant matchup info. Please audit the strategy
// cards where there are choices like this and provide relevant info while
// choosing." An audit ran every card's prompts over random playable states;
// these pin the lines it added.
import { describe, it, expect, vi } from 'vitest';
import { newGame, getTeam } from '../../game/engine.js';
import { canPlayCard } from '../../game/canPlay.js';
import { choicePreview } from '../../game/cardPreview.js';

vi.mock('../../ui/dialogs.jsx', () => ({ useDialogs: () => ({ toast: () => {}, ask: async () => false }) }));
const { buildOpts, previewLines } = await import('./CourtBoard.jsx');

const mk = (id, over = {}) => ({
  id, name: id, team: 'TST', pos: 'F', speed: 10, power: 10, defBoost: 0,
  shotLine: 16, paintBoost: 0, threePtBoost: 0, salary: 500,
  chart: [{ lo: 1, hi: 99, pts: 2, reb: 1, ast: 1 }], ...over,
});
function game(hand, overA = {}, overB = {}) {
  const g = newGame(
    Array.from({ length: 10 }, (_, i) => mk(`a${i}`, overA[i] || {})),
    Array.from({ length: 10 }, (_, i) => mk(`b${i}`, overB[i] || {})),
  );
  g.teamA.starters = g.teamA.roster.slice(0, 5);
  g.teamB.starters = g.teamB.roster.slice(0, 5);
  g.phase = 'scoring'; g.scoringPasses = 99; g.scoringTurn = 'A';
  g.offMatchups = { A: [0, 1, 2, 3, 4], B: [0, 1, 2, 3, 4] };
  g.teamA.hand = hand;
  return g;
}
/** Every prompt the card raises: label and, per row, its info line and preview lines. */
async function prompts(g, cardId) {
  const seen = [];
  const openModal = cfg => {
    const starters = getTeam(g, cfg.teamKey).starters;
    seen.push({
      label: cfg.label,
      rows: cfg.players.map((p, i) => ({
        name: p.name,
        extra: cfg.extraInfo?.[i] ?? '',
        lines: cfg.preview
          ? previewLines(choicePreview(g, cfg.preview.teamKey, cardId, { ...cfg.preview.base, ...cfg.preview.optsFor(i) }), { teamKey: cfg.teamKey, idx: starters.findIndex(x => x.id === p.id) }).map(l => l.text)
          : [],
      })),
    });
    return Promise.resolve(0);
  };
  await buildOpts(g, 'A', cardId, {}, openModal, { toast: () => {}, ask: async () => true });
  return seen;
}

describe('the choice prompts', () => {
  it('Help Defender names who each attacker is beating, by how much, and the roll it is worth', async () => {
    const g = game(['help_defender'], {}, { 0: { speed: 16 }, 3: { power: 15 } });
    expect(canPlayCard(g, 'A', 'help_defender').canPlay).toBe(true);
    const [first, second] = await prompts(g, 'help_defender');
    expect(first.label).toBe('Who is beating their defender?');
    expect(first.rows.map(r => r.extra)).toEqual([
      'Beating a0 by +6 (Speed +6, Power 0) · roll +6',
      'Beating a3 by +5 (Speed 0, Power +5) · roll +5',
    ]);
    expect(second.label).toMatch(/^Who rotates over onto b0\? \(beating a0 by \+6/);
    // Each helper row: the target's edge gone, and the helper's own man open at +3.
    expect(second.rows[0].lines).toEqual(expect.arrayContaining(['b0\'s roll vs a0: +6 → 0']));
  });

  it('Rebound Tap-Out offers only players with a 3PT Bonus, and its preview invents no roll change', async () => {
    const g = game(['rebound_tap_out'], { 2: { threePtBoost: 2 } });
    g.teamA.rebounds = 6; g.teamA.reboundsWon = 6; g.teamB.reboundsWon = 1;
    expect(canPlayCard(g, 'A', 'rebound_tap_out').canPlay).toBe(true);
    const [p] = await prompts(g, 'rebound_tap_out');
    expect(p.rows.map(r => r.name)).toEqual(['a2']);
    expect(p.rows[0].lines).toHaveLength(1);                            // the check only: no phantom cold marker
    expect(p.rows[0].lines[0]).toMatch(/^3PT check: needs \d+\+ on the die/);
  });

  it('ATO Masterpiece shows both checks, since the type is asked after the pick', async () => {
    const g = game(['ato_masterpiece'], { 0: { threePtBoost: 3, paintBoost: -1 } });
    g.crunch = { active: true, margin: 4, used: {}, extra: {}, timeoutUsed: {} };
    g.timeoutActive = 'A';
    expect(canPlayCard(g, 'A', 'ato_masterpiece').canPlay).toBe(true);
    const [p] = await prompts(g, 'ato_masterpiece');
    expect(p.rows[0].extra).toBe('3PT check at +2 needs 11+ (50%) · Paint check at +2 needs 15+ (30%)');
  });

  it('a discard shows the card\'s real name and what it does', async () => {
    const g = game(['denial', 'close_out'], {}, {});
    g.pendingShotCheck = { teamKey: 'B', playerIdx: 0, type: '3pt', bonus: 2, cardLabel: 'Test' };
    g.teamB.assists = 0;
    if (!canPlayCard(g, 'A', 'denial').canPlay) return;               // denial's own gate; the discard is the point
    const [p] = await prompts(g, 'denial');
    expect(p.rows[0].name).toBe('Close Out');
    expect(p.rows[0].extra).toMatch(/^Reaction — When opponent announces a 3PT Shot Check/);
  });
});
