// THE SIGN-UP POP-UP: the Unethical Hoops card, named as the bonus.
//
// Shown once, on the sign-in that created the account (AuthProvider sets
// `justSignedUp` when it writes the user document for the first time). The
// user (2026-09-08): "upon signup, we should show the pop up message with the
// unethical hoops card visible, saying it was a signup bonus." The card is
// already in the Starter Pack (packEngine's bonusStrats); this is the moment
// that tells the player so, and its one button goes to the pack.
import { useEffect } from 'react';
import { getStratThumbPath, getStratImagePath, fallbackTo } from '../game/cardImages.js';
import s from './SignupBonus.module.css';

export default function SignupBonus({ name, onClaim, onDismiss }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onDismiss?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const first = name ? String(name).split(' ')[0] : null;
  return (
    <div className={s.backdrop} role="dialog" aria-modal="true" aria-label="Your sign-up bonus">
      <div className={s.sheet}>
        <figure className={s.cardWrap}>
          <img
            className={s.card}
            src={getStratThumbPath('unethical_hoops')}
            alt="Unethical Hoops"
            onError={fallbackTo(getStratImagePath('unethical_hoops'))}
          />
        </figure>
        <div className={s.copy}>
          <div className={s.kicker}>Sign-up bonus</div>
          <h2 className={s.title}>{first ? `Welcome, ${first}.` : 'Welcome.'} Unethical Hoops is yours.</h2>
          <p className={s.body}>
            A Crunch Time card for signing up: a player of yours with a Speed or Power advantage
            draws the foul — two free-throw checks at +4. It comes in your Starter Pack alongside
            20 players and 30 strategy cards, built around the team you support.
          </p>
          <div className={s.actions}>
            <button className={s.primary} onClick={onClaim}>Claim my Starter Pack</button>
            <button className={s.ghost} onClick={onDismiss}>Later</button>
          </div>
        </div>
      </div>
    </div>
  );
}
