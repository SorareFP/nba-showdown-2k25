import { describe, it, expect } from 'vitest';
import { checkSuggestion, sentToday, SUGGESTION_MAX, SUGGESTION_KINDS, SUGGESTION_STATUS, SUGGESTION_STATUS_LABELS } from './suggestions.js';

describe('checkSuggestion', () => {
  it('takes a kind and a trimmed text', () => {
    expect(checkSuggestion({ kind: 'idea', text: '  More Dantley cards  ' })).toEqual({ ok: true, kind: 'idea', text: 'More Dantley cards' });
  });

  it('says what to fix', () => {
    expect(checkSuggestion({ kind: 'nope', text: 'x' })).toMatchObject({ ok: false, msg: /what it is about/ });
    expect(checkSuggestion({ kind: 'bug', text: '   ' })).toMatchObject({ ok: false, msg: /Write/ });
    expect(checkSuggestion({ kind: 'bug', text: 'x'.repeat(SUGGESTION_MAX + 1) })).toMatchObject({ ok: false, msg: /under 1500/ });
    expect(checkSuggestion()).toMatchObject({ ok: false });
  });

  it('labels every kind and every status', () => {
    expect(SUGGESTION_KINDS).toEqual(['bug', 'idea', 'card', 'other']);
    for (const s of Object.values(SUGGESTION_STATUS)) expect(SUGGESTION_STATUS_LABELS[s]).toBeTruthy();
  });
});

describe('sentToday', () => {
  it('counts the last rolling day only', () => {
    const now = Date.parse('2026-10-01T12:00:00Z');
    const hour = 60 * 60 * 1000;
    expect(sentToday([now - hour, now - 23 * hour, now - 25 * hour, null], now)).toBe(2);
  });
});
