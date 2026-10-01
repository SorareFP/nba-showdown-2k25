// The suggestion form's markup, rendered without a DOM (the PlayerList.test.js
// way): Home needs a signed-in account, so this is where the form is checked.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/suggestions.js', () => ({ submitSuggestion: vi.fn() }));

const { default: SuggestionBox } = await import('./SuggestionBox.jsx');

describe('SuggestionBox', () => {
  const html = renderToStaticMarkup(<SuggestionBox onClose={() => {}} />);

  it('is a labelled dialog with the four kinds, an idea picked first', () => {
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Suggest something');
    for (const label of ['Something broke', 'An idea', 'A card', 'Something else']) expect(html).toContain(label);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-checked="true"[^>]*>An idea/);
  });

  it('cannot send an empty suggestion, and shows the room left', () => {
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""[^>]*>Send<\/button>/);
    expect(html).toContain('>1500<');
  });
});
