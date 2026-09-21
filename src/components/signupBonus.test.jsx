// THE SIGN-UP POP-UP'S COPY IS THE FIRST THING A NEW ACCOUNT READS ABOUT
// UNETHICAL HOOPS, and it went stale twice without anyone noticing: it still
// said "two free-throw checks at +4" after the card had dealt four since
// 2026-09-08 and after the user (2026-09-21: "Unethical Hoops should not
// boost free throw shot checks") took the +4 away. This pins the copy to the
// card as it plays, so the next rule change fails here instead of in front of
// a new player.
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import SignupBonus from './SignupBonus.jsx';

const paint = () => renderToStaticMarkup(<SignupBonus name="Ada Lovelace" onClaim={() => {}} onDismiss={() => {}} />);

describe('the sign-up pop-up', () => {
  it('describes Unethical Hoops as four free-throw checks with no bonus', () => {
    const html = paint();
    expect(html).toContain('Unethical Hoops is yours');
    expect(html).toContain('four free-throw checks');
    expect(html).not.toMatch(/two free-throw/);
    expect(html).not.toMatch(/\+4/);
  });

  it('greets by first name and offers the Starter Pack', () => {
    const html = paint();
    expect(html).toContain('Welcome, Ada.');
    expect(html).toContain('Claim my Starter Pack');
  });
});
