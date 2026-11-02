// TRADE OFFERS on the Friends page (2026-11-02): offers waiting on you, offers
// waiting on a friend, and what happened to the last ones. An offer shows both
// sides as card art, You get first, the way the trade screen's slip reads.
import { getCardByKey } from '../game/cardSets.js';
import { getPlayerImageUrl, getPlayerThumbUrl, fallbackTo } from '../game/cardImages.js';
import { ZoomImg } from './CardLightbox.jsx';
import s from './TradeScreen.module.css';

const HOUR_MS = 60 * 60 * 1000;
const NO_TRADES = { incoming: [], outgoing: [], recent: [] };

function timeLeft(expiresAt) {
  const hours = Math.max(1, Math.ceil((expiresAt - Date.now()) / HOUR_MS));
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} left`;
  const days = Math.ceil(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} left`;
}

const names = keys => keys.map(key => getCardByKey(key)?.name ?? key).join(', ');

/** One line for a finished offer. `mine` is an offer this player sent. */
const OUTCOME = {
  accepted: t => (t.mine ? `${t.name} accepted your offer` : `You accepted ${t.name}'s offer`),
  declined: t => (t.mine ? `${t.name} declined your offer` : `You declined ${t.name}'s offer`),
  cancelled: t => (t.mine ? `You cancelled your offer to ${t.name}` : `${t.name} cancelled their offer`),
  expired: t => (t.mine ? `Your offer to ${t.name} expired` : `${t.name}'s offer expired`),
  failed: t => `A trade with ${t.name} did not go through: ${t.why}`,
};

function Side({ title, side, keys }) {
  return (
    <div className={s.offerSide} data-side={side}>
      <h4 className={s.offerTitle}>{title}</h4>
      <div className={s.offerCards}>
        {keys.map((key, i) => (
          <span key={`${key}${i}`} data-key={key}>
            <ZoomImg
              player={key}
              className={s.offerArt}
              src={getPlayerThumbUrl(key)}
              onError={fallbackTo(getPlayerImageUrl(key))}
              alt={getCardByKey(key)?.name ?? key}
              loading="lazy"
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function Offer({ t, mine, line, children }) {
  return (
    <div className={s.offer} data-offer={t.id}>
      <div className={s.who}><b>{t.name}</b><span>{line} · {timeLeft(t.expiresAt)}</span></div>
      <Side title="You get" side="get" keys={mine ? t.get : t.give} />
      <span className={s.swap} aria-hidden="true">⇄</span>
      <Side title="You give" side="give" keys={mine ? t.give : t.get} />
      <div className={s.actions}>{children}</div>
    </div>
  );
}

export default function TradeOffers({ trades = NO_TRADES, onAnswer, onCounter, onCancel, busy = null }) {
  const { incoming, outgoing, recent } = trades;
  if (!incoming.length && !outgoing.length && !recent.length) return null;
  return (
    <section className={s.offers}>
      {(incoming.length > 0 || outgoing.length > 0) && <h3 className={s.offersTitle}>Trade offers</h3>}
      {incoming.map(t => (
        <Offer key={t.id} t={t} line={t.counter ? 'countered your offer' : 'offered a trade'}>
          <button className={s.yes} disabled={busy === t.id} onClick={() => onAnswer(t, true)}>Accept</button>
          <button className={s.no} disabled={busy === t.id} onClick={() => onCounter(t)}>Counter</button>
          <button className={s.no} disabled={busy === t.id} onClick={() => onAnswer(t, false)}>Decline</button>
        </Offer>
      ))}
      {outgoing.map(t => (
        <Offer key={t.id} t={t} mine line={t.counter ? 'your counter' : 'your offer'}>
          <button className={s.no} disabled={busy === t.id} onClick={() => onCancel(t)}>Cancel</button>
        </Offer>
      ))}
      {recent.length > 0 && (
        <ul className={s.recent}>
          {recent.map(t => (
            <li key={t.id} data-recent={t.status}>
              {OUTCOME[t.status]?.(t) ?? t.status}
              <span className={s.recentCards}>{names(t.give)} for {names(t.get)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
