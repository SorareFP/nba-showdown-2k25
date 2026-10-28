// SEND TO… in the Studio's request queue (2026-10-28): a friend from the list
// or a friend code, then Send (functions sendCardRequest).
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../firebase/config.js', () => ({ auth: {}, googleProvider: {}, functions: {} }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: () => () => {}, signInWithPopup: () => {}, signOut: () => {} }));

const { SendTo } = await import('./RequestsPanel.jsx');
const noop = () => {};

describe('Send to…', () => {
  it('is one button until it is opened', () => {
    const html = renderToStaticMarkup(<SendTo open={false} friends={[]} onOpen={noop} onCancel={noop} onSend={noop} />);
    expect(html).toContain('Send to…');
    expect(html).not.toContain('<select');
  });

  it('offers your friends by name and a code box, and sends nothing until one is chosen', () => {
    const html = renderToStaticMarkup(
      <SendTo open friends={[{ uid: 'u1', name: 'Bro Example' }]} onOpen={noop} onCancel={noop} onSend={noop} />,
    );
    expect(html).toContain('Bro Example');
    expect(html).toContain('friend code');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Send</);
  });
});
