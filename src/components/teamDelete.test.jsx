// DELETE A SAVED TEAM WHERE YOU CAN SEE IT (Ryan, through the suggestion box,
// 2026-10-07: "Option to delete created teams. Unless I missed it."). It was
// there, inside an opened team in My Teams, and nowhere in the Team Builder.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LoadTeamModal } from './TeamBuilderTab.jsx';

const teams = [
  { id: 't1', name: 'Bench Mob', players: ['a', 'b', 'c', 'd', 'e'], salary: 4200 },
  { id: 't2', name: 'Twin Towers', players: ['f', 'g', 'h', 'i', 'j'], salary: 5100 },
];

describe("the Team Builder's saved-team list", () => {
  it('puts a Delete beside every team, outside the load button', () => {
    const out = renderToStaticMarkup(<LoadTeamModal teams={teams} onSelect={() => {}} onDelete={() => {}} onClose={() => {}} />);
    expect(out).toContain('data-delete-team="t1"');
    expect(out).toContain('data-delete-team="t2"');
    // Not nested inside the load button: a button in a button is not clickable on its own.
    expect(out).not.toMatch(/<button[^>]*loadModalItem[^>]*>(?:(?!<\/button>).)*data-delete-team/s);
  });

  it('shows no Delete when the caller gives no way to delete', () => {
    const out = renderToStaticMarkup(<LoadTeamModal teams={teams} onSelect={() => {}} onClose={() => {}} />);
    expect(out).not.toContain('data-delete-team');
  });
});
