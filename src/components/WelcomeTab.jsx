// THE FRONT DOOR for somebody who is not signed in.
//
// It shows no cards. The old guest landing was the full card browser — three
// hundred faces requested on first paint, seconds of blank tiles on a phone,
// and every card in the game on display to someone who owns none (the user,
// 2026-09-08: "It shouldn't show any cards and should push the user toward
// sign-up and the starter pack"). This page is a sentence, the starter pack,
// the sign-in button and the tutorial. The one image on it is the sign-up
// card, because that is the thing being offered.
import { useAuth } from '../firebase/AuthProvider.jsx';
import { getStratThumbPath, getStratImagePath, fallbackTo } from '../game/cardImages.js';
import s from './WelcomeTab.module.css';

export default function WelcomeTab({ onTutorial, onHowToPlay }) {
  const { signIn, loading } = useAuth();
  const thumb = getStratThumbPath('unethical_hoops');
  const full = getStratImagePath('unethical_hoops');

  return (
    <div className={s.wrap}>
      <section className={s.hero}>
        <div className={s.copy}>
          <h1 className={s.title}>Build a team. Place your five. Roll.</h1>
          <p className={s.lede}>
            NBA Showdown 2026 is a D20 basketball card game: real players on collectible cards, a
            placement snake that decides who guards whom, strategy cards in every window, and a
            final section that turns into Crunch Time.
          </p>
          <div className={s.actions}>
            <button className={s.primary} onClick={signIn} disabled={loading}>
              Sign in with Google to claim your Starter Pack
            </button>
            <button className={s.secondary} onClick={onTutorial}>Play the tutorial</button>
            <button className={s.ghost} onClick={onHowToPlay}>How to Play</button>
          </div>
          <p className={s.fine}>
            The Starter Pack is free: <strong>20 players</strong>, <strong>30 strategy cards</strong>,
            and <strong>Unethical Hoops</strong>, the sign-up card. You pick the team you support
            first and the pack is built around them. Everything lives on your Google account, so a
            game started on your phone can be picked up on a desktop.
          </p>
        </div>
        <figure className={s.gift}>
          <img
            className={s.giftCard}
            src={thumb}
            alt="Unethical Hoops — the sign-up card"
            onError={fallbackTo(full)}
          />
          <figcaption className={s.giftCaption}>Yours for signing up</figcaption>
        </figure>
      </section>

      <section className={s.steps}>
        <div className={s.step}>
          <div className={s.stepNum}>1</div>
          <div><strong>Sign in</strong> with Google. Nothing else to fill in.</div>
        </div>
        <div className={s.step}>
          <div className={s.stepNum}>2</div>
          <div><strong>Pick the team you support</strong> and open your Starter Pack.</div>
        </div>
        <div className={s.step}>
          <div className={s.stepNum}>3</div>
          <div><strong>Play the tutorial</strong>, a guided quarter against the coach, then Quick Match, a Season, or a friend in PvP.</div>
        </div>
      </section>
    </div>
  );
}
