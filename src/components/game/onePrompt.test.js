// A CARD ASKS ONCE (the user, 2026-09-13).
//
// "I wanted to use it on Naz Hillmon, I selected her, then there was a second
// prompt where I only had the option of Towns and Kelsey Mitchell."
//
// CourtBoard picks a player two ways. `filteredPlayerCards` is a generic list —
// every card in it gets one prompt from a shared handler — and a card with a
// condition the generic handler cannot express gets its own block further down,
// with its own filter. Short-Roll Playmaker and Pick-and-Roll Maestro were in
// BOTH: the generic prompt asked first and offered players the card cannot
// legally take (Naz Hillmon is Speed 7 / Power 7 against a card that needs
// 8/8), then the card's own block asked again and overwrote opts.playerIdx, so
// the first answer was silently discarded.
//
// This reads the component's source rather than rendering it, because the bug
// is in a LIST, and a list is exactly the thing a rendering test would have to
// drive twenty cards through to notice.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'CourtBoard.jsx'),
  'utf8'
);

/** The ids in the shared "pick one of my starters" list. */
function genericList() {
  const m = SRC.match(/const filteredPlayerCards = \[([\s\S]*?)\n {2}\];/);
  expect(m, 'filteredPlayerCards not found — did the list move or get renamed?').toBeTruthy();
  // Ignore ids that only appear inside a comment line.
  return m[1]
    .split('\n')
    .filter(line => !line.trim().startsWith('//'))
    .flatMap(line => [...line.matchAll(/'([a-z0-9_]+)'/g)].map(x => x[1]));
}

/** Ids with their own top-level picker block that sets opts.playerIdx. */
function ownPickers() {
  const out = new Set();
  for (const m of SRC.matchAll(/\n {2}if \(cardId === '([a-z0-9_]+)'\) \{/g)) {
    const body = SRC.slice(m.index, SRC.indexOf('\n  }', m.index));
    if (/opts\.playerIdx\s*=/.test(body)) out.add(m[1]);
  }
  return out;
}

describe('a card is asked for its player exactly once', () => {
  it('never lists a card that also has its own playerIdx picker', () => {
    const generic = genericList();
    const own = ownPickers();
    const askedTwice = generic.filter(id => own.has(id));
    expect(
      askedTwice,
      'these cards prompt twice and throw the first answer away — put each in one place, not both'
    ).toEqual([]);
  });

  it('still routes the two that caused it, through their own filtered pickers', () => {
    const generic = genericList();
    const own = ownPickers();
    for (const id of ['short_roll_playmaker', 'pick_and_roll_maestro']) {
      expect(generic, `${id} is back in the generic list`).not.toContain(id);
      expect(own, `${id} lost its own picker`).toContain(id);
    }
  });

  it('leaves the cards whose second prompt asks a DIFFERENT question alone', () => {
    // Energy Injection picks a second cheap player, Stretch Five a target —
    // neither overwrites the first answer, so both belong in the generic list.
    const generic = genericList();
    expect(generic).toContain('energy_injection');
    expect(generic).toContain('stretch_five');
  });
});
